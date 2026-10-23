// Synthetic orchestration fault tests; real Docker/Cangjie acceptance runs separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateVerification, verifyPublic } from '../scripts/sandbox-verify.mjs';

const image = 'sha256:' + 'a'.repeat(64);
const request = {source:{name:'input.cj', text:'main() { println("hello") }\n'}, tests:[{id:'hello', stdin:'', expectedStdout:'hello\n'}]};
const result = (stdout='', code=0, reason='', stderr='') => ({stdout:Buffer.from(stdout),stderr:Buffer.from(stderr),code,reason});
function fakeDependencies(options={}) {
  const instances = [], nativeCalls = [];
  const containerFactory = config => {
    const container = {
      config, name:`doctor-${String(instances.length).padStart(32,'0')}`, policy:{synthetic:true}, removed:false,
      async create(command) { this.command = command; if (options.createError) throw new Error('create failed'); },
      async start(settings) {
        this.settings = settings;
        if (config.phase === 'compile') return result();
        return result(options.output ?? 'hello\n', options.runExit ?? 0, options.runReason ?? '', options.stderr ?? '');
      },
      async exec(command) {
        if (command.includes('--version')) return result('Cangjie Compiler: 1.0.5 (synthetic)');
        if (command[0] === '/bin/cat') return result(options.badArtifact ? 'missing ELF' : Buffer.from([127,69,76,70,1]));
        return result('', options.compileExit ?? 0, '', options.compileExit ? '{"synthetic":true}' : '');
      },
      async inspect() {
        return {Image:image,State:{Running:config.phase === 'compile',OOMKilled:Boolean(options.oom && config.phase === 'run'),ExitCode:options.runExit ?? 0,Error:''},HostConfig:{synthetic:true},Mounts:config.mounts};
      },
      async remove() { this.removed = true; return {removed:!options.cleanupError,detail:options.cleanupError ? 'simulated cleanup failure' : ''}; }
    };
    instances.push(container); return container;
  };
  const executor = async (binary, args, settings) => {
    nativeCalls.push(args);
    if (args[0] === '--version') return {code:0,stdout:'Cangjie Code Doctor 0.3.0',reason:''};
    if (args[0] === 'parse') return {code:0,stdout:JSON.stringify({status:options.compileExit === 1 ? 'compile_failed' : 'compile_passed'}),reason:''};
    const actual = await readFile(resolve(settings.cwd,args[1]));
    const expected = await readFile(resolve(settings.cwd,args[2]));
    const exitCode = Number(args[3]);
    return {code:0,reason:'',stdout:JSON.stringify({status:exitCode ? 'runtime_error' : actual.equals(expected) ? 'passed' : 'failed',exitCode,comparison:'exact_bytes'})};
  };
  return {containerFactory,executor,platform:'linux',instances,nativeCalls};
}
async function run(t, options={}, input=request) {
  const root = await mkdtemp(join(tmpdir(),'doctor-verify-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const deps = fakeDependencies(options);
  const report = await verifyPublic(input,{root,image,core:join(root,'doctor')},deps);
  const directory = join(root,'runs','verification',report.id);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'report.json'),'utf8')),report);
  assert.equal(await readFile(join(directory,'input.cj'),'utf8'),input.source.text);
  assert.ok(deps.instances.every(instance => instance.removed));
  return {report,deps,directory};
}
test('verification rejects paths, extra command fields, malformed Unicode, oversized and duplicate tests', () => {
  for (const bad of [ {...request,command:'shell'}, {...request,source:{...request.source,name:'../bad.cj'}},
    {...request,source:{...request.source,text:'\ud800'}}, {...request,source:{...request.source,text:'a\n'.repeat(201)}},
    {...request,tests:[request.tests[0],request.tests[0]]}, {...request,tests:[{...request.tests[0],stdin:'x'.repeat(4097)}]} ]) {
    assert.throws(() => validateVerification(bad));
  }
  const copy=validateVerification(request); copy.tests[0].stdin='changed'; assert.equal(request.tests[0].stdin,'');
});
test('fresh test containers receive only artifact and stdin; native core compares host-only expected bytes', async t => {
  const {report,deps,directory} = await run(t,{}, {...request, tests:[request.tests[0],{...request.tests[0],id:'second'}]});
  assert.equal(report.status,'passed'); assert.equal(report.testStatus,'passed');
  assert.equal(report.containers.length,3);
  assert.equal(deps.nativeCalls.filter(args => args[0]==='check-output').length,2);
  assert.equal(deps.instances[0].config.mounts[0].target,'/input/input.cj');
  for (const c of deps.instances.slice(1)) {
    assert.equal(c.config.mounts.length,1); assert.equal(c.config.mounts[0].target,'/input/program');
    assert.deepEqual(c.command,['/usr/bin/timeout','--signal=KILL','5s','/input/program']);
    assert.deepEqual(c.settings.stdin,Buffer.alloc(0));
  }
  assert.ok((await readdir(directory)).includes('test-1.stdout'));
});
test('compile rejection skips artifact execution and all tests',async t => {
  const {report,deps}=await run(t,{compileExit:1});
  assert.equal(report.status,'compile_failed'); assert.equal(report.testStatus,'not_run'); assert.equal(deps.instances.length,1);
});
test('missing valid artifact cannot turn compilation into success',async t => {
  const {report,deps}=await run(t,{badArtifact:true});
  assert.equal(report.status,'tool_error'); assert.equal(report.testStatus,'not_run'); assert.equal(deps.instances.length,1);
});
test('exact stdout mismatch fails even with zero exit; stderr alone is retained without changing stdout verdict',async t => {
  const mismatch=await run(t,{output:'hello\r\n'}); assert.equal(mismatch.report.status,'test_failed');
  const stderr=await run(t,{stderr:'diagnostic\n'}); assert.equal(stderr.report.status,'passed'); assert.equal(stderr.report.tests[0].process.stderr,'diagnostic\n');
});
test('nonzero exit and OOM never pass matching output',async t => {
  const failed=await run(t,{runExit:42}); assert.equal(failed.report.tests[0].status,'runtime_error');
  const oom=await run(t,{oom:true}); assert.equal(oom.report.tests[0].status,'oom'); assert.equal(oom.report.status,'test_failed');
});
test('timeout/output limit stay failed; infrastructure launch failure stays tool error',async t => {
  for (const reason of ['timeout','output_limit']) {
    const {report}=await run(t,{runReason:reason}); assert.equal(report.tests[0].status,reason); assert.equal(report.status,'test_failed');
  }
  const {report}=await run(t,{runReason:'launch_error'}); assert.equal(report.status,'tool_error'); assert.equal(report.testStatus,'incomplete');
});
test('cleanup failure overrides otherwise successful compilation and saves failure evidence',async t => {
  const {report}=await run(t,{cleanupError:true});
  assert.equal(report.status,'tool_error'); assert.match(report.detail,/cleanup failed/); assert.equal(report.containers[0].cleanup.removed,false);
});
test('create failure still removes known container name and writes a terminal report',async t => {
  const {report}=await run(t,{createError:true}); assert.equal(report.status,'tool_error'); assert.match(report.detail,/create failed/);
});
test('zero tests means not run, never repaired or passed',async t => {
  const {report,deps}=await run(t,{}, {...request,tests:[]});
  assert.equal(report.compile.status,'compile_passed'); assert.equal(report.status,'not_run'); assert.equal(report.testStatus,'not_run'); assert.equal(deps.instances.length,1);
});
test('unsupported host and mutable image tags fail before starting containers',async () => {
  await assert.rejects(verifyPublic(request,{image,core:'doctor'},{platform:'win32'}),/requires Linux/);
  await assert.rejects(verifyPublic(request,{image:'doctor:latest',core:'doctor'},{platform:'linux'}),/exact locally built image/);
});
