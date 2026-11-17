// Synthetic metadata below tests the checker; it is not a reviewed case set or experiment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { checkCaseCatalog, compareCaseSnapshots, CASE_LIMITS } from '../scripts/case-catalog.mjs';
// fileURLToPath also handles Chinese workspace names on Windows.
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const sourceCatalog=JSON.parse(await readFile(join(root,'data/cases/catalog.json'),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture() {
  await mkdir(join(root,'runs'),{recursive:true});
  const directory=await mkdtemp(join(root,'runs/case-contract-'));
  await mkdir(join(directory,'examples'),{recursive:true});
  await mkdir(join(directory,'data/cases/sources'),{recursive:true});
  const catalog=structuredClone(sourceCatalog);
  for (const item of catalog.cases) await writeFile(join(directory,item.sourcePath),await readFile(join(root,item.sourcePath)));
  const save=()=>writeFile(join(directory,'data/cases/catalog.json'),JSON.stringify(catalog));
  await save();
  return {directory,catalog,save,check:()=>checkCaseCatalog({root:directory})};
}

test('real public catalogue reports 10 development and 20 evaluation drafts without invented reviews',async()=>{
  const report=await checkCaseCatalog({root});
  assert.equal(report.counts.development,10); assert.equal(report.counts.evaluation,20);
  assert.equal(report.blockers.length,30); assert.equal(report.metadataComplete,false);
  assert.equal(report.experimentFrozen,false); assert.equal(report.manifest.length,30);
  const output=JSON.stringify(report);
  assert.ok(!output.includes('expectedStdout')); assert.ok(!output.includes('println'));
  assert.ok(!output.includes('reviewers')); assert.equal(report.datasetSha256.length,64);
});

test('snapshot is deterministic across JSON formatting and key order',async()=>{
  const f=await fixture(), a=await f.check();
  const reordered={cases:f.catalog.cases,sdkVersion:'1.0.5',kind:f.catalog.kind,schemaVersion:1};
  await writeFile(join(f.directory,'data/cases/catalog.json'),JSON.stringify(reordered,null,4));
  const b=await f.check(); assert.deepEqual(a,b);
  assert.equal(compareCaseSnapshots(a,b).unchanged,true);
});

test('duplicate IDs, cross-split families and duplicate source bytes fail',async()=>{
  for (const mode of ['id','family','source']) {
    const f=await fixture(), item=structuredClone(f.catalog.cases[0]);
    if (mode !== 'id') {item.id='new-case'; item.split='evaluation';}
    if (mode === 'source') item.familyId='different-family';
    f.catalog.cases.push(item); await f.save();
    await assert.rejects(f.check(),mode==='id' ? /编号无效或重复/ : mode==='family' ? /同源题目跨/ : /相同源码跨/);
  }
});

test('unknown fields, wrong SDK, category and initial expectation are rejected',async()=>{
  for (const change of [c=>{c.holdoutTests=[];}, c=>{c.sdkVersion='1.2.0';},
    c=>{c.cases[0].category='other';},c=>{c.cases[0].initialExpectation='passes-public-tests';},
    c=>{c.cases[0].review.reviewers=['A','A'];}]) {
    const f=await fixture(); change(f.catalog); await f.save(); await assert.rejects(f.check());
  }
});

test('private, absolute, traversal, nested and Windows alternate stream paths fail before reading',async()=>{
  for (const sourcePath of ['data/holdout/private.cj','../secret.cj','D:/secret.cj','examples/a.cj:secret',
    'examples/../secret.cj','examples\\hello.cj','examples/sub/hello.cj']) {
    const f=await fixture(); f.catalog.cases[0].sourcePath=sourcePath; await f.save();
    await assert.rejects(f.check(),/源码只允许/);
  }
  await assert.rejects(checkCaseCatalog({root,catalogPath:'data/holdout/private.json'}),/清单只允许/);
});

test('hash mismatch and missing source refuse a partial success report',async()=>{
  const f=await fixture();
  await writeFile(join(f.directory,f.catalog.cases[0].sourcePath),'changed');
  await assert.rejects(f.check(),/源码与登记摘要不符/);
  f.catalog.cases[0].sourcePath='examples/missing.cj'; await f.save();
  await assert.rejects(f.check(),{code:'ENOENT'});
});

test('source size, line count, invalid UTF-8 and empty code are bounded',async()=>{
  for (const bytes of [Buffer.alloc(CASE_LIMITS.sourceBytes+1,65),Buffer.from('x\n'.repeat(201)),
    Buffer.from([255,255]),Buffer.from('   \n'),Buffer.from('a\0')]) {
    const f=await fixture(); await writeFile(join(f.directory,f.catalog.cases[0].sourcePath),bytes);
    f.catalog.cases[0].sourceSha256=digest(bytes); await f.save(); await assert.rejects(f.check());
  }
});

test('oversized or malformed catalogue is rejected',async()=>{
  const f=await fixture();
  for (const value of ['{broken',Buffer.from([255]),' '.repeat(CASE_LIMITS.catalogBytes+1)]) {
    await writeFile(join(f.directory,'data/cases/catalog.json'),value); await assert.rejects(f.check());
  }
});

test('public tests keep the shared contract and missing evidence stays explicit',async()=>{
  const f=await fixture(); f.catalog.cases[0].publicTests=[];
  f.catalog.cases[0].origin={kind:'student',reference:'synthetic source',permission:'permission-pending'};
  await f.save(); const report=await f.check();
  assert.ok(report.blockers[0].reasons.includes('来源授权待确认'));
  assert.ok(report.blockers[0].reasons.includes('缺少公开测试'));
  f.catalog.cases[0].publicTests=[{id:'test',stdin:'',expectedStdout:'x'.repeat(16385)}]; await f.save();
  await assert.rejects(f.check(),/16 KiB/);
});

test('declared complete synthetic metadata never means a frozen or executed experiment',async()=>{
  const f=await fixture(), seed=f.catalog.cases[0]; f.catalog.cases=[];
  for (let i=0;i<30;i++) {
    const item=structuredClone(seed); item.id=`synthetic-${i}`; item.familyId=item.id;
    item.split=i<10?'development':'evaluation';
    item.category=i<10?'type':['syntax','type','scope-or-api','logic','correct'][Math.floor((i-10)/4)];
    item.initialExpectation=item.category==='correct'?'passes-public-tests':item.category==='logic'?'fails-public-tests':'compile-error';
    item.sourcePath=`examples/${item.id}.cj`;
    const bytes=Buffer.from(`// Synthetic contract fixture ${i}, never executed\nmain() {}\n`);
    item.sourceSha256=digest(bytes); await writeFile(join(f.directory,item.sourcePath),bytes);
    item.review={reviewers:['Synthetic reviewer A','Synthetic reviewer B'],referenceSha256:'a'.repeat(64),
      initialEvidenceSha256:'b'.repeat(64),holdoutCommitmentSha256:i<10?null:'c'.repeat(64)};
    f.catalog.cases.push(item);
  }
  await f.save(); const report=await f.check();
  assert.equal(report.metadataComplete,true); assert.deepEqual(report.gaps,[]); assert.deepEqual(report.blockers,[]);
  assert.equal(report.experimentFrozen,false); assert.match(report.limitations.join(''),/真实性仍须人工核查/);
  f.catalog.cases[10].review.holdoutCommitmentSha256=null; await f.save();
  assert.equal((await f.check()).metadataComplete,false);
});

test('snapshot comparison detects changed tests, added/removed cases and changed execution order',async()=>{
  const f=await fixture(), before=await f.check();
  f.catalog.cases[0].publicTests[0].expectedStdout='different\n';
  const removed=f.catalog.cases.pop().id;
  const added=structuredClone(f.catalog.cases[1]); added.id='extra'; f.catalog.cases.unshift(added);
  await f.save(); const current=await f.check(); const diff=compareCaseSnapshots(before,current);
  assert.deepEqual(diff.added,['extra']); assert.deepEqual(diff.removed,[removed]);
  assert.deepEqual(diff.changed,['type_mismatch']); assert.equal(diff.unchanged,false);
  f.catalog.cases.reverse(); await f.save(); const order=compareCaseSnapshots(current,await f.check());
  assert.equal(order.orderChanged,true); assert.deepEqual(order.changed,[]); assert.equal(order.unchanged,false);
});

test('invalid comparison manifests are not accepted as unchanged',async()=>{
  const a=await checkCaseCatalog({root});
  for (const change of [r=>{r.kind='other';}, r=>{r.manifest.push(r.manifest[0]);},r=>{r.datasetSha256='bad';}]) {
    const b=structuredClone(a); change(b); assert.throws(()=>compareCaseSnapshots(b,a),/有效的案例准备摘要/);
  }
});

test('symlinked source is rejected',async t=>{
  const f=await fixture(); const path=join(f.directory,'examples/linked.cj');
  try { await symlink(join(f.directory,'examples/type_mismatch.cj'),path,'file'); }
  catch (error) { if (process.platform==='win32' && error.code==='EPERM') {t.skip('Windows does not grant symlink creation'); return;} throw error; }
  f.catalog.cases[0].sourcePath='examples/linked.cj'; await f.save();
  await assert.rejects(f.check(),/链接/);
});

test('deterministic task cannot register conflicting outputs for the same public input',async()=>{
  const f=await fixture();
  f.catalog.cases[0].publicTests.push({id:'conflicting',stdin:'',expectedStdout:'wrong\n'});
  await f.save(); await assert.rejects(f.check(),/同一公开测试输入/);
});

test('CLI reads a saved baseline and uses exit 3 for material changes',async()=>{
  const directory=join(root,'runs/case-preparation'); await mkdir(directory,{recursive:true});
  const name=`contract-${process.pid}-${Date.now()}.json`, path=join(directory,name);
  const report=await checkCaseCatalog({root}); await writeFile(path,JSON.stringify(report),{flag:'wx'});
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/check-cases.mjs'),'--json','--baseline',`runs/case-preparation/${name}`],{encoding:'utf8'});
  const same=run(); assert.equal(same.status,0); assert.equal(JSON.parse(same.stdout).comparison.unchanged,true);
  report.manifest[0].sha256='0'.repeat(64); await writeFile(path,JSON.stringify(report));
  const different=run(); assert.equal(different.status,3);
  assert.deepEqual(JSON.parse(different.stdout).comparison.changed,['type_mismatch']);
  await writeFile(path,'{invalid'); assert.equal(run().status,1);
});

test('CLI returns deterministic JSON from another cwd and strict mode refuses incomplete metadata',()=>{
  const cli=join(root,'scripts/check-cases.mjs');
  const run=args=>spawnSync(process.execPath,[cli,...args],{cwd:resolve(root,'..'),encoding:'utf8'});
  const draft=run(['--json']); assert.equal(draft.status,0); assert.equal(JSON.parse(draft.stdout).metadataComplete,false);
  const strict=run(['--require-complete','--json']); assert.equal(strict.status,2); assert.equal(JSON.parse(strict.stdout).experimentFrozen,false);
  for (const args of [['--unknown'],['--catalog'],['--json','--json'],['--baseline','data/holdout/private.json']]) assert.equal(run(args).status,1);
});
