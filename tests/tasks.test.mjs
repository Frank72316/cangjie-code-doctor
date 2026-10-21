// Deliberately injected transport faults; these are not compiler or A/B results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { NativeBridge, runNative } from '../scripts/native-bridge.mjs';
import { TaskStore } from '../scripts/task-store.mjs';
import { makeServer } from '../scripts/preview.mjs';
import { taskLabel } from '../web/task.mjs';
const hello = JSON.parse(await readFile(new URL('fixtures/hello.json',import.meta.url),'utf8'));
async function workspace() { await mkdir('runs',{recursive:true}); return resolve(await mkdtemp('runs/task-check-')); }
function outcome(values={}) { return {code:0,signal:null,stdout:'',stderr:'',reason:'',...values}; }
function bridgeFor(root,executor) {
  const bridge = new NativeBridge({root,executable:'test-only-core',compiler:'test-only-compiler',executor});
  bridge.health = {available:true}; return bridge;
}
async function publish(args) {
  const [,root,,caseId,taskId,capturedAt] = args;
  const record = {...structuredClone(hello),producer:'cangjie-core',taskId,capturedAt,
    normalized:{status:'compile_passed',parseState:'empty',detail:'',exitCode:0,rawDiagnostics:'',testStatus:'not_run',diagnostics:[]}};
  assert.equal(caseId,'hello');
  const directory = join(root,'runs/native',taskId);
  await mkdir(directory,{recursive:true}); await writeFile(join(directory,'record.json'),JSON.stringify(record));
  return record;
}

test('task acceptance precedes launch; concurrent requests do not create extra tasks', async () => {
  const root = await workspace(); let release, entered;
  const began = new Promise(r=>entered=r), gate = new Promise(r=>release=r);
  let bridge;
  bridge = bridgeFor(root,async (_,args)=>{
    const history = await bridge.history();
    assert.equal(history.tasks[0].state,'running');
    assert.equal(JSON.parse(await readFile(join(root,'runs/tasks',args[4],'start.json'))).state,'running');
    entered(); await gate; return outcome({stdout:JSON.stringify(await publish(args))});
  });
  const pending = bridge.compile('hello'); await began;
  await assert.rejects(bridge.compile('hello'),e=>e.status===409);
  release(); const record = await pending;
  const history = await bridge.history(); assert.equal(history.tasks.length,1);
  assert.equal(history.tasks[0].state,'completed'); assert.equal(history.tasks[0].record.taskId,record.taskId);
  assert.equal(bridge.busy,false);
});

test('native launch failure survives service restart with exit evidence', async () => {
  const root = await workspace();
  const bridge = new NativeBridge({root,executable:join(root,'missing-executable'),compiler:'unused'});
  bridge.health = {available:true}; // Simulates disappearance after a successful probe.
  await assert.rejects(bridge.compile('hello'),e=>e.taskState==='failed' && !!e.taskId);
  const restarted = new NativeBridge({root});
  const task = (await restarted.history()).tasks[0];
  assert.equal(task.state,'failed'); assert.equal(task.reason,'ENOENT');
  assert.equal(task.record,undefined); assert.ok(task.finishedAt); assert.equal(taskLabel(task),'任务异常');
});

test('cancel, deadline, signal and excessive output retain distinct terminal causes', async () => {
  for (const [reason,signal,state] of [['cancelled',null,'cancelled'],['timeout',null,'timed_out'],['', 'SIGSEGV','failed'],['output_limit',null,'failed']]) {
    const root = await workspace();
    const bridge = bridgeFor(root,async()=>outcome({code:null,reason,signal,stderr:'x'.repeat(20000)}));
    await assert.rejects(bridge.compile('hello'),e=>e.taskState===state);
    const task = (await bridge.history()).tasks[0];
    assert.equal(task.state,state); assert.equal(task.reason,reason||signal);
    assert.equal(task.process.stderr.truncated,true); assert.equal(task.process.stderr.text.length,16384);
    assert.equal(task.record,undefined); assert.equal(bridge.busy,false);
  }
});

test('cancellation retains a record already published but never changes cancelled to passed', async () => {
  const root = await workspace();
  const bridge = bridgeFor(root,async(_,args)=>{ await publish(args); return outcome({code:null,reason:'cancelled'}); });
  await assert.rejects(bridge.compile('hello'),e=>e.taskState==='cancelled');
  const task = (await bridge.history()).tasks[0];
  assert.equal(task.state,'cancelled'); assert.equal(taskLabel(task),'已取消');
  assert.equal(task.record.normalized.status,'compile_passed');
});

test('late cancellation cannot rewrite a completed process and persisted result', async () => {
  const controller = new AbortController();
  const bridge = bridgeFor(await workspace(),async(_,args)=>{
    const record = await publish(args); controller.abort(); return outcome({stdout:JSON.stringify(record)});
  });
  await bridge.compile('hello',controller.signal);
  assert.equal((await bridge.history()).tasks[0].state,'completed');
});

test('stdout alone, mismatched disk records and corrupt hashes cannot count as completed', async () => {
  for (const kind of ['missing','different','hash']) {
    const root = await workspace();
    const bridge = bridgeFor(root,async(_,args)=>{
      let record;
      if (kind === 'missing') record = {...hello,taskId:args[4]};
      else {
        record = await publish(args);
        if (kind === 'different') record.capturedAt = '2000-01-01T00:00:00.000Z';
        else { record.source.sha256 = '0'.repeat(64); await writeFile(join(root,'runs/native',args[4],'record.json'),JSON.stringify(record)); }
      }
      return outcome({stdout:JSON.stringify(record)});
    });
    await assert.rejects(bridge.compile('hello'),e=>e.taskState==='failed');
    assert.equal((await bridge.history()).tasks[0].state,'failed');
  }
});

