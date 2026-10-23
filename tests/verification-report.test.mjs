// Synthetic contract fixtures only. These are not compiler, Docker, or A/B results.
// The base diagnosis is a captured fixture; the manual revision is saved through
// the real RevisionStore before synthetic execution evidence is constructed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RevisionStore } from '../scripts/revision-store.mjs';
import { validatePublicTests, validateVerificationRecord, verificationView, verificationHTML,
  MAX_VERIFICATION_BYTES } from '../web/verification.mjs';

const baseRecord = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const image = 'sha256:' + 'a'.repeat(64);
const digest = value => createHash('sha256').update(value).digest('hex');
const publicTests = [{id:'prints_count',stdin:'',expectedStdout:'3\n'}];
const artifact = Buffer.from([0x7f,0x45,0x4c,0x46]);
function processRecord(stdout='', exitCode=0, stderr='', reason='') {
  return {exitCode,reason,stdout,stderr,stdoutBytes:Buffer.byteLength(stdout),stderrBytes:Buffer.byteLength(stderr),
    stdoutSha256:digest(stdout),stderrSha256:digest(stderr),
    displayEncoding:'UTF-8 replacement; original bytes saved separately',cleanupDetail:''};
}
function normalized(status='compile_passed',rawDiagnostics='',exitCode=0) {
  return {status,parseState:rawDiagnostics ? 'complete' : 'empty',detail:'Synthetic native verdict for contract testing.',
    exitCode,rawDiagnostics,diagnostics:[],testStatus:'not_run'};
}
function container(phase,index) {
  return {name:`doctor-${index.toString(16).padStart(32,'0')}`,phase,policy:{synthetic:true},
    inspection:{image,state:{Running:phase === 'compile',OOMKilled:false,ExitCode:0,Error:''},hostConfig:{synthetic:true},mounts:[]},
    cleanup:{removed:true,detail:'Synthetic cleanup confirmation; no container was created by this fixture.'}};
}
async function fixture(t,{sourceText=baseRecord.source.text.replace('"three"','3'),tests=publicTests}={}) {
  const root = await mkdtemp(join(tmpdir(),'doctor-verification-contract-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const revision = await new RevisionStore(root).save({baseRecord:structuredClone(baseRecord),
    source:{name:baseRecord.source.name,text:sourceText},confirmed:true});
  const time = offset => new Date(Date.parse(revision.createdAt) + offset).toISOString();
  const report = {schemaVersion:1,kind:'doctor-sandbox-verification',id:'b'.repeat(32),
    startedAt:time(1),finishedAt:time(2),developmentOnly:true,scope:'public-tests-only',image,sdkVersion:'1.0.5',
    source:structuredClone(revision.source),status:'passed',
    compile:{status:'compile_passed',process:processRecord(),normalized:normalized()},
    artifact:{sha256:digest(artifact),bytes:artifact.length},
    tests:tests.map(item => ({id:item.id,status:'passed',process:processRecord(item.expectedStdout),
      verdict:{status:'passed',comparison:'exact_bytes',exitCode:0,stdoutMatches:true,
        actualBytes:Buffer.byteLength(item.expectedStdout),expectedBytes:Buffer.byteLength(item.expectedStdout)}})),
    testStatus:'passed',containers:[container('compile',0),...tests.map((_,index) => container('run',index+1))],
    detail:'Synthetic fixture: no compiler, container or formal experiment was run.'};
  return {schemaVersion:1,kind:'doctor-revision-verification',verificationId:'c'.repeat(32),
    createdAt:time(0),finishedAt:time(3),state:'completed',revision,tests:structuredClone(tests),report,
    detail:'Synthetic contract test record.'};
}
async function rejectsMutations(seed,mutations) {
  for (const [name,mutate] of mutations) {
    const record = structuredClone(seed); mutate(record);
    await assert.rejects(validateVerificationRecord(record),{name:'Error'},name);
  }
}

