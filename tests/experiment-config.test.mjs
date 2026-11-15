// Synthetic declarations test registration only; never count them as real review evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkExperimentConfig, compareExperimentSnapshots, EXPERIMENT_LIMITS } from '../scripts/experiment-config.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const base=JSON.parse(await readFile(join(root,'data/experiments/config.json'),'utf8'));
const sourceCatalog=JSON.parse(await readFile(join(root,'data/cases/catalog.json'),'utf8'));
async function fixture() {
  await mkdir(join(root,'runs'),{recursive:true});
  const directory=await mkdtemp(join(root,'runs/experiment-contract-'));
  for (const path of ['examples','data/cases','data/docs','data/experiments/prompts']) await mkdir(join(directory,path),{recursive:true});
  const config=structuredClone(base),catalog=structuredClone(sourceCatalog);
  for (const item of catalog.cases) await writeFile(join(directory,item.sourcePath),await readFile(join(root,item.sourcePath)));
  for (const path of ['data/docs/manifest.json','data/docs/cangjie-1.0.5.json']) await writeFile(join(directory,path),await readFile(join(root,path)));
  const save=async()=>{
    await writeFile(join(directory,'data/experiments/config.json'),JSON.stringify(config));
    await writeFile(join(directory,'data/cases/catalog.json'),JSON.stringify(catalog));
  };
  const template=async(name,text)=>{
    const path=`data/experiments/prompts/${name}.txt`;
    await writeFile(join(directory,path),text);
    config.templates[name]={path,sha256:sha(text)};
  };
  await save();
  return {directory,config,catalog,save,template,check:()=>checkExperimentConfig({root:directory})};
}

test('real draft links actual materials, reports missing dependencies, never enables execution',async()=>{
  const report=await checkExperimentConfig({root});
  assert.equal(report.counts.development,4); assert.equal(report.counts.evaluation,0);
  assert.equal(report.metadataComplete,false); assert.equal(report.experimentFrozen,false);
  assert.equal(report.executionAuthorized,false); assert.equal(report.protocol.maxPlannedGenerations,64);
  for (const field of ['sharedModel.provider','budget.maxCost','environment.imageId','templates.sharedPrompt','cases'])
    assert.ok(report.blockers.some(item=>item.field===field));
  assert.ok(!JSON.stringify(report).includes('expectedStdout'));
});

test('JSON formatting and object order do not change configuration fingerprint',async()=>{
  const f=await fixture(),before=await f.check();
  await writeFile(join(f.directory,'data/experiments/config.json'),JSON.stringify(Object.fromEntries(Object.entries(f.config).reverse()),null,4));
  assert.deepEqual(await f.check(),before);
});

test('group-specific settings, unrecognized keys and unsafe values are rejected',async()=>{
  for (const change of [
    c=>{c.groupB={temperature:1};},c=>{c.sharedModel.apiKey='do-not-print-this-secret';},
    c=>{c.sharedModel.temperature=-1;},c=>{c.sharedModel.topP=0;},c=>{c.sharedModel.maxOutputTokens=1.5;},
    c=>{c.sharedModel.seed=-1;},c=>{c.budget.maxCost=0;},c=>{c.environment.imageId='doctor:latest';},
    c=>{c.environment.toolCommit='abc123';},c=>{c.sdkVersion='other';},
    c=>{c.catalogPath='data/holdout/private.json';}
  ]) {
    const f=await fixture(); change(f.config); await f.save(); await assert.rejects(f.check());
  }
});

test('protocol rejects weakened comparisons, leaked feedback, wrong denominators and changed retrieval',async()=>{
  for (const change of [
    c=>{c.protocol.maxRounds=3;},c=>{c.protocol.groups.A='with-documents';},
    c=>{c.protocol.holdoutAccess='during-repair';},c=>{c.protocol.feedback='all-results';},
    c=>{c.protocol.plannedErrorCases=20;},c=>{c.protocol.maxPlannedGenerations=80;},
    c=>{c.protocol.invalidResponseConsumesRound=false;},c=>{c.retrieval.topK=5;}
  ]) {
    const f=await fixture(); change(f.config); await f.save(); await assert.rejects(f.check(),/约定|检索参数/);
  }
});

