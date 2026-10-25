// These native outputs are synthetic contract fixtures, not retrieval quality or A/B results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm, unlink, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RevisionStore } from '../scripts/revision-store.mjs';
import { retrieveEvidence } from '../scripts/retrieval.mjs';
import { validateRevision, validateRevisionInput } from '../web/revision.mjs';
import { sha256 } from '../web/report.mjs';
import { validateDocumentEvidence, officialDocumentURL, documentEvidenceHTML, MAX_DOCUMENT_EVIDENCE_BYTES } from '../web/document-evidence.mjs';

const original = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const corpusText = await readFile(new URL('../data/docs/cangjie-1.0.5.json',import.meta.url),'utf8');
const corpus = JSON.parse(corpusText);
const manifestText = await readFile(new URL('../data/docs/manifest.json',import.meta.url),'utf8');
const input = () => ({baseRecord:structuredClone(original),source:{name:original.source.name,
  text:original.source.text.replace('"three"','3')},confirmed:true});
async function fixture(t,{noHits=false}={}) {
  const root = await mkdtemp(join(tmpdir(),'doctor-document-evidence-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'data/docs'),{recursive:true});
  await writeFile(join(root,'data/docs/cangjie-1.0.5.json'),corpusText);
  await writeFile(join(root,'data/docs/manifest.json'),manifestText);
  const bridge = {root,executable:'synthetic-not-executed',store:{async directory(kind) {
    const directory=join(root,'runs',kind); await mkdir(directory,{recursive:true}); return directory;
  }},async executor(_file,args) {
    const query=JSON.parse(await readFile(join(root,args[2]),'utf8'));
    return {code:0,signal:null,reason:'',stderr:'',stdout:JSON.stringify({schemaVersion:1,sdkVersion:'1.0.5',
      snapshotId:corpus.snapshotId,sourceRevision:corpus.sourceRevision,algorithm:'bm25',parameters:{k1:1.2,b:0.75},
      query:query.query,effectiveQuery:query.query,queryExpansion:'compiler-glossary-v1',
      tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,
      results:noHits ? [] : corpus.documents.slice(0,2).map((doc,index) => ({...doc,score:2-index}))})};
  }};
  const evidence=await retrieveEvidence(bridge,{record:original,query:'类型'});
  return {root,evidence,store:new RevisionStore(root),directory:join(root,'runs/retrieval',evidence.retrievalId)};
}
async function mutateJSON(file,mutate) {
  const value=JSON.parse(await readFile(file,'utf8')); mutate(value); await writeFile(file,JSON.stringify(value));
}

test('an explicitly selected local retrieval is archived with the confirmed revision and survives source removal',async t => {
  const {root,evidence,store,directory}=await fixture(t);
  const saved=await store.save({...input(),retrievalId:evidence.retrievalId});
  assert.equal(saved.schemaVersion,2); assert.deepEqual(saved.documentEvidence,evidence);
  assert.equal(saved.documentEvidenceSha256,await sha256(JSON.stringify(evidence)));
  assert.equal(saved.compileStatus,'not_run'); assert.equal(saved.testStatus,'not_run');
  assert.equal(saved.execution.attempted,false);
  assert.equal((await store.list()).revisions[0].documentEvidenceCount,2);
  // This fixture directory is owned by this test; the saved revision is a full snapshot.
  await rm(directory,{recursive:true});
  assert.deepEqual(await new RevisionStore(root).get(saved.revisionId),saved);
});

test('not attached, zero hits, and legacy revisions remain distinguishable',async t => {
  const {root,evidence,store}=await fixture(t,{noHits:true});
  const absent=await store.save(input());
  assert.equal(absent.documentEvidence,null); assert.equal(absent.documentEvidenceSha256,null);
  const attached=await store.save({...input(),retrievalId:evidence.retrievalId});
  assert.deepEqual(attached.documentEvidence.results,[]);
  const listed=(await store.list()).revisions;
  assert.equal(listed.find(r => r.revisionId===absent.revisionId).documentEvidenceCount,null);
  assert.equal(listed.find(r => r.revisionId===attached.revisionId).documentEvidenceCount,0);
  const legacy={...absent,schemaVersion:1}; delete legacy.documentEvidence; delete legacy.documentEvidenceSha256;
  await writeFile(join(root,'runs/revisions',absent.revisionId,'revision.json'),JSON.stringify(legacy));
  assert.deepEqual(await store.get(absent.revisionId),legacy);
  assert.match(documentEvidenceHTML(legacy.documentEvidence),/未附带/);
  assert.match(documentEvidenceHTML(attached.documentEvidence),/没有命中.*无匹配不表示源码正确/);
});

test('saving cannot accept client supplied evidence, invalid retrieval paths or changed original records',async t => {
  const {evidence,store}=await fixture(t);
  for (const extra of [{documentEvidence:evidence},{retrievalId:'../outside'},{retrievalId:'a'.repeat(31)},
    {retrievalId:null},{retrievalId:'A'.repeat(32)}]) await assert.rejects(validateRevisionInput({...input(),...extra}));
  const changed=input(); changed.baseRecord.capturedAt='2026-01-01T00:00:00.000Z';
  await assert.rejects(store.save({...changed,retrievalId:evidence.retrievalId}),/原诊断记录不一致/);
  await assert.rejects(store.save({...input(),retrievalId:'a'.repeat(32)}),/完整的本机文档检索依据/);
});

test('confirmed input is frozen before asynchronous validation',async t => {
  const {store}=await fixture(t), request=input(), expected=structuredClone(request);
  const operation=store.save(request);
  request.source.text+='//not confirmed'; request.baseRecord.capturedAt='changed'; request.retrievalId='a'.repeat(32);
  const saved=await operation;
  assert.deepEqual(saved.baseRecord,expected.baseRecord); assert.equal(saved.source.text,expected.source.text);
  assert.equal(saved.documentEvidence,null);
});

test('completed retrieval references reject altered excerpts, metadata, source corpus and request binding',async t => {
  const mutations=[
    ['evidence.json',e => {e.results[0].text+=' forged';}],
    ['evidence.json',e => {e.sourceName='another.cj';}],
    ['evidence.json',e => {e.retrievalId='f'.repeat(32);}],
    ['evidence.json',e => {e.snapshotId='other';}],
    ['evidence.json',e => {e.results[0].url='https://example.com/';}],
    ['evidence.json',e => {e.results.push(e.results[0]);}],
    ['request.json',e => {e.record.compiler.stderr+=' changed';}],
    ['request.json',e => {e.query='other';}],
    ['request.json',e => {e.createdAt='2026-01-01T00:00:00.000Z';}],
    ['query.json',e => {e.topK=5;}],
    ['corpus.json',e => {e.documents[0].text+=' changed';}],
  ];
  for (const [filename,mutate] of mutations) {
    const {directory,evidence,store}=await fixture(t);
    await mutateJSON(join(directory,filename),mutate);
    await assert.rejects(store.save({...input(),retrievalId:evidence.retrievalId}),filename);
    assert.deepEqual(await store.list(),{revisions:[],unreadable:0});
  }
});

test('missing completion, contradictory failure, oversize and invalid UTF-8 evidence cannot be attached',async t => {
  for (const mode of ['missing','failure','large','utf8']) {
    const {directory,evidence,store}=await fixture(t);
    if (mode==='missing') await unlink(join(directory,'evidence.json'));
    if (mode==='failure') await writeFile(join(directory,'failure.json'),'{}');
    if (mode==='large') await writeFile(join(directory,'evidence.json'),'x'.repeat(MAX_DOCUMENT_EVIDENCE_BYTES+1));
    if (mode==='utf8') await writeFile(join(directory,'evidence.json'),Buffer.from([0xff,0xfe]));
    await assert.rejects(store.save({...input(),retrievalId:evidence.retrievalId}),mode);
  }
});

test('evidence directories and hardlinked files cannot redirect attachment reads',async t => {
  const first=await fixture(t), target=join(first.root,'runs/retrieval','f'.repeat(32));
  await symlink(first.directory,target,process.platform==='win32' ? 'junction':'dir');
  await assert.rejects(first.store.save({...input(),retrievalId:'f'.repeat(32)}),/链接/);
  const second=await fixture(t), evidenceFile=join(second.directory,'evidence.json');
  await link(evidenceFile,join(second.directory,'duplicate.json'));
  await assert.rejects(second.store.save({...input(),retrievalId:second.evidence.retrievalId}),/链接/);
});

test('symlinked evidence files are refused before reading',async t => {
  const {root,directory,evidence,store}=await fixture(t), target=join(root,'elsewhere.json');
  await writeFile(target,JSON.stringify(evidence)); await unlink(join(directory,'evidence.json'));
  try { await symlink(target,join(directory,'evidence.json'),'file'); }
  catch (error) { if (process.platform==='win32' && error.code==='EPERM') {t.skip('Windows file symlink permission is unavailable.'); return;} throw error; }
  await assert.rejects(store.save({...input(),retrievalId:evidence.retrievalId}),/链接/);
});

test('archived evidence integrity and binding remain validated without the retrieval folder',async t => {
  const {evidence,store}=await fixture(t), saved=await store.save({...input(),retrievalId:evidence.retrievalId});
  for (const mutate of [r => {r.documentEvidence.results[0].text+=' altered';},
    r => {r.documentEvidenceSha256='0'.repeat(64);},r => {r.documentEvidence=null;},
    r => {r.documentEvidence.sourceSha256='0'.repeat(64);},r => {delete r.documentEvidenceSha256;},
    r => {r.documentEvidence.parameters.k1=2;},r => {r.documentEvidence.results[0].score=0;}]) {
    const changed=structuredClone(saved); mutate(changed); await assert.rejects(validateRevision(changed));
  }
  const unrelated=structuredClone(saved); unrelated.documentEvidence.recordSha256='0'.repeat(64);
  unrelated.documentEvidenceSha256=await sha256(JSON.stringify(unrelated.documentEvidence));
  await assert.rejects(validateRevision(unrelated),/原诊断记录不一致/);
});

test('shared reference validation binds diagnostic queries and rejects unsafe metadata',async t => {
  const {evidence}=await fixture(t);
  assert.equal(await validateDocumentEvidence(evidence,original),evidence);
  for (const mutate of [e => {e.queryOrigin='diagnostics';},e => {e.createdAt='yesterday';},
    e => {e.compilerVersion='Cangjie Compiler: 1.2.0';},e => {e.query+='\0';},
    e => {e.results[0].title='x'.repeat(513);},e => {e.results[1].score=3;},e => {e.results[0].extra='x';}]) {
    const changed=structuredClone(evidence); mutate(changed); await assert.rejects(validateDocumentEvidence(changed,original));
  }
  for (const url of ['javascript:alert(1)','http://docs.cangjie-lang.cn/','https://github.com/elsewhere/docs/',
    'https://user:pass@docs.cangjie-lang.cn/','https://docs.cangjie-lang.cn:444/']) assert.throws(() => officialDocumentURL(url));
});

test('HTML reference snapshots escape text and preserve identity, source, license and conclusion limits',async t => {
  const {evidence}=await fixture(t), hostile=structuredClone(evidence);
  hostile.query='<script>alert(1)</script>'; hostile.results[0].title='"<img onerror=alert(1)>';
  hostile.results[0].text='<svg onload=alert(1)> & text';
  const html=documentEvidenceHTML(hostile);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img')); assert.ok(!html.includes('<svg'));
  for (const expected of ['&lt;script&gt;','&lt;svg','&amp; text',evidence.retrievalId,evidence.snapshotId,
    evidence.sourceRevision,evidence.corpusSha256,'CC BY 4.0','原诊断文档依据','不证明修改正确','noopener noreferrer'])
    assert.ok(html.includes(expected),expected);
  hostile.results[0].url='javascript:alert(1)'; assert.throws(() => documentEvidenceHTML(hostile));
});
