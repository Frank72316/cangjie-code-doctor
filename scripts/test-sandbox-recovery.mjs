// Real Linux process death + Docker recovery acceptance. Development checks only.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSandboxExecution } from './sandbox-lifecycle.mjs';
import { runSandboxProcess } from './sandbox-container.mjs';

const [image, mode, workerRoot] = process.argv.slice(2);
assert.equal(process.platform,'linux');
assert.match(image ?? '',/^sha256:[a-f0-9]{64}$/);
if (mode === '--worker') {
  const execution = await openSandboxExecution(workerRoot);
  const container = await execution.container({image,phase:'compile'});
  await container.create(['/bin/sleep','300']);
  assert.equal((await container.start({detached:true})).code,0);
  process.send({name:container.name});
  setInterval(() => {},1000);
} else {
  await mkdir('runs',{recursive:true});
  const root = resolve(await mkdtemp('runs/crash-recovery-'));
  const otherRoot = resolve(await mkdtemp('runs/independent-recovery-'));
  const checks = [], startedAt = new Date().toISOString();
  const independent = await openSandboxExecution(otherRoot);
  let foreign, child, current, orphanName;
  const inspect = name => runSandboxProcess('docker',['--host','unix:///var/run/docker.sock','container','inspect',name],{timeoutMs:10000});
  try {
    // A different workspace can run independently and must survive our recovery.
    foreign = await independent.container({image,phase:'compile'});
    await foreign.create(['/bin/sleep','300']);
    assert.equal((await foreign.start({detached:true})).code,0);
    child = fork(fileURLToPath(import.meta.url),[image,'--worker',root],{silent:true});
    const childClosed = once(child,'exit');
    let stderr = '';
    child.stderr.on('data',chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
    child.stdout.resume();
    const ready = await new Promise((accept,reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker readiness timed out: '+stderr)); },30000);
      child.once('message',message => { clearTimeout(timer); accept(message); });
      child.once('error',error => { clearTimeout(timer); reject(error); });
      child.once('exit',() => { clearTimeout(timer); reject(new Error('Worker exited before ready: '+stderr)); });
    });
    assert.match(ready.name,/^doctor-[a-f0-9]{32}$/); orphanName = ready.name;
    await assert.rejects(openSandboxExecution(root),error => error.status === 409);
    checks.push({name:'same_workspace_cross_process_exclusion',status:'passed'});
    child.kill('SIGKILL'); await childClosed;
    const orphan = await inspect(orphanName);
    assert.equal(orphan.code,0);
    assert.equal(JSON.parse(orphan.stdout)[0].State.Running,true);
    current = await openSandboxExecution(root);
    assert.equal(current.recovered.length,1);
    const absent = await inspect(orphanName);
    assert.notEqual(absent.code,0); assert.match(absent.stderr.toString(),/no such (container|object)/i);
    checks.push({name:'killed_owner_registered_container_recovered',status:'passed',container:orphanName});
    const untouched = await inspect(foreign.name);
    assert.equal(untouched.code,0); assert.equal(JSON.parse(untouched.stdout)[0].State.Running,true);
    await current.release(); current = await openSandboxExecution(root);
    assert.equal(current.recovered.length,0);
    checks.push({name:'other_workspace_preserved_and_recovery_idempotent',status:'passed'});
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child,'exit'); child.kill('SIGKILL'); await closed;
    }
    try {
      await current?.release();
      // On failure only the same registered workspace is eligible for recovery.
      const cleanup = await openSandboxExecution(root); await cleanup.release();
    } finally {
      try { if (foreign) assert.equal((await foreign.remove()).removed,true); }
      finally { await independent.release(); }
    }
  }
  const receipt = {kind:'doctor-development-crash-recovery',image,startedAt,finishedAt:new Date().toISOString(),checks};
  console.log(JSON.stringify(receipt,null,2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    '\n## Real process death and registered container recovery\n\n```json\n'+JSON.stringify(receipt,null,2)+'\n```\n');
}