test('source and document tampering are detected rather than accepted into a snapshot',async()=>{
  const f=await fixture();
  await writeFile(join(f.directory,f.catalog.cases[0].sourcePath),'changed');
  await assert.rejects(f.check(),/源码与登记摘要不符/);
  const d=await fixture(); await writeFile(join(d.directory,'data/docs/cangjie-1.0.5.json'),'{}');
  await assert.rejects(d.check(),/文档快照摘要/);
});

test('template bytes are verified and no private path can be registered',async()=>{
  const f=await fixture(); await f.template('sharedPrompt','Synthetic public template\n'); await f.save();
  assert.ok(!(await f.check()).blockers.some(item=>item.field==='templates.sharedPrompt'));
  await writeFile(join(f.directory,f.config.templates.sharedPrompt.path),'changed');
  await assert.rejects(f.check(),/模板内容与登记摘要/);
  for (const path of ['data/holdout/private.txt','../secret.txt','C:/secret.txt','data/experiments/prompts/../private.txt']) {
    f.config.templates.sharedPrompt.path=path; await f.save(); await assert.rejects(f.check(),/模板只允许/);
  }
});

test('oversized, empty, NUL or malformed UTF-8 templates are rejected',async()=>{
  for (const bytes of [Buffer.from(' '),Buffer.from('a\0'),Buffer.from([255]),Buffer.alloc(EXPERIMENT_LIMITS.templateBytes+1,65)]) {
    const f=await fixture(); await f.template('sharedPrompt',bytes); await f.save(); await assert.rejects(f.check());
  }
});

test('snapshot comparison identifies model, case, documentation and template changes',async()=>{
  const f=await fixture(),a=await f.check();
  f.config.sharedModel.temperature=0; await f.save(); const b=await f.check();
  assert.deepEqual(compareExperimentSnapshots(a,b).changed,['config']);
  f.catalog.cases[0].task+=' Public task convention updated.'; await f.save(); const c=await f.check();
  assert.deepEqual(compareExperimentSnapshots(b,c).changed,['cases']);
  const manifestPath=join(f.directory,'data/docs/manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')); manifest.selectionNote+=' reviewed';
  await writeFile(manifestPath,JSON.stringify(manifest)); const d=await f.check();
  assert.deepEqual(compareExperimentSnapshots(c,d).changed,['documents']);
  await f.template('sharedPrompt','Synthetic public template'); await f.save(); const e=await f.check();
  assert.deepEqual(compareExperimentSnapshots(d,e).changed,['config','templates']);
  assert.equal(compareExperimentSnapshots(e,e).unchanged,true);
});

test('damaged baseline identity or digest cannot silently pass comparison',async()=>{
  const a=await checkExperimentConfig({root});
  for (const mutate of [r=>{r.kind='other';},r=>{r.materials.config='0'.repeat(64);},
    r=>{r.snapshotSha256='bad';},r=>{r.experimentFrozen=true;},r=>{r.executionAuthorized=true;},
    r=>{r.materials.extra='0'.repeat(64);}]) {
    const b=structuredClone(a); mutate(b); assert.throws(()=>compareExperimentSnapshots(a,b),/基线/);
  }
});

