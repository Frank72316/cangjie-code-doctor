import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openSandboxExecution, SANDBOX_LIFECYCLE_LIMITS } from '../scripts/sandbox-lifecycle.mjs';

const image=`sha256:${'a'.repeat(64)}`, id='b'.repeat(64);
const hash=value => createHash('sha256').update(value).digest('hex');
const result=(code=0,stdout='',stderr='',reason='') => ({code,stdout:Buffer.from(stdout),stderr:Buffer.from(stderr),reason});
const absent=target => result(1,'[]\n',`Error: No such object: ${target}\n`);
let sequence=0;
function fakeLease() {
  const controller=new AbortController();
  return {fd:74,signal:controller.signal,checks:0,releases:0,lost:false,
    async assertHeld() { this.checks++; if (this.lost || this.signal.aborted) throw new Error('lease lost'); },
    async release() { this.releases++; controller.abort(); }};
}
function factory({onCreate,onRemove,received=[]}={}) {
  return options => {
    received.push(options);
    return {name:`doctor-${(++sequence).toString(16).padStart(32,'0')}`,image:options.image,phase:options.phase,removed:false,createAttempted:false,created:false,
      async create(...args) {
        this.createAttempted=true;
        const actual=onCreate ? await onCreate(this,options,...args) : inspection({name:this.name,image:options.image,...options.owner});
        this.created=true;this.containerId=actual.Id; return actual;
      },
      async start() { return 'started'; }, async exec() { return 'executed'; }, async inspect() { return 'inspected'; },
      async remove() { if (onRemove) return onRemove(this); this.removed=true; return {removed:true,detail:'Synthetic removal only.'}; }};
  };
}
async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'doctor-lifecycle-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  return root;
}
async function execution(root,{executor=async()=>{throw new Error('Unexpected Docker call');},lease=fakeLease()}={}) {
  const value=await openSandboxExecution(root,{leaseFactory:async()=>lease,executor});
  return Object.assign(value,{fakeLease:lease});
}
async function orphan(root,options={}) {
  const owned=await execution(root), container=await owned.container({image,phase:'run'},factory(options));
  const directory=join(root,'runs','sandbox-lifecycle',owned.operationId);
  const intentPath=join(directory,`${container.name}.intent.json`),receiptPath=join(directory,`${container.name}.cleanup.json`);
  const intent=JSON.parse(await readFile(intentPath,'utf8'));
  await owned.release();
  return {directory,intentPath,receiptPath,intent,container};
}
function inspection(intent,changes={}) {
  return {Id:id,Name:`/${intent.name}`,Image:intent.image,Config:{Image:intent.image,Labels:{
    'org.cangjie.doctor.sandbox':'experimental-v1','org.cangjie.doctor.workspace':intent.workspaceId,
    'org.cangjie.doctor.operation':intent.operationId}},...changes};
}
function daemon(object,{removeFails=false,afterRemove}={}) {
  const calls=[]; let current=object;
  const executor=async (executable,args,options) => {
    calls.push({executable,args,options});
    assert.equal(executable,'docker'); assert.deepEqual(args.slice(0,2),['--host','unix:///var/run/docker.sock']);
    assert.equal(options.leaseFd,74); assert.equal(Object.keys(options.env).some(key=>/^DOCKER_/i.test(key)),false);
    assert.ok(options.maxBytes <= 256*1024); assert.ok(options.timeoutMs <= 10000);
    if (args[2] === 'container' && args[3] === 'inspect') {
      const target=args[4];
      return current && [current.Id,current.Name.slice(1)].includes(target) ? result(0,JSON.stringify([current])) : absent(target);
    }
    assert.deepEqual(args.slice(2,5),['rm','--force','--volumes']);
    assert.match(args[5],/^[0-9a-f]{64}$/);
    if (removeFails) return result(1,'','synthetic daemon failure');
    current=afterRemove ?? null; return result(0,`${args[5]}\n`);
  };
  return {executor,calls};
}