test('a pre-cancelled request never launches a native process', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runNative('not-an-executable',[],{signal:controller.signal});
  assert.equal(result.reason,'cancelled'); assert.equal(result.code,null);
});

test('failure to persist the final state is not returned as a successful task', async () => {
  const bridge = bridgeFor(await workspace(),async(_,args)=>outcome({stdout:JSON.stringify(await publish(args))}));
  bridge.store.finish = async()=>{throw new Error('Injected disk failure');};
  await assert.rejects(bridge.compile('hello'),/状态保存失败/);
  const task = (await bridge.history()).tasks[0];
  assert.equal(task.state,'unknown'); assert.equal(task.record.normalized.status,'compile_passed');
  assert.equal(bridge.busy,false);
});

test('a completed journal with a lost or oversized diagnostic cannot claim a pass', async () => {
  const root = await workspace(), store = new TaskStore(root), id = 'e'.repeat(32);
  const task = await store.begin(id,'hello');
  await store.finish({...task,state:'completed',finishedAt:new Date().toISOString(),reason:'',detail:'Injected test completion'});
  assert.equal((await store.history()).tasks[0].state,'unknown');
  const directory = join(root,'runs/native',id); await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'record.json'),' '.repeat(2*1024*1024+1));
  const history = await store.history();
  assert.equal(history.tasks[0].state,'unknown'); assert.equal(history.unreadable,1);
});

test('missing final state distinguishes dead service from a still-live owner', async () => {
  const root = await workspace(), store = new TaskStore(root);
  const live = await store.begin('a'.repeat(32),'hello');
  const dead = await store.begin('b'.repeat(32),'hello');
  const child = spawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  dead.ownerPid = child.pid;
  await writeFile(join(root,'runs/tasks',dead.taskId,'start.json'),JSON.stringify(dead));
  const history = await store.history();
  assert.equal(history.tasks.find(t=>t.taskId===live.taskId).state,'unknown');
  const recovered = history.tasks.find(t=>t.taskId===dead.taskId);
  assert.equal(recovered.state,'interrupted'); assert.equal(recovered.finishedAt,null);
  assert.equal((await store.history(new Set([live.taskId]))).tasks.find(t=>t.taskId===live.taskId).state,'running');
});

test('corrupt completion cannot hide other tasks or be silently shown as success', async () => {
  const root = await workspace(), store = new TaskStore(root);
  const first = await store.begin('c'.repeat(32),'hello');
  await store.finish({...first,state:'failed',reason:'test_fault',detail:'Deliberate test fault',finishedAt:new Date().toISOString()});
  const second = await store.begin('d'.repeat(32),'hello');
  await writeFile(join(root,'runs/tasks',second.taskId,'finish.json'),'{');
  const history = await store.history();
  assert.equal(history.tasks.length,2); assert.equal(history.unreadable,1);
  assert.equal(history.tasks.find(t=>t.taskId===second.taskId).state,'unknown');
  assert.equal(history.tasks.find(t=>t.taskId===first.taskId).state,'failed');
});

test('a corrupt task receipt cannot fall back to a successful legacy task', async () => {
  const root = await workspace(), store = new TaskStore(root), id = 'f'.repeat(32);
  const task = await store.begin(id,'hello');
  await publish(['compile-example',root,'unused','hello',id,task.startedAt]);
  await writeFile(join(root,'runs/tasks',id,'start.json'),'{');
  const history = await store.history();
  assert.equal(history.tasks.length,0); assert.equal(history.unreadable,1);
});

test('task storage refuses a runs junction outside the selected repository', async () => {
  const root = await workspace(), outside = await workspace();
  await symlink(outside,join(root,'runs'),process.platform==='win32'?'junction':'dir');
  let launched = false;
  const bridge = bridgeFor(root,async()=>{launched=true;return outcome();});
  await assert.rejects(bridge.compile('hello'),/目录不在项目内/);
  assert.equal(launched,false); assert.equal(bridge.busy,false);
});

test('HTTP disconnect finalizes cancellation and history remains readable', async t => {
  let entered;
  const began = new Promise(r=>entered=r);
  const bridge = bridgeFor(await workspace(),async(_,args,{signal})=>{
    entered();
    await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',resolve,{once:true});});
    return outcome({code:null,reason:'cancelled'});
  });
  const server = makeServer({bridge}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`, controller = new AbortController();
  const pending = fetch(base+'/api/compile-example',{method:'POST',headers:{'Content-Type':'application/json','X-Doctor-Token':bridge.token},
    body:JSON.stringify({caseId:'hello'}),signal:controller.signal});
  await began;
  const running = await (await fetch(base+'/api/history',{headers:{'X-Doctor-Token':bridge.token}})).json();
  assert.equal(running.tasks[0].state,'running'); assert.equal(running.busy,true);
  controller.abort(); await assert.rejects(pending,e=>e.name==='AbortError');
  for(let i=0;i<100 && bridge.busy;i++) await new Promise(r=>setTimeout(r,20));
  const finished = await (await fetch(base+'/api/history',{headers:{'X-Doctor-Token':bridge.token}})).json();
  assert.equal(finished.tasks[0].state,'cancelled'); assert.equal(finished.busy,false);
});
