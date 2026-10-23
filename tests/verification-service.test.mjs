// Deterministic storage and transport-service fault checks. Actual container/SDK
// acceptance is exercised separately in Linux CI, not by these fake runners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { RevisionStore } from '../scripts/revision-store.mjs';
import { VerificationService } from '../scripts/verification-service.mjs';
import { validateVerificationRecord, MAX_VERIFICATION_BYTES } from '../web/verification.mjs';
import { fakeLifecycleFactory } from './helpers/fake-lifecycle.mjs';

const fixture = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json', import.meta.url), 'utf8'));
const image = 'sha256:' + 'a'.repeat(64);
const tests = [{id:'example', stdin:'', expectedStdout:'3\n'}];
const hash = value => createHash('sha256').update(value).digest('hex');
const nativeResult = (stdout = '', code = 0, reason = '') => ({code, reason, stdout, stderr:''});
const processRecord = (stdout = '', code = 0) => ({exitCode:code, reason:'', stdout, stderr:'', stdoutBytes:Buffer.byteLength(stdout),
  stderrBytes:0, stdoutSha256:hash(stdout), stderrSha256:hash(''), displayEncoding:'UTF-8 replacement; original bytes saved separately', cleanupDetail:''});
function reportFor(input) {
  const timestamp = new Date().toISOString();
  const containers = ['compile', ...input.tests.map(() => 'run')].map((phase, index) => ({name:`doctor-${String(index).padStart(32,'0')}`,
    phase, policy:{synthetic:true}, inspection:{image, state:{Running:phase === 'compile', OOMKilled:false, ExitCode:0, Error:''}},
    cleanup:{removed:true, detail:'Synthetic test removal.'}}));
  return {schemaVersion:1, kind:'doctor-sandbox-verification', id:'f'.repeat(32), startedAt:timestamp, finishedAt:timestamp,
    developmentOnly:true, scope:'public-tests-only', image, sdkVersion:'1.0.5', source:{...input.source, sha256:hash(input.source.text)},
    status:'passed', compile:{status:'compile_passed', process:processRecord(), normalized:{status:'compile_passed'}},
    artifact:{sha256:hash('ELF'), bytes:4}, tests:input.tests.map(item => ({id:item.id, status:'passed', process:processRecord(item.expectedStdout),
      verdict:{status:'passed', comparison:'exact_bytes', exitCode:0, stdoutMatches:true,
        actualBytes:Buffer.byteLength(item.expectedStdout), expectedBytes:Buffer.byteLength(item.expectedStdout)}})),
    testStatus:'passed', containers, detail:''};
}
function probeFakes(options = {}) {
  const calls = [], instances = [];
  const probeExecutor = async (...args) => { calls.push(args); return nativeResult('Cangjie Code Doctor 0.3.0', options.coreCode ?? 0); };
  const containerFactory = settings => {
    const container = {settings, name:'doctor-' + 'd'.repeat(32), async create(command) { this.command = command; if (options.createError) throw new Error('creation failed'); },
      async start(settings) { this.startSettings = settings; return nativeResult(); },
      async exec(command) { this.execCommand = command; return nativeResult(Buffer.from(options.sdk ?? 'Cangjie Compiler: 1.0.5 (synthetic)')); },
      async inspect() { return {Image:image, State:{Running:true, OOMKilled:false, Error:''}}; },
      async remove() { this.removed = true; return {removed:!options.cleanupError, detail:options.cleanupError ? 'cleanup failed' : 'absent'}; }};
    instances.push(container); return container;
  };
  return {probeExecutor, containerFactory, calls, instances};
}
async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'doctor-revision-verification-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const revisionStore = new RevisionStore(root), bridge = {busy:false};
  const revision = await revisionStore.save({baseRecord:structuredClone(fixture),
    source:{name:fixture.source.name, text:fixture.source.text.replace('"three"', '3')}, confirmed:true});
  const fakes = probeFakes(options.probe || {});
  const config = {root, revisionStore, core:join(root, 'doctor'), image, bridge, platform:'linux', ...fakes,
    runner:async request => reportFor(request), lifecycleFactory:fakeLifecycleFactory, ...options};
  const service = new VerificationService(config);
  const input = {revisionId:revision.revisionId, tests:structuredClone(tests), confirmed:true};
  return {root, revisionStore, bridge, revision, fakes, config, service, input,
    ready:async () => { assert.equal((await service.probe()).available,true); return service; }};
}