test('complete synthetic evidence binds a real saved manual revision without changing its unverified state',async t => {
  const record = await fixture(t), before = structuredClone(record.revision);
  assert.equal(await validateVerificationRecord(record),record);
  assert.equal(verificationView(record).label,'公开测试通过');
  assert.deepEqual(record.revision,before);
  assert.equal(record.revision.compileStatus,'not_run');
  assert.equal(record.revision.testStatus,'not_run');
  assert.equal(record.revision.execution.attempted,false);
  assert.equal(record.report.source.sha256,digest(record.revision.source.text));
  assert.equal(record.report.artifact.sha256,digest(artifact));
  assert.notEqual(record.verificationId,record.report.id,'request and sandbox task IDs have different purposes');
});

test('record identity, archived source and original diagnosis hashes reject mismatches',async t => {
  await rejectsMutations(await fixture(t),[
    ['invalid request ID',r => r.verificationId = '../outside'],
    ['invalid sandbox task ID',r => r.report.id = 'A'.repeat(32)],
    ['invalid revision ID',r => r.revision.revisionId = 'not-an-id'],
    ['modified source text',r => r.report.source.text += '//later editor content'],
    ['different source name',r => r.report.source.name = 'different.cj'],
    ['different source hash',r => r.report.source.sha256 = '0'.repeat(64)],
    ['edited revision without hash update',r => r.revision.source.text += '//edited'],
    ['modified original diagnosis',r => r.revision.baseRecord.compiler.version += '-tampered'],
    ['different original record hash',r => r.revision.recordSha256 = '0'.repeat(64)],
    ['forged revision compilation',r => r.revision.compileStatus = 'compile_passed'],
    ['reversed report timing',r => r.report.finishedAt = r.createdAt],
    ['foreign record kind',r => r.kind = 'formal-ab-result'],
    ['mutable image tag',r => r.report.image = 'doctor:latest'],
    ['wrong SDK',r => r.report.sdkVersion = '2.0.0'],
  ]);
});

test('test order, identity, output hash and complete result count must match the accepted request',async t => {
  const record = await fixture(t,{tests:[publicTests[0],{id:'second',stdin:'2\n',expectedStdout:'3\n'}]});
  await validateVerificationRecord(record);
  await rejectsMutations(record,[
    ['reordered results',r => r.report.tests.reverse()],
    ['unknown test ID',r => r.report.tests[0].id = 'foreign'],
    ['missing result',r => r.report.tests.pop()],
    ['duplicate requested ID',r => r.tests[1].id = r.tests[0].id],
    ['output hash mismatch',r => r.report.tests[0].process.stdoutSha256 = '0'.repeat(64)],
    ['output text mismatch',r => r.report.tests[0].process.stdout = '4\n'],
    ['changed expectation',r => r.tests[0].expectedStdout = '4\n'],
    ['changed exact-byte count',r => r.report.tests[0].verdict.expectedBytes++],
    ['missing native comparison',r => delete r.report.tests[0].verdict],
  ]);
});

test('nonzero exits, incomplete tests, OOM and missing cleanup cannot be published as a pass',async t => {
  await rejectsMutations(await fixture(t),[
    ['nonzero program exit',r => r.report.tests[0].process.exitCode = 9],
    ['nonzero native exit verdict',r => r.report.tests[0].verdict.exitCode = 9],
    ['stdout comparison failed',r => r.report.tests[0].verdict.stdoutMatches = false],
    ['unfinished test',r => r.report.tests[0].status = 'not_run'],
    ['incomplete aggregate',r => r.report.testStatus = 'incomplete'],
    ['program timeout',r => r.report.tests[0].process.reason = 'timeout'],
    ['runtime OOM',r => r.report.containers[1].inspection.state.OOMKilled = true],
    ['runtime still active',r => r.report.containers[1].inspection.state.Running = true],
    ['runtime exit mismatch',r => r.report.containers[1].inspection.state.ExitCode = 7],
    ['runtime image mismatch',r => r.report.containers[1].inspection.image = 'sha256:'+'d'.repeat(64)],
    ['runtime evidence absent',r => r.report.containers[1].inspection = null],
    ['runtime cleanup unconfirmed',r => r.report.containers[1].cleanup.removed = false],
    ['compile cleanup unconfirmed',r => r.report.containers[0].cleanup.removed = false],
    ['missing independent container',r => r.report.containers.pop()],
    ['wrong compilation phase',r => r.report.containers[0].phase = 'run'],
    ['compiler failed',r => r.report.compile.process.exitCode = 1],
    ['missing compiler verdict',r => delete r.report.compile.normalized],
    ['missing artifact digest',r => delete r.report.artifact.sha256],
    ['invalid artifact size',r => r.report.artifact.bytes = 0],
  ]);
});