test('complete synthetic registration still does not freeze or authorize an experiment',async()=>{
  const f=await fixture(),seed=f.catalog.cases[0]; f.catalog.cases=[];
  for (let i=0;i<30;i++) {
    const item=structuredClone(seed); item.id=`synthetic-${i}`; item.familyId=item.id;
    item.split=i<10?'development':'evaluation';
    item.category=i<10?'type':['syntax','type','scope-or-api','logic','correct'][Math.floor((i-10)/4)];
    item.initialExpectation=item.category==='correct'?'passes-public-tests':item.category==='logic'?'fails-public-tests':'compile-error';
    item.sourcePath=`examples/${item.id}.cj`;
    const bytes=Buffer.from(`// Synthetic contract data ${i}, not an evaluation case\nmain() {}\n`);
    item.sourceSha256=sha(bytes); await writeFile(join(f.directory,item.sourcePath),bytes);
    item.review={reviewers:['Synthetic A','Synthetic B'],referenceSha256:'a'.repeat(64),initialEvidenceSha256:'b'.repeat(64),holdoutCommitmentSha256:'c'.repeat(64)};
    f.catalog.cases.push(item);
  }
  f.config.sharedModel={provider:'synthetic',modelId:'test-only',temperature:0,topP:1,maxOutputTokens:100,seed:null};
  f.config.budget={currency:'CNY',maxCost:1};
  Object.assign(f.config.environment,{imageId:'sha256:'+'a'.repeat(64),toolCommit:'b'.repeat(40),toolAcceptanceSha256:'c'.repeat(64),holdoutIsolationSha256:'d'.repeat(64)});
  await f.template('sharedPrompt','Synthetic prompt'); await f.template('publicFeedback','Synthetic feedback'); await f.save();
  const r=await f.check(); assert.equal(r.metadataComplete,true); assert.equal(r.experimentFrozen,false);
  assert.equal(r.executionAuthorized,false); assert.deepEqual(r.blockers,[]);
});

test('linked template is rejected',async t=>{
  const f=await fixture(); await f.template('sharedPrompt','Synthetic'); await f.save();
  const target=join(f.directory,'data/experiments/prompts/target.txt'); await writeFile(target,'Synthetic');
  const path=join(f.directory,f.config.templates.sharedPrompt.path); await unlink(path);
  try { await symlink(target,path,'file'); }
  catch(error) { if (process.platform==='win32' && error.code==='EPERM') {t.skip('Windows does not grant symlink creation'); return;} throw error; }
  await assert.rejects(f.check(),/链接/);
});

test('CLI works from other cwd, distinguishes draft/strict/change errors and rejects malformed options',async()=>{
  const cli=join(root,'scripts/check-experiment.mjs');
  const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:resolve(root,'..'),encoding:'utf8'});
  const draft=run(['--json']); assert.equal(draft.status,0); assert.equal(JSON.parse(draft.stdout).metadataComplete,false);
  assert.equal(run(['--json','--require-complete']).status,2);
  for (const args of [['--unknown'],['--config'],['--json','--json'],['--baseline','data/holdout/private.json']]) assert.equal(run(args).status,1);
  const dir=join(root,'runs/experiment-preparation'); await mkdir(dir,{recursive:true});
  const name=`contract-${process.pid}-${Date.now()}.json`,relative=`runs/experiment-preparation/${name}`;
  await writeFile(join(dir,name),draft.stdout,{flag:'wx'});
  assert.equal(run(['--baseline',relative]).status,0);
  const f=await fixture(); f.config.sharedModel.temperature=0; await f.save();
  await writeFile(join(dir,name),JSON.stringify(await f.check()));
  assert.equal(run(['--baseline',relative,'--require-complete']).status,3);
  await writeFile(join(dir,name),'{bad'); assert.equal(run(['--baseline',relative]).status,1);
});

test('oversized or malformed configuration fails without echoing its contents',async()=>{
  const f=await fixture(),path=join(f.directory,'data/experiments/config.json');
  for (const value of ['{do-not-print-this-secret',Buffer.from([255]),' '.repeat(EXPERIMENT_LIMITS.configBytes+1)]) {
    await writeFile(path,value);
    await assert.rejects(f.check(),e=>!e.message.includes('do-not-print-this-secret'));
  }
});