test('intent is durable before create; ownership and every Docker environment are fixed',async t=>{
  const root=await fixture(t),received=[],calls=[];
  const owned=await execution(root,{executor:async (executable,args,options)=>{calls.push(options);return absent(args.at(-1));}});
  t.after(()=>owned.release());
  const instance=await owned.container({image,phase:'compile',owner:{workspaceId:'foreign'},dockerHost:'tcp://evil'},factory({received,
    onCreate:async(current,options)=>{
      const intentPath=join(root,'runs','sandbox-lifecycle',owned.operationId,`${current.name}.intent.json`);
      const intent=JSON.parse(await readFile(intentPath,'utf8'));
      assert.equal(intent.name,current.name); assert.equal(intent.workspaceId,owned.workspaceId); assert.equal(intent.phase,'compile');
      await options.executor('docker',['--host','unix:///var/run/docker.sock','container','inspect',current.name],
        {env:{DOCKER_HOST:'tcp://evil',DOCKER_CUSTOM:'bad'},timeoutMs:1000,maxBytes:4096});
      return inspection({name:current.name,image:options.image,...options.owner});
    }}));
  assert.equal((await instance.create(['true'])).Name,`/${instance.name}`);
  assert.deepEqual(received[0].owner,{workspaceId:owned.workspaceId,operationId:owned.operationId});
  assert.equal(received[0].leaseFd,74); assert.equal(received[0].dockerHost,'unix:///var/run/docker.sock');
  assert.equal(calls[0].leaseFd,74); assert.equal(Object.keys(calls[0].env).some(key=>/^DOCKER_/i.test(key)),false);
});

test('recovery removes only registered owned full ID, verifies ID and name absence, and persists receipt',async t=>{
  const root=await fixture(t),previous=await orphan(root),docker=daemon(inspection(previous.intent));
  const owned=await execution(root,{executor:docker.executor});
  assert.deepEqual(docker.calls.map(call=>call.args.slice(2)),[
    ['container','inspect',previous.intent.name],['rm','--force','--volumes',id],['container','inspect',id],['container','inspect',previous.intent.name]]);
  assert.equal(owned.recovered.length,1); assert.equal(owned.recovered[0].containerId,id);
  const receipt=JSON.parse(await readFile(previous.receiptPath,'utf8'));
  assert.equal(receipt.removed,true); assert.equal(receipt.intentSha256,hash(await readFile(previous.intentPath)));
  await owned.release();
  const reopened=await execution(root); assert.deepEqual(reopened.recovered,[]); await reopened.release();
});

test('a registered name that never appeared can be recovered without an rm',async t=>{
  const root=await fixture(t),previous=await orphan(root),docker=daemon(null);
  const owned=await execution(root,{executor:docker.executor});
  assert.equal(docker.calls.length,1); assert.equal(owned.recovered[0].containerId,null);
  assert.equal(JSON.parse(await readFile(previous.receiptPath,'utf8')).removed,true);
  await owned.release();
});

test('foreign labels, image, name or abbreviated ID fail closed and never trigger rm',async t=>{
  for (const change of ['name','image','configImage','sandbox','workspace','operation','id']) await t.test(change,async st=>{
    const root=await fixture(st),previous=await orphan(root),actual=inspection(previous.intent);
    if(change==='name') actual.Name='/foreign';
    else if(change==='image') actual.Image=`sha256:${'c'.repeat(64)}`;
    else if(change==='configImage') actual.Config.Image='tag:latest';
    else if(change==='id') actual.Id='b'.repeat(12);
    else actual.Config.Labels[`org.cangjie.doctor.${change}`]='foreign';
    const calls=[],lease=fakeLease();
    await assert.rejects(execution(root,{lease,executor:async (...args)=>{calls.push(args);return result(0,JSON.stringify([actual]));}}),/身份或归属不符/);
    assert.equal(calls.length,1); assert.equal(lease.releases,1);
    await assert.rejects(readFile(previous.receiptPath),{code:'ENOENT'});
  });
});

test('journal from another workspace is rejected before any Docker access',async t=>{
  const root=await fixture(t),previous=await orphan(root);
  previous.intent.workspaceId='c'.repeat(64); await writeFile(previous.intentPath,JSON.stringify(previous.intent));
  await assert.rejects(execution(root),/不属于当前工作目录/);
});