test('unsupported hosts and unconfigured image fail closed without Docker or native probes', async t => {
  for (const options of [{platform:'win32'}, {image:'doctor:latest'}, {core:''}]) {
    const env = await setup(t, options);
    assert.equal((await env.service.probe()).available,false);
    assert.equal(env.fakes.calls.length,0); assert.equal(env.fakes.instances.length,0);
    await assert.rejects(env.service.verify(env.input), error => error.status === 503);
    assert.deepEqual(await env.service.list(), {verifications:[], unreadable:0});
  }
});

test('probe uses trusted core and a fixed no-mount SDK container, requires cleanup', async t => {
  const env = await setup(t); await env.ready();
  assert.deepEqual(env.fakes.calls[0][1], ['--version']);
  const container = env.fakes.instances[0];
  assert.deepEqual(container.settings, {image, phase:'compile', mounts:[]});
  assert.deepEqual(container.command, ['/bin/sleep','30']);
  assert.deepEqual(container.execCommand, ['/opt/doctor/with-sdk.sh','cjc','--version']);
  assert.equal(container.removed,true); assert.equal(env.bridge.busy,false);
  for (const probe of [{coreCode:1}, {createError:true}, {sdk:'Cangjie Compiler: 0.0.1'}, {cleanupError:true}]) {
    const failed = await setup(t, {probe});
    assert.equal((await failed.service.probe()).available,false);
    assert.equal(failed.bridge.busy,false);
    assert.ok(failed.fakes.instances.every(instance => instance.removed));
  }
});

test('verification uses the archived source, leaves revision unverified, and reloads without an available runner', async t => {
  let called;
  const env = await setup(t, {runner:async (input, options) => { called = {input,options}; return reportFor(input); }});
  await env.ready();
  const before = structuredClone(env.revision), record = await env.service.verify(env.input);
  assert.equal(record.state,'completed'); assert.equal(record.report.status,'passed');
  assert.deepEqual(called.input, {source:{name:before.source.name,text:before.source.text},tests});
  assert.equal(called.options.image,image); assert.equal(called.options.core,env.config.core);
  assert.deepEqual(await env.revisionStore.get(before.revisionId),before);
  assert.equal(before.compileStatus,'not_run'); assert.equal(before.execution.attempted,false);
  const restarted = new VerificationService({root:env.root, platform:'win32'});
  assert.deepEqual(await restarted.get(record.verificationId),record);
  const list = await restarted.list();
  assert.equal(list.verifications.length,1); assert.equal(list.unreadable,0);
  assert.equal(list.verifications[0].compileStatus,'compile_passed'); assert.equal(list.verifications[0].active,false);
  assert.ok(!Object.hasOwn(list.verifications[0], 'revision'));
  await validateVerificationRecord(record);
});

test('requests reject missing consent, source/command/image overrides, invalid IDs and zero/duplicate tests', async t => {
  let called = false;
  const env = await setup(t, {runner:async () => { called = true; }}); await env.ready();
  for (const invalid of [{...env.input,confirmed:false}, {...env.input,source:env.revision.source},
    {...env.input,command:'echo'}, {...env.input,image}, {...env.input,revisionId:'../source'},
    {...env.input,tests:[]}, {...env.input,tests:[tests[0],tests[0]]}])
    await assert.rejects(env.service.verify(invalid), error => error.status === 400);
  assert.equal(called,false); assert.equal(env.bridge.busy,false);
  await assert.rejects(env.service.verify({...env.input, revisionId:'0'.repeat(32)}), error => error.status === 404);
  assert.equal(env.bridge.busy,false);
});

