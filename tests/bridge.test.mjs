import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeBridge, runNative } from '../scripts/native-bridge.mjs';
import { makeServer } from '../scripts/preview.mjs';
import { readRecord, compileView } from '../web/report.mjs';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
const original = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json', import.meta.url), 'utf8'));
function nativeRecord() {
  const r = structuredClone(original), d = JSON.parse(r.compiler.stderr).Diags[0];
  return {...r, producer:'cangjie-core', taskId:'a'.repeat(32), normalized:{status:'compile_failed', parseState:'complete', detail:'',
    exitCode:r.compiler.exitCode, rawDiagnostics:r.compiler.stderr, testStatus:'not_run', diagnostics:[{
      code:d.DiagKind,severity:d.Severity,message:d.Message,hint:d.MainHint.Content,file:d.Location.File,line:d.Location.Line,column:d.Location.Column}]}};
}
test('native records use normalized output and reject mismatched evidence', async () => {
  const r = nativeRecord();
  assert.equal(compileView(await readRecord(JSON.stringify(r))).diagnostics[0].line, 2);
  r.normalized.rawDiagnostics = '{}';
  await assert.rejects(readRecord(JSON.stringify(r)), /不一致/);
});
test('a claimed native pass cannot override a failing compiler', async () => {
  const r = nativeRecord(); r.normalized.status = 'compile_passed';
  await assert.rejects(readRecord(JSON.stringify(r)), /矛盾/);
  const legacy = structuredClone(original); legacy.compiler.exitCode = 11;
  assert.equal(compileView(legacy).status, 'tool_error');
});
test('transport rejects foreign origin, host, missing token, source text and unknown case', async t => {
  let called = 0;
  const bridge = {health:{available:true}, token:'test-token', busy:false, history:async()=>({tasks:[],unreadable:0}),
    compile:async()=>{called++; return nativeRecord();}};
  const server = makeServer({bridge}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'Content-Type':'application/json','X-Doctor-Token':bridge.token};
  async function post(body, extra={}) { return fetch(base+'/api/compile-example',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)}); }
  assert.equal((await post({caseId:'hello'}, {'X-Doctor-Token':''})).status, 403);
  assert.equal((await post({caseId:'hello'}, {Origin:'https://example.com'})).status, 403);
  const foreignHost = await new Promise((resolve,reject) => {
    const r = request(base+'/api/compile-example',{method:'POST',headers:{...headers,Host:'attacker.example'}}, response=>{
      response.resume(); resolve(response.statusCode);
    }); r.on('error',reject); r.end(JSON.stringify({caseId:'hello'}));
  });
  assert.equal(foreignHost,403);
  assert.equal((await post({caseId:'../../file'})).status, 400);
  assert.equal((await post({caseId:'hello',source:'main() {}'})).status, 400);
  assert.equal((await post({caseId:'x'.repeat(1100)})).status, 413);
  assert.equal(called, 0);
  assert.equal((await post({caseId:'hello'})).status, 200); assert.equal(called, 1);
});
test('unconfigured backend returns unavailable without starting compilation', async () => {
  const bridge = new NativeBridge({root:process.cwd()});
  assert.equal((await bridge.probe()).available, false);
  await assert.rejects(bridge.compile('hello'), e=>e.status===503);
  await assert.rejects(bridge.compile('../hello'), e=>e.status===400);
});
test('failed process startup is reported explicitly', async () => {
  const r = await runNative(join(process.cwd(),'missing-native-executable'), [], {timeout:500});
  assert.ok(r.reason); assert.notEqual(r.code, 0);
});
test('process cancellation and deadline terminate the test process', async () => {
  const controller = new AbortController();
  const pending = runNative(process.execPath, ['-e','setInterval(()=>{},1000)'], {signal:controller.signal,timeout:5000});
  setTimeout(()=>controller.abort(),100);
  assert.equal((await pending).reason, 'cancelled');
  const deadline = await runNative(process.execPath, ['-e','setInterval(()=>{},1000)'], {timeout:100});
  assert.equal(deadline.reason, 'timeout');
});
test('history includes only complete matching native tasks', async () => {
  await mkdir('runs',{recursive:true}); const root = await mkdtemp('runs/history-check-');
  const r = nativeRecord(), directory = join(root,'runs/native',r.taskId);
  await mkdir(directory,{recursive:true}); await writeFile(join(directory,'record.json'),JSON.stringify(r));
  await mkdir(join(root,'runs/native','b'.repeat(32)),{recursive:true});
  await writeFile(join(root,'runs/native','b'.repeat(32),'record.pending.json'),'{');
  const bridge = new NativeBridge({root}); const history = await bridge.history();
  assert.equal(history.tasks.length,1); assert.equal(history.tasks[0].taskId,r.taskId);
  assert.equal(history.unreadable,1);
});