test('a passing result requires healthy compile evidence and distinct test container identities',async t => {
  const record = await fixture(t,{tests:[publicTests[0],{id:'second',stdin:'',expectedStdout:'3\n'}]});
  await rejectsMutations(record,[
    ['compile OOM',r => r.report.containers[0].inspection.state.OOMKilled = true],
    ['compile image mismatch',r => r.report.containers[0].inspection.image = 'sha256:'+'d'.repeat(64)],
    ['duplicate test container identity',r => r.report.containers[2].name = r.report.containers[1].name],
    ['no compile container evidence',r => r.report.containers[0].inspection = null],
  ]);
});

test('compile failure retains diagnostics and skips every behavior test',async t => {
  const record = await fixture(t), raw = baseRecord.compiler.stderr;
  record.report.status = 'compile_failed'; record.report.testStatus = 'not_run';
  record.report.compile = {status:'compile_failed',process:processRecord('',1,raw),
    normalized:normalized('compile_failed',raw,1)};
  record.report.tests = record.tests.map(item => ({id:item.id,status:'not_run'}));
  record.report.containers = record.report.containers.slice(0,1);
  delete record.report.artifact;
  await validateVerificationRecord(record);
  assert.equal(verificationView(record).compileLabel,'编译未通过');
  assert.equal(verificationView(record).testLabel,'测试未运行');
  await rejectsMutations(record,[
    ['compile rejection cannot claim tests passed',r => r.report.testStatus = 'passed'],
    ['compile rejection cannot report a passed case',r => r.report.tests[0].status = 'passed'],
    ['non-diagnostic compiler exit',r => r.report.compile.process.exitCode = 42],
  ]);
});

test('output mismatch stays failed even when the program exited normally',async t => {
  const record = await fixture(t), result = record.report.tests[0];
  record.report.status = 'test_failed'; record.report.testStatus = 'failed'; result.status = 'failed';
  result.process = processRecord('4\n');
  result.verdict = {...result.verdict,status:'failed',stdoutMatches:false};
  await validateVerificationRecord(record);
  assert.equal(verificationView(record).label,'公开测试未通过');
  assert.equal(verificationView(record).tone,'error');
  await rejectsMutations(record,[['failed run cannot claim aggregate success',r => r.report.status = 'passed']]);
});

test('failed and residual unknown tasks keep outcomes unconfirmed without reusing an old success report',async t => {
  const seed = await fixture(t);
  for (const state of ['running','unknown','failed']) {
    const record = structuredClone(seed); record.state = state; record.report = null;
    if (state !== 'failed') record.finishedAt = null;
    record.detail = 'Synthetic interrupted task.';
    await validateVerificationRecord(record);
    assert.notEqual(verificationView(record).tone,'success');
    assert.notEqual(verificationView(record).testLabel,'公开测试通过');
    const stale = structuredClone(record); stale.report = seed.report;
    await assert.rejects(validateVerificationRecord(stale));
  }
  const emptyFailure = {...structuredClone(seed),state:'failed',report:null,detail:''};
  await assert.rejects(validateVerificationRecord(emptyFailure));
});

test('cleanup failure remains an incomplete tool result and cannot retain a passed aggregate label',async t => {
  const record = await fixture(t);
  record.report.status = 'tool_error'; record.report.testStatus = 'incomplete';
  record.report.detail = 'Synthetic container removal failed.';
  record.report.containers[1].cleanup = {removed:false,detail:'Synthetic still-existing container.'};
  await validateVerificationRecord(record);
  assert.equal(verificationView(record).label,'验证工具异常');
  assert.equal(verificationView(record).testLabel,'测试未完成');
  const forged = structuredClone(record); forged.report.testStatus = 'passed';
  await assert.rejects(validateVerificationRecord(forged));
});

