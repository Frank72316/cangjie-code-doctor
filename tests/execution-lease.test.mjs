// Actual Linux flock / child-process tests. No simulated lock is treated as OS
// evidence; non-Linux hosts explicitly skip the real ownership checks below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, lstat, writeFile, rename, rm, symlink, link, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireExecutionLease, EXECUTION_LOCK_NAME } from '../scripts/execution-lease.mjs';
import { runSandboxProcess } from '../scripts/sandbox-container.mjs';

const linux = {skip:process.platform !== 'linux' && 'Actual Linux flock checks require Linux; no simulated pass.'};
const moduleURL = new URL('../scripts/execution-lease.mjs',import.meta.url).href;
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function temporary(t) {
  const root=await mkdtemp(join(tmpdir(),'doctor-execution-lease-'));
  t.after(() => rm(root,{recursive:true,force:true})); return root;
}
const ownerProgram = `
  import { spawn } from 'node:child_process';
  const { acquireExecutionLease } = await import(process.argv[1]);
  const lease=await acquireExecutionLease(process.argv[2]);
  const failsafe=setTimeout(()=>process.exit(90),15000);
  process.stdout.write(JSON.stringify({event:'owned',pid:process.pid})+'\\n');
  if(process.argv[3]==='inherit') {
    const child=spawn(process.execPath,['--input-type=module','-e',
      "import { fstatSync } from 'node:fs'; fstatSync(3); process.stdout.write('ready\\\\n'); setTimeout(()=>process.exit(91),10000);"],
      {stdio:['ignore','pipe','pipe',lease.fd]});
    child.stdout.once('data',()=>process.stdout.write(JSON.stringify({event:'inherited',pid:child.pid})+'\\n'));
    child.stderr.on('data',chunk=>process.stderr.write(chunk));
  }
  process.stdin.setEncoding('utf8');
  process.stdin.on('data',async chunk=>{
    if(chunk.includes('release')) { await lease.release(); clearTimeout(failsafe); process.exit(0); }
  });
`;
function owner(root,mode='') {
  const child=spawn(process.execPath,['--input-type=module','-e',ownerProgram,moduleURL,root,mode],{stdio:['pipe','pipe','pipe']});
  let output='', stderr=''; const messages=[];
  child.stdout.on('data',chunk => {
    output+=chunk;
    let end;
    while((end=output.indexOf('\n'))!==-1) {
      const line=output.slice(0,end); output=output.slice(end+1);
      try { messages.push(JSON.parse(line)); } catch { messages.push({event:'invalid',line}); }
    }
  });
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const ended=once(child,'close');
  return {child,ended,async message(event) {
    const until=Date.now()+5000;
    while(Date.now()<until) {
      const found=messages.find(item=>item.event===event); if(found) return found;
      if(child.exitCode!==null || child.signalCode) throw new Error(`Owner exited before ${event}: ${stderr}`);
      await delay(10);
    }
    throw new Error(`Owner did not send ${event}: ${stderr} ${output}`);
  }};
}
async function stopOwner(worker) {
  if(worker.child.exitCode===null && !worker.child.signalCode) worker.child.kill('SIGKILL');
  await worker.ended;
}
async function tryFromProcess(root) {
  const program=`
    const { acquireExecutionLease }=await import(process.argv[1]);
    try { const lease=await acquireExecutionLease(process.argv[2]); await lease.assertHeld(); await lease.release();
      process.stdout.write(JSON.stringify({acquired:true})); }
    catch(error) { process.stdout.write(JSON.stringify({acquired:false,status:error.status,code:error.code,message:error.message})); }
  `;
  const child=spawn(process.execPath,['--input-type=module','-e',program,moduleURL,root],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr=''; child.stdout.on('data',chunk=>{stdout+=chunk;}); child.stderr.on('data',chunk=>{stderr+=chunk;});
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try {
    const [code,signal]=await once(child,'close');
    assert.equal(signal,null,stderr); assert.equal(code,0,stderr); return JSON.parse(stdout);
  } finally { clearTimeout(timer); }
}

test('unsupported host refuses OS ownership instead of using a simulated lock', {skip:process.platform === 'linux'},async t => {
  await assert.rejects(acquireExecutionLease(await temporary(t)),error => error.status===503 && error.code==='execution_lock_unavailable');
});

test('real flock child exit preserves the parent FD lock; another process enters only after release',linux,async t => {
  const root=await temporary(t), lease=await acquireExecutionLease(root);
  t.after(()=>lease.release());
  const path=join(root,'runs',EXECUTION_LOCK_NAME), before=await lstat(path);
  assert.ok(Number.isInteger(lease.fd)); assert.equal(await lease.assertHeld(),true); assert.equal(lease.signal.aborted,false);
  const blocked=await tryFromProcess(root);
  assert.equal(blocked.acquired,false); assert.equal(blocked.status,409); assert.equal(blocked.code,'execution_locked');
  await lease.release(); await lease.release();
  assert.equal(lease.signal.aborted,true); await assert.rejects(lease.assertHeld(),error=>error.code==='execution_lease_lost');
  assert.throws(()=>lease.fd,error=>error.code==='execution_lease_lost');
  assert.deepEqual(await tryFromProcess(root),{acquired:true});
  const after=await lstat(path); assert.equal(after.ino,before.ino); assert.equal(after.dev,before.dev);
  assert.equal(await readFile(path,'utf8'),'','acquisition/release must not rewrite stable inode content');
});

test('another live service cannot be displaced, and process death releases its real OS lock',linux,async t => {
  const root=await temporary(t), worker=owner(root); t.after(()=>stopOwner(worker));
  await worker.message('owned');
  await assert.rejects(acquireExecutionLease(root),error=>error.status===409 && error.code==='execution_locked');
  assert.equal(worker.child.exitCode,null,'contender must not terminate the current owner');
  await stopOwner(worker);
  const next=await acquireExecutionLease(root); await next.assertHeld(); await next.release();
});

test('an inherited child FD retains ownership after parent death until the child actually exits',linux,async t => {
  const root=await temporary(t), worker=owner(root,'inherit'); let childPid;
  t.after(async()=>{
    await stopOwner(worker);
    if(childPid) { try { process.kill(childPid,'SIGKILL'); } catch(error) { if(error.code!=='ESRCH') throw error; } }
  });
  await worker.message('owned'); childPid=(await worker.message('inherited')).pid;
  assert.ok(Number.isInteger(childPid)); await stopOwner(worker);
  await assert.rejects(acquireExecutionLease(root),error=>error.status===409 && error.code==='execution_locked');
  process.kill(childPid,'SIGTERM');
  let next;
  for(let attempt=0;attempt<100 && !next;attempt++) {
    try { next=await acquireExecutionLease(root); }
    catch(error) { if(error.code!=='execution_locked') throw error; await delay(20); }
  }
  assert.ok(next,'lease should become available only once the inherited child closes its FD');
  childPid=null; await next.release();
});

test('different roots have independent locks while aliases of the same root contend',linux,async t => {
  const first=await temporary(t), second=await temporary(t), aliases=await temporary(t);
  const a=await acquireExecutionLease(first), b=await acquireExecutionLease(second);
  t.after(()=>a.release()); t.after(()=>b.release());
  await symlink(first,join(aliases,'same-root'),'dir');
  await assert.rejects(acquireExecutionLease(join(aliases,'same-root')),error=>error.code==='execution_locked');
  await a.release(); assert.equal(await b.assertHeld(),true);
  assert.deepEqual(await tryFromProcess(first),{acquired:true});
  assert.equal((await tryFromProcess(second)).code,'execution_locked');
});

test('runSandboxProcess actually passes leaseFd and keeps excluding another process after parent release',linux,async t => {
  const root=await temporary(t), lease=await acquireExecutionLease(root), controller=new AbortController();
  const ready=join(root,'child-ready.json'), finish=join(root,'child-finish');
  const original=await lstat(join(root,'runs',EXECUTION_LOCK_NAME));
  const program=`
    import { fstatSync } from 'node:fs';
    import { writeFile,access } from 'node:fs/promises';
    const held=fstatSync(3);
    await writeFile(process.argv[1],JSON.stringify({dev:held.dev,ino:held.ino}),{flag:'wx'});
    for(;;) {
      try { await access(process.argv[2]); break; }
      catch(error) { if(error.code!=='ENOENT') throw error; }
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    process.stdout.write('child finished');
  `;
  let settled;
  const pending=runSandboxProcess(process.execPath,['--input-type=module','-e',program,ready,finish],
    {leaseFd:lease.fd,signal:controller.signal,timeoutMs:10000,maxBytes:4096}).then(result=>{settled=result;return result;});
  try {
    let childIdentity;
    const deadline=Date.now()+5000;
    while(Date.now()<deadline && !childIdentity && !settled) {
      try { childIdentity=JSON.parse(await readFile(ready,'utf8')); }
      catch(error) { if(error.code!=='ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if(!childIdentity) await delay(10);
    }
    assert.deepEqual(childIdentity,{dev:original.dev,ino:original.ino},settled?.stderr.toString('utf8'));
    await lease.release();
    const blocked=await tryFromProcess(root);
    assert.equal(blocked.acquired,false); assert.equal(blocked.code,'execution_locked');
    assert.equal(settled,undefined,'child must still be waiting on its explicit finish gate');
    await writeFile(finish,'finish',{flag:'wx'});
    const result=await pending;
    assert.equal(result.reason,''); assert.equal(result.code,0,result.stderr.toString('utf8'));
    assert.equal(result.stdout.toString('utf8'),'child finished');
    assert.deepEqual(await tryFromProcess(root),{acquired:true});
  } finally { controller.abort(); await pending; await lease.release(); }
});

test('runs symlinks, lock symlinks, hardlinks and nonregular lock paths are rejected',linux,async t => {
  const outside=await temporary(t);
  const linkedRuns=await temporary(t); await symlink(outside,join(linkedRuns,'runs'),'dir');
  await assert.rejects(acquireExecutionLease(linkedRuns),error=>error.status===503);
  const target=join(outside,'target'); await writeFile(target,'unchanged');
  for(const kind of ['symlink','hardlink','directory']) {
    const root=await temporary(t); await mkdir(join(root,'runs')); const path=join(root,'runs',EXECUTION_LOCK_NAME);
    if(kind==='symlink') await symlink(target,path,'file');
    if(kind==='hardlink') await link(target,path);
    if(kind==='directory') await mkdir(path);
    await assert.rejects(acquireExecutionLease(root),error=>error.status===503,kind);
    if(kind==='hardlink') await rm(path); // Keep subsequent target identity checks simple.
  }
  assert.equal(await readFile(target,'utf8'),'unchanged');
});

test('replaced lock inode invalidates and aborts a live lease without removing the replacement',linux,async t => {
  const root=await temporary(t), lease=await acquireExecutionLease(root); t.after(()=>lease.release());
  const path=join(root,'runs',EXECUTION_LOCK_NAME); await rename(path,path+'.original'); await writeFile(path,'replacement');
  await assert.rejects(lease.assertHeld(),error=>error.code==='execution_lease_lost');
  assert.equal(lease.signal.aborted,true); assert.throws(()=>lease.fd);
  await lease.release(); assert.equal(await readFile(path,'utf8'),'replacement');
  assert.ok((await lstat(path+'.original')).isFile());
});

test('replaced runs directory invalidates ownership even when the old FD remains open',linux,async t => {
  const root=await temporary(t), lease=await acquireExecutionLease(root); t.after(()=>lease.release());
  await rename(join(root,'runs'),join(root,'original-runs')); await mkdir(join(root,'runs'));
  await assert.rejects(lease.assertHeld(),error=>error.code==='execution_lease_lost');
  assert.equal(lease.signal.aborted,true); await lease.release();
  assert.ok((await lstat(join(root,'original-runs',EXECUTION_LOCK_NAME))).isFile());
});

test('missing flock explicitly disables execution and does not strand an acquired lock',linux,async t => {
  const root=await temporary(t), oldPath=process.env.PATH;
  try {
    process.env.PATH='';
    await assert.rejects(acquireExecutionLease(root),error=>error.status===503 && error.code==='execution_lock_unavailable' && /flock/.test(error.message));
  } finally { if(oldPath===undefined) delete process.env.PATH; else process.env.PATH=oldPath; }
  const lease=await acquireExecutionLease(root); await lease.assertHeld(); await lease.release();
});