test('corrupt, oversized and invalid UTF-8 intents are rejected before recovery',async t=>{
  for(const value of ['{',Buffer.alloc(SANDBOX_LIFECYCLE_LIMITS.recordBytes+1,32),Buffer.from([0xff,0xfe])]) await t.test(String(value.length),async st=>{
    const root=await fixture(st),previous=await orphan(root); await writeFile(previous.intentPath,value);
    await assert.rejects(execution(root),/记录/); await assert.rejects(readFile(previous.receiptPath),{code:'ENOENT'});
  });
});

test('journal directory links cannot redirect recovery outside the workspace',async t=>{
  const root=await fixture(t),outside=await fixture(t);
  await mkdir(join(root,'runs')); await symlink(outside,join(root,'runs','sandbox-lifecycle'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(execution(root),/真实目录/); assert.deepEqual(await readdir(outside),[]);
});

test('linked intent files are rejected without reading or touching their target',async t=>{
  const root=await fixture(t),previous=await orphan(root),outside=join(root,'outside-intent.json');
  await writeFile(outside,await readFile(previous.intentPath)); await rm(previous.intentPath);
  try { await symlink(outside,previous.intentPath,'file'); }
  catch(error) { if(process.platform==='win32' && ['EPERM','EACCES'].includes(error.code)){t.skip('Windows file symlink permission unavailable');return;} throw error; }
  await assert.rejects(execution(root),/链接/); assert.deepEqual(JSON.parse(await readFile(outside,'utf8')),previous.intent);
});

test('a forged, unbound or orphan cleanup receipt fails closed',async t=>{
  for(const mode of ['unbound','foreign','orphan']) await t.test(mode,async st=>{
    const root=await fixture(st),owned=await execution(root),instance=await owned.container({image,phase:'run'},factory());
    await instance.remove(); await owned.release();
    const directory=join(root,'runs','sandbox-lifecycle',owned.operationId),receiptPath=join(directory,`${instance.name}.cleanup.json`);
    const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
    if(mode==='unbound') receipt.intentSha256='c'.repeat(64);
    if(mode==='foreign') receipt.workspaceId='c'.repeat(64);
    if(mode==='orphan') await rm(join(directory,`${instance.name}.intent.json`));
    await writeFile(receiptPath,JSON.stringify(receipt));
    await assert.rejects(execution(root),/receipt/);
  });
});

test('cleanup failure preserves the pending intent and closes the failed recovery lease',async t=>{
  const root=await fixture(t),previous=await orphan(root),docker=daemon(inspection(previous.intent),{removeFails:true}),lease=fakeLease();
  await assert.rejects(execution(root,{executor:docker.executor,lease}),/恢复清理失败/);
  assert.equal(lease.releases,1); assert.equal(docker.calls.length,2);
  await assert.rejects(readFile(previous.receiptPath),{code:'ENOENT'});
  assert.deepEqual(JSON.parse(await readFile(previous.intentPath,'utf8')),previous.intent);
});

test('inspect connection errors, wrong absence targets and truncated results cannot prove cleanup',async t=>{
  for(const response of [result(1,'','permission denied'),absent('another-container'),result(1,'[]','Error: No such object: x','output_limit')])
    await t.test(response.reason || response.stderr.toString(),async st=>{
      const root=await fixture(st),previous=await orphan(root),calls=[];
      await assert.rejects(execution(root,{executor:async(...args)=>{calls.push(args);return response;}}),/无法核实/);
      assert.equal(calls.length,1); await assert.rejects(readFile(previous.receiptPath),{code:'ENOENT'});
    });
});

test('recovery refuses a name reused after successful rm and retains the intent',async t=>{
  const root=await fixture(t),previous=await orphan(root);
  const replacement=inspection(previous.intent,{Id:'c'.repeat(64)}),docker=daemon(inspection(previous.intent),{afterRemove:replacement});
  await assert.rejects(execution(root,{executor:docker.executor}),/仍存在/);
  assert.equal(docker.calls.filter(call=>call.args[2]==='rm').length,1);
  await assert.rejects(readFile(previous.receiptPath),{code:'ENOENT'});
});

test('ordinary removal only writes receipt after true removal and duplicate removal is idempotent',async t=>{
  const root=await fixture(t),owned=await execution(root); let succeeds=false;
  const instance=await owned.container({image,phase:'compile'},factory({onRemove:async()=>({removed:succeeds,detail:'Synthetic cleanup result.'})}));
  const receiptPath=join(root,'runs','sandbox-lifecycle',owned.operationId,`${instance.name}.cleanup.json`);
  assert.equal((await instance.remove()).removed,false); await assert.rejects(readFile(receiptPath),{code:'ENOENT'});
  succeeds=true; const results=await Promise.all([instance.remove(),instance.remove()]);
  assert.equal(results.every(value=>value.removed),true); const first=await readFile(receiptPath,'utf8');
  assert.equal((await instance.remove()).removed,true); assert.equal(await readFile(receiptPath,'utf8'),first);
  await assert.rejects(instance.create(['true']),/已有清理记录/); await owned.release();
});

test('cleanup before an ambiguous create settles cannot produce a durable cleared receipt',async t=>{
  const root=await fixture(t),owned=await execution(root); let removals=0,finish;
  const gate=new Promise(resolve=>{finish=resolve;}); let started;
  const entered=new Promise(resolve=>{started=resolve;});
  const instance=await owned.container({image,phase:'compile'},factory({onCreate:async()=>{started();await gate;throw new Error('synthetic create timeout');},
    onRemove:async()=>{removals++;return {removed:true,detail:'Synthetic absence check.'};}}));
  const receiptPath=join(root,'runs','sandbox-lifecycle',owned.operationId,`${instance.name}.cleanup.json`);
  const creating=instance.create(['true']); await entered;
  assert.equal((await instance.remove()).removed,true); await assert.rejects(readFile(receiptPath),{code:'ENOENT'});
  finish(); await assert.rejects(creating,/创建状态待人工核查/);
  assert.equal(removals,2); await assert.rejects(readFile(receiptPath),{code:'ENOENT'}); await owned.release();
});

test('released or lost leases prevent create/start/exec/inspect and do not invent cleanup',async t=>{
  for(const mode of ['released','lost']) await t.test(mode,async st=>{
    const root=await fixture(st),owned=await execution(root),instance=await owned.container({image,phase:'run'},factory());
    if(mode==='released') await owned.release(); else owned.fakeLease.lost=true;
    for(const method of ['create','start','exec','inspect','remove']) await assert.rejects(instance[method](['true']),/释放|lease lost/);
    const directory=join(root,'runs','sandbox-lifecycle',owned.operationId);
    assert.deepEqual(await readdir(directory),[`${instance.name}.intent.json`]); await owned.release();
    assert.equal(owned.fakeLease.releases,1);
  });
});

test('unknown journal files block recovery instead of being silently skipped',async t=>{
  const root=await fixture(t),previous=await orphan(root); await writeFile(join(previous.directory,'unexpected.json'),'{}');
  await assert.rejects(execution(root),/未知文件/);
});

test('ambiguous create with no visible container blocks recovery; a later owned container can be recovered',async t=>{
  const root=await fixture(t),owned=await execution(root);
  const instance=await owned.container({image,phase:'run'},factory({onCreate:async()=>{throw new Error('lost create response');}}));
  await assert.rejects(instance.create(['true']),/lost create response/);
  const cleanup=await instance.remove(); assert.equal(cleanup.removed,false); assert.match(cleanup.detail,/创建状态待人工核查/);
  const directory=join(root,'runs','sandbox-lifecycle',owned.operationId),intentPath=join(directory,`${instance.name}.intent.json`);
  const intent=JSON.parse(await readFile(intentPath,'utf8')); await owned.release();
  const missingDaemon=daemon(null);
  await assert.rejects(execution(root,{executor:missingDaemon.executor}),/创建状态待人工核查/);
  assert.equal(missingDaemon.calls.length,1); await assert.rejects(readFile(join(directory,`${instance.name}.cleanup.json`)),{code:'ENOENT'});
  const laterDaemon=daemon(inspection(intent)),recovery=await execution(root,{executor:laterDaemon.executor});
  assert.equal(recovery.recovered[0].containerId,id); await recovery.release();
});

test('confirmed creation is persisted before returning and a missing name still requires known ID absence',async t=>{
  const root=await fixture(t),owned=await execution(root),instance=await owned.container({image,phase:'compile'},factory());
  await instance.create(['true']);
  const directory=join(root,'runs','sandbox-lifecycle',owned.operationId);
  const marker=JSON.parse(await readFile(join(directory,`${instance.name}.created.json`),'utf8'));
  assert.equal(marker.containerId,id); await owned.release();
  const intent=JSON.parse(await readFile(join(directory,`${instance.name}.intent.json`),'utf8'));
  const renamed=daemon(inspection(intent,{Name:'/renamed-but-still-present'}));
  await assert.rejects(execution(root,{executor:renamed.executor}),/容器 ID 仍存在/);
  assert.deepEqual(renamed.calls.map(call=>call.args.slice(2)),[['container','inspect',instance.name],['container','inspect',id]]);
  const missingDaemon=daemon(null),recovery=await execution(root,{executor:missingDaemon.executor});
  assert.equal(recovery.recovered[0].containerId,id); assert.equal(missingDaemon.calls.length,2); await recovery.release();
});

test('a replacement with the same name and labels cannot replace a confirmed full ID',async t=>{
  const root=await fixture(t),owned=await execution(root),instance=await owned.container({image,phase:'run'},factory());
  await instance.create(['true']); const directory=join(root,'runs','sandbox-lifecycle',owned.operationId);
  const intent=JSON.parse(await readFile(join(directory,`${instance.name}.intent.json`),'utf8')); await owned.release();
  const replacement=daemon(inspection(intent,{Id:'c'.repeat(64)}));
  await assert.rejects(execution(root,{executor:replacement.executor}),/完整 ID 不符/);
  assert.equal(replacement.calls.length,1); await assert.rejects(readFile(join(directory,`${instance.name}.cleanup.json`)),{code:'ENOENT'});
});

test('failure before submitting create is durably distinguishable from a lost Docker response',async t=>{
  const root=await fixture(t),owned=await execution(root);
  const instance=await owned.container({image,phase:'compile'},factory({onCreate:async current=>{
    current.createAttempted=false;throw new Error('mount validation failed before create');
  }}));
  await assert.rejects(instance.create(['true']),/mount validation/);
  const directory=join(root,'runs','sandbox-lifecycle',owned.operationId);
  assert.equal(JSON.parse(await readFile(join(directory,`${instance.name}.not-started.json`),'utf8')).containerId,null);
  await owned.release();
  const recovery=await execution(root,{executor:daemon(null).executor});
  assert.equal(recovery.recovered.length,1); await recovery.release();
});

test('unsafe receipt file types block cleanup without changing the pending intent',async t=>{
  const root=await fixture(t),owned=await execution(root),instance=await owned.container({image,phase:'run'},factory());
  const directory=join(root,'runs','sandbox-lifecycle',owned.operationId),path=join(directory,`${instance.name}.cleanup.json`);
  await mkdir(path); const cleanup=await instance.remove(); assert.equal(cleanup.removed,false);
  await owned.release(); await assert.rejects(execution(root),/非普通记录/);
});

test('concurrent container registration is serialized into one operation and never creates containers',async t=>{
  const root=await fixture(t),owned=await execution(root);
  const instances=await Promise.all(Array.from({length:5},()=>owned.container({image,phase:'run'},factory())));
  assert.equal(new Set(instances.map(instance=>instance.name)).size,5);
  assert.deepEqual(await readdir(join(root,'runs','sandbox-lifecycle')),[owned.operationId]);
  assert.equal((await readdir(join(root,'runs','sandbox-lifecycle',owned.operationId))).length,5);
  assert.equal(instances.some(instance=>instance.createAttempted),false); await owned.release();
});

test('cleanup recovery never rewrites an interrupted verification result as successful',async t=>{
  const root=await fixture(t),previous=await orphan(root),records=join(root,'runs','revision-verifications','c'.repeat(32));
  await mkdir(records,{recursive:true}); const path=join(records,'request.json');
  const original='{"state":"running","report":null,"syntheticTestOnly":true}'; await writeFile(path,original);
  const owned=await execution(root,{executor:daemon(null).executor});
  assert.equal(owned.recovered[0].name,previous.intent.name); assert.equal(await readFile(path,'utf8'),original);
  assert.deepEqual(await readdir(records),['request.json']); await owned.release();
});