test('public input limits count UTF-8 bytes and accepted requests are copied',() => {
  const boundary = [{id:'x'.repeat(40),stdin:'中'.repeat(1365)+'x',expectedStdout:'x'.repeat(16384)}];
  const accepted = validatePublicTests(boundary);
  assert.deepEqual(accepted,boundary); accepted[0].stdin = 'changed';
  assert.equal(Buffer.byteLength(boundary[0].stdin),4096);
  assert.deepEqual(validatePublicTests([],{allowEmpty:true}),[]);
  assert.equal(validatePublicTests(Array.from({length:8},(_,i) => ({id:String(i),stdin:'',expectedStdout:''}))).length,8);
  for (const bad of [[],Array.from({length:9},(_,i) => ({id:String(i),stdin:'',expectedStdout:''})),
    [publicTests[0],publicTests[0]], [{...publicTests[0],id:'../outside'}], [{...publicTests[0],id:'x'.repeat(41)}],
    [{...publicTests[0],stdin:'中'.repeat(1366)}], [{...publicTests[0],expectedStdout:'x'.repeat(16385)}],
    [{...publicTests[0],stdin:'\ud800'}], [{...publicTests[0],command:'shell'}]])
    assert.throws(() => validatePublicTests(bad));
});

test('oversized reports and invalid process byte boundaries are rejected before rendering',async t => {
  const record = await fixture(t), oversized = structuredClone(record);
  oversized.report.syntheticPadding = 'x'.repeat(MAX_VERIFICATION_BYTES);
  await assert.rejects(validateVerificationRecord(oversized),/大小限制/);
  await rejectsMutations(record,[
    ['runtime stream total over limit',r => r.report.tests[0].process.stderrBytes = 65536],
    ['negative stream size',r => r.report.compile.process.stdoutBytes = -1],
    ['fractional stream size',r => r.report.compile.process.stdoutBytes = 0.5],
    ['malformed digest',r => r.report.compile.process.stderrSha256 = 'not-a-hash'],
    ['malformed Unicode display',r => r.report.tests[0].process.stderr = '\ud800'],
  ]);
});

test('standalone HTML escapes hostile source, public input, output and detail while retaining provenance',async t => {
  const payload = '</pre></title><script>alert("synthetic")</script><img src="https://invalid.example/" onerror="alert(1)"> & \'quoted\'';
  const record = await fixture(t,{sourceText:baseRecord.source.text.replace('"three"','3')+'// '+payload+'\n',
    tests:[{id:'escape_case',stdin:payload,expectedStdout:payload+'\n'}]});
  record.detail = payload; record.report.detail = payload;
  record.report.compile.process = processRecord('compiler stdout '+payload,0,'compiler stderr '+payload);
  await validateVerificationRecord(record);
  const html = verificationHTML(record);
  assert.match(html,/^<!doctype html>/);
  assert.match(html,/&lt;\/pre&gt;&lt;\/title&gt;&lt;script&gt;/);
  assert.match(html,/&quot;synthetic&quot;/);
  assert.match(html,/&#39;quoted&#39;/);
  assert.doesNotMatch(html,/<(?:script|img|iframe|object|embed|link|form|a)\b/i);
  assert.equal((html.match(/<title>/g) || []).length,1);
  assert.equal((html.match(/<\/title>/g) || []).length,1);
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
  for (const identity of [record.verificationId,record.revision.revisionId,record.revision.source.sha256,
    record.revision.recordSha256,image]) assert.ok(html.includes(identity),`missing provenance ${identity}`);
  assert.ok(html.includes('没有保留测试、模型修复或正式 A/B 结论'));
  assert.ok(html.includes('判定方式：比较原始字节（包含尾部换行）'));
  assert.ok(html.includes('compiler stdout &lt;/pre&gt;'));
  assert.ok(html.includes('compiler stderr &lt;/pre&gt;'));
  assert.ok(html.includes('可能与编辑器当前内容不同'));
});

test('unknown-task HTML cannot claim cleanup or test success from a missing terminal record',async t => {
  const record = await fixture(t); record.state = 'unknown'; record.report = null; record.finishedAt = null;
  await validateVerificationRecord(record);
  const html = verificationHTML(record);
  assert.match(html,/状态待确认/);
  assert.match(html,/未取得全部清理确认/);
  assert.doesNotMatch(html,/公开测试通过|本次记录中的容器均确认不存在/);
});
