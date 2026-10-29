// Real filesystem fixtures; synthetic verification states are not execution results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir,readdir,rm,symlink,link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { StorageService,STORAGE_LIMITS } from '../scripts/storage-service.mjs';
import { RevisionStore } from '../scripts/revision-store.mjs';
import { VerificationService } from '../scripts/verification-service.mjs';

const baseRecord=JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function setup(t) {
  const root=await mkdtemp(join(tmpdir(),'doctor-storage-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const revisionStore=new RevisionStore(root), verificationService=new VerificationService({root,revisionStore,platform:'win32'});
  const storage=new StorageService({root,revisionStore,verificationService});
  const save=(index=3,base=baseRecord)=>revisionStore.save({baseRecord:structuredClone(base),confirmed:true,
    source:{name:base.source.name,text:base.source.text.replace('"three"',String(index))}});
  return {root,revisionStore,verificationService,storage,save};
}
async function verification(env,revision,id,{finished=false}={}) {
  const request={schemaVersion:1,kind:'doctor-revision-verification',verificationId:id,createdAt:new Date().toISOString(),
    finishedAt:null,state:'running',revision,tests:[{id:'public',stdin:'',expectedStdout:'3\n'}],report:null,detail:'Synthetic pending request.'};
  const directory=join(env.root,'runs','revision-verifications',id); await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'request.json'),JSON.stringify(request));
  if (finished) await writeFile(join(directory,'verification.json'),JSON.stringify({...request,state:'failed',
    finishedAt:new Date().toISOString(),detail:'Synthetic failure without execution report.'}));
  return request;
}

test('absent runs produce a complete zero inventory and empty bundle without creating directories',async t=>{
  const env=await setup(t), summary=await env.storage.summary(), bundle=await env.storage.exportEvidence();
  assert.equal(summary.complete,true); assert.equal(summary.files,0); assert.equal(summary.bytes,0); assert.deepEqual(summary.issues,[]);
  assert.deepEqual(summary.groups.map(group=>group.name),['tasks','native','retrieval','revisions','revision-verifications','other']);
  assert.deepEqual(bundle.counts,{revisions:0,verifications:0}); assert.deepEqual(await readdir(env.root),[]);
  await assert.rejects(new StorageService({root:env.root,revisionStore:env.revisionStore}).exportEvidence(),error=>error.status===503);
});

test('inventory counts logical bytes in all fixed groups and miscellaneous runs without reading their contents',async t=>{
  const env=await setup(t);
  for (const name of ['tasks','native','retrieval','revisions','revision-verifications','capture-test']) {
    await mkdir(join(env.root,'runs',name),{recursive:true}); await writeFile(join(env.root,'runs',name,'opaque.bin'),Buffer.from([0xff,0,0xc3]));
  }
  await writeFile(join(env.root,'runs','execution.lock'),'lock');
  const summary=await env.storage.summary();
  assert.equal(summary.complete,true); assert.equal(summary.files,7); assert.equal(summary.bytes,22);
  assert.deepEqual(summary.groups.at(-1),{name:'other',files:2,bytes:7});
  assert.ok(!JSON.stringify(summary).includes(env.root));
});

test('inventory reports incomplete at depth limit and never presents partial totals as complete',async t=>{
  const env=await setup(t), nested=join(env.root,'runs',...Array(11).fill('nested'));
  await mkdir(nested,{recursive:true}); await writeFile(join(nested,'deep.txt'),'private');
  const summary=await env.storage.summary(); assert.equal(summary.complete,false); assert.equal(summary.bytes,0);
  assert.ok(summary.issues.some(message=>message.includes('深度'))); assert.equal(summary.limits.maxDepth,STORAGE_LIMITS.maxDepth);
});

test('bundles cover more than the recent twenty, bind manifests, and preserve failed and unknown verification states',async t=>{
  const env=await setup(t); const saved=[];
  for(let i=0;i<21;i++) saved.push(await env.save(i));
  await verification(env,saved[0],'a'.repeat(32)); await verification(env,saved[0],'b'.repeat(32),{finished:true});
  assert.equal((await env.revisionStore.list()).revisions.length,20);
  const bundle=await env.storage.exportEvidence(); assert.deepEqual(bundle.counts,{revisions:21,verifications:2});
  assert.equal(bundle.manifest.length,23); assert.equal(bundle.verifications[0].state,'unknown'); assert.equal(bundle.verifications[1].state,'failed');
  assert.ok(bundle.revisions.every(value=>value.compileStatus==='not_run' && value.execution.attempted===false));
  for(const entry of bundle.manifest) {
    const value=(entry.type==='revision'?bundle.revisions:bundle.verifications).find(value=>(value.revisionId||value.verificationId)===entry.id);
    assert.equal(entry.sha256,digest(JSON.stringify(value)));
  }
  assert.equal(bundle.scope,'saved-revisions-and-verifications');
  assert.ok(bundle.limitations.some(value=>value.includes('不是整个工作区备份')));
  env.verificationService.active.add('a'.repeat(32));
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===409 && /仍在进行/.test(error.message));
});