test('shared busy lock is acquired before async source lookup and copies public tests before caller mutation', async t => {
  let releaseLookup, seen;
  const gate = new Promise(resolve => { releaseLookup = resolve; });
  const env = await setup(t, {runner:async input => { seen = input; return reportFor(input); }}); await env.ready();
  env.service.revisionStore = {get:async id => { await gate; return env.revisionStore.get(id); }};
  const pending = env.service.verify(env.input);
  assert.equal(env.bridge.busy,true);
  await assert.rejects(env.service.verify(env.input), error => error.status === 409);
  await assert.rejects(env.service.probe(), error => error.status === 409);
  env.input.tests[0].expectedStdout = 'changed after request';
  releaseLookup();
  const record = await pending;
  assert.equal(seen.tests[0].expectedStdout,'3\n'); assert.equal(record.tests[0].expectedStdout,'3\n');
  assert.equal(env.bridge.busy,false); assert.equal(env.service.active.size,0);
});

test('wrong source hashes, image or test identity cannot become a published success', async t => {
  for (const mutate of [r => r.source.sha256 = '0'.repeat(64), r => r.source.text += '\n',
    r => r.image = 'sha256:' + 'b'.repeat(64), r => r.tests[0].id = 'foreign-test']) {
    const env = await setup(t, {runner:async input => { const report = reportFor(input); mutate(report); return report; }}); await env.ready();
    const record = await env.service.verify(env.input);
    assert.equal(record.state,'failed'); assert.equal(record.report,null);
    assert.deepEqual(await env.service.get(record.verificationId),record);
    assert.equal(env.bridge.busy,false);
  }
});

test('runner exception and already cancelled request persist failure without a success claim', async t => {
  let calls = 0;
  const env = await setup(t, {runner:async () => { calls++; throw new Error('simulated runner failure'); }}); await env.ready();
  const failed = await env.service.verify(env.input);
  assert.equal(failed.state,'failed'); assert.match(failed.detail,/simulated runner failure/);
  const controller = new AbortController(); controller.abort();
  const cancelled = await env.service.verify(env.input,controller.signal);
  assert.equal(cancelled.state,'failed'); assert.equal(cancelled.report,null); assert.match(cancelled.detail,/取消/);
  assert.equal(calls,1); assert.equal((await env.service.list()).verifications.length,2);
  assert.equal(env.bridge.busy,false);
});

test('unconfirmed container removal disables further runs while retaining the tool error evidence', async t => {
  const env = await setup(t, {runner:async input => {
    const report = reportFor(input); report.status = 'tool_error'; report.testStatus = 'incomplete';
    report.detail = 'Synthetic cleanup failure.'; report.containers.at(-1).cleanup = {removed:false,detail:'still exists'};
    return report;
  }}); await env.ready();
  const record = await env.service.verify(env.input);
  assert.equal(record.state,'completed'); assert.equal(record.report.status,'tool_error');
  assert.equal(env.service.health.available,false); assert.equal(env.service.health.code,'cleanup_unconfirmed');
  await assert.rejects(env.service.verify(env.input),error => error.status === 503);
  assert.equal((await env.service.get(record.verificationId)).report.containers.at(-1).cleanup.removed,false);
  const probes = env.fakes.instances.length, nativeCalls = env.fakes.calls.length;
  env.service.lifecycleFactory = async () => { throw new Error('已登记资源清理仍未确认'); };
  assert.equal((await env.service.probe()).available,false);
  assert.equal(env.fakes.instances.length,probes); assert.equal(env.fakes.calls.length,nativeCalls);
  assert.match(env.service.health.detail, /清理仍未确认/);
  assert.equal(env.bridge.busy,false);
  env.service.lifecycleFactory = async () => ({...await fakeLifecycleFactory(), recovered:[{name:record.report.containers.at(-1).name}]});
  assert.equal((await env.service.probe()).available,true);
  assert.equal(env.service.health.recovery.recoveredContainers,1);
  assert.equal((await env.service.get(record.verificationId)).report.containers.at(-1).cleanup.removed,false);
});

test('a new probe cleanup failure keeps execution unavailable after attempted recovery', async t => {
  const env = await setup(t, {probe:{cleanupError:true}});
  assert.equal((await env.service.probe()).code,'cleanup_unconfirmed');
  assert.equal(env.fakes.instances.length,1);
  assert.equal((await env.service.probe()).code,'cleanup_unconfirmed');
  assert.equal(env.fakes.instances.length,2); assert.equal(env.fakes.calls.length,2);
  assert.equal(env.bridge.busy,false);
});