test('self-contained verification remains exportable when its source revision directory is absent',async t=>{
  const env=await setup(t), revision=await env.save();
  await verification(env,revision,'a'.repeat(32));
  await rm(join(env.root,'runs','revisions',revision.revisionId),{recursive:true});
  const bundle=await env.storage.exportEvidence(); assert.equal(bundle.counts.revisions,0); assert.equal(bundle.counts.verifications,1);
  assert.equal(bundle.verifications[0].revision.revisionId,revision.revisionId);
});

test('corruption, unknown entry names and mismatched same-ID revisions stop the entire export',async t=>{
  const env=await setup(t), revision=await env.save(), file=join(env.root,'runs','revisions',revision.revisionId,'revision.json');
  await writeFile(file,'broken');
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===400 && !error.message.includes(env.root));
  assert.equal(await readFile(file,'utf8'),'broken'); await writeFile(file,JSON.stringify(revision));
  await mkdir(join(env.root,'runs','revisions','unknown'));
  await assert.rejects(env.storage.exportEvidence(),/未识别/); await rm(join(env.root,'runs','revisions','unknown'),{recursive:true});
  const differing=structuredClone(revision); differing.source.text+=' '; differing.source.sha256=digest(differing.source.text);
  await verification(env,differing,'a'.repeat(32)); await assert.rejects(env.storage.exportEvidence(),/同编号修订不一致/);
});

test('record count beyond the fixed limit fails before attempting to read or silently truncate records',async t=>{
  const env=await setup(t), parent=join(env.root,'runs','revisions'); await mkdir(parent,{recursive:true});
  for(let i=0;i<=STORAGE_LIMITS.maxRecords;i++) await mkdir(join(parent,i.toString(16).padStart(32,'0')));
  env.revisionStore.get=async()=>{assert.fail('over-limit export must not load records');};
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===413 && /200/.test(error.message));
});

test('a content change during the second read rejects the export even when IDs are unchanged',async t=>{
  const env=await setup(t), revision=await env.save(); const originalGet=env.revisionStore.get.bind(env.revisionStore); let calls=0;
  env.revisionStore.get=async id=>{
    if(++calls===2) {
      const changed=structuredClone(revision); changed.source.text+=' '; changed.source.sha256=digest(changed.source.text);
      await writeFile(join(env.root,'runs','revisions',id,'revision.json'),JSON.stringify(changed));
    }
    return originalGet(id);
  };
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===409);
});

test('a record added during export invalidates the bundle rather than omitting it',async t=>{
  const env=await setup(t); await env.save(); const originalGet=env.revisionStore.get.bind(env.revisionStore); let called=false;
  env.revisionStore.get=async id=>{const result=await originalGet(id); if(!called){called=true; await env.save(4);} return result;};
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===409);
});

test('hardlinked files are excluded from inventory and rejected by export',async t=>{
  const env=await setup(t), revision=await env.save();
  const filename=join(env.root,'runs','revisions',revision.revisionId,'revision.json'); await link(filename,join(env.root,'duplicate.json'));
  const summary=await env.storage.summary(); assert.equal(summary.complete,false); assert.equal(summary.files,0);
  await assert.rejects(env.storage.exportEvidence(),/链接/);
});

test('linked runs or record directories are never traversed',async t=>{
  const env=await setup(t), outside=await mkdtemp(join(tmpdir(),'doctor-storage-outside-'));
  t.after(()=>rm(outside,{recursive:true,force:true})); await writeFile(join(outside,'secret.txt'),'not exported');
  await symlink(outside,join(env.root,'runs'),process.platform==='win32'?'junction':'dir');
  const summary=await env.storage.summary(); assert.equal(summary.complete,false); assert.equal(summary.bytes,0);
  await assert.rejects(env.storage.exportEvidence(),/链接/);
  assert.equal(await readFile(join(outside,'secret.txt'),'utf8'),'not exported');
});

test('linked record files are rejected without exporting their target',async t=>{
  const env=await setup(t), revision=await env.save(), directory=join(env.root,'runs','revisions',revision.revisionId);
  const target=join(env.root,'saved.json'), file=join(directory,'revision.json');
  await writeFile(target,JSON.stringify(revision)); await rm(file);
  try {await symlink(target,file,'file');}
  catch(error){if(process.platform==='win32' && error.code==='EPERM'){t.skip('Windows does not permit file symlinks for this account.');return;} throw error;}
  await assert.rejects(env.storage.exportEvidence(),/链接/);
});

test('the total byte limit fails without emitting a partial bundle',async t=>{
  const env=await setup(t), large={...structuredClone(baseRecord),syntheticPadding:'x'.repeat(2*1024*1024-8192)};
  for(let i=0;i<17;i++) await env.save(i,large);
  await assert.rejects(env.storage.exportEvidence(),error=>error.status===413 && /32 MiB/.test(error.message));
});