test('workspace lock conflicts stop a probe before native or Docker launch and release the local busy flag', async t => {
  const env = await setup(t, {lifecycleFactory:async () => { throw Object.assign(new Error('另一服务正在验证'), {status:409}); }});
  assert.equal((await env.service.probe()).code,'workspace_busy');
  assert.equal(env.fakes.calls.length,0); assert.equal(env.fakes.instances.length,0); assert.equal(env.bridge.busy,false);
});

test('request-only records show active only in owning service and unknown after restart', async t => {
  let release, started;
  const running = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const env = await setup(t, {runner:async input => { started(); await gate; return reportFor(input); }}); await env.ready();
  const pending = env.service.verify(env.input); await running;
  try {
    const id = [...env.service.active][0];
    const current = await env.service.get(id);
    assert.equal(current.state,'running'); assert.equal(current.report,null);
    assert.equal((await env.service.list()).verifications[0].active,true);
    const restarted = new VerificationService({root:env.root, platform:'win32'});
    const unknown = await restarted.get(id);
    assert.equal(unknown.state,'unknown'); assert.equal(unknown.finishedAt,null); assert.equal(unknown.report,null);
    await validateVerificationRecord(unknown);
    assert.equal((await restarted.list()).verifications[0].active,false);
  } finally { release(); await pending; }
});

test('publication failure retains request and returns an ID with no successful final state', async t => {
  let env;
  env = await setup(t, {runner:async input => {
    const id = [...env.service.active][0];
    await writeFile(join(env.root,'runs/revision-verifications',id,'verification.pending.json'), 'simulate full/occupied pending destination', {flag:'wx'});
    return reportFor(input);
  }}); await env.ready();
  let failedId;
  await assert.rejects(env.service.verify(env.input), error => {
    failedId = error.verificationId; return error.status === 500 && error.verificationState === 'unknown';
  });
  assert.equal((await env.service.get(failedId)).state,'unknown');
  assert.equal(env.bridge.busy,false); assert.equal(env.service.active.size,0);
});

test('terminal report must bind the saved request, and corrupt reports are not hidden by request fallback', async t => {
  const env = await setup(t); await env.ready();
  const record = await env.service.verify(env.input), folder = join(env.root,'runs/revision-verifications',record.verificationId);
  const altered = structuredClone(record); altered.tests[0].stdin = 'different request';
  await writeFile(join(folder,'verification.json'), JSON.stringify(altered));
  await assert.rejects(env.service.get(record.verificationId), /原始请求/);
  assert.equal((await env.service.list()).unreadable,1);
  await writeFile(join(folder,'verification.json'), ' '.repeat(MAX_VERIFICATION_BYTES+1));
  await assert.rejects(env.service.get(record.verificationId), /过大/);
  await writeFile(join(folder,'verification.json'), '{');
  await assert.rejects(env.service.get(record.verificationId), error => error.status === 400);
});

test('verification store refuses linked directories and linked record files', async t => {
  const env = await setup(t), outside = await mkdtemp(join(tmpdir(),'doctor-verification-outside-'));
  t.after(() => rm(outside,{recursive:true,force:true}));
  await symlink(outside,join(env.root,'runs/revision-verifications'),process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(env.service.list(), /链接|路径/);
  await env.ready();
  await assert.rejects(env.service.verify(env.input), /链接|路径/);
  assert.equal(env.bridge.busy,false);
  // File symlinks may require Windows developer mode. The directory check above
  // still runs on every host; the separate file check is tracked as a skip there.
});

test('verification reads reject file symlinks rather than following foreign records', async t => {
  const env = await setup(t); await env.ready();
  const record = await env.service.verify(env.input), base = join(env.root,'runs/revision-verifications');
  const otherId = 'b'.repeat(32), folder = join(base,otherId); await mkdir(folder);
  try { await symlink(join(base,record.verificationId,'request.json'),join(folder,'request.json'),'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows does not permit file symlinks for this account.'); return; }
    throw error;
  }
  await assert.rejects(env.service.get(otherId),error => error.status === 400);
  assert.equal((await env.service.list()).unreadable,1);
});
