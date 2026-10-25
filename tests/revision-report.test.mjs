// Synthetic presentation contracts, not actual compilation, retrieval ranking,
// user evaluation, or A/B results. Document text comes from the pinned corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateRevision } from '../web/revision.mjs';
import { revisionHTML } from '../web/revision-report.mjs';

const baseRecord = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json', import.meta.url),'utf8'));
const corpusText = await readFile(new URL('../data/docs/cangjie-1.0.5.json', import.meta.url),'utf8');
const corpus = JSON.parse(corpusText);
const hash = value => createHash('sha256').update(value).digest('hex');
function revisionFixture(version=2) {
  const source = {name:'manual.cj', text:baseRecord.source.text.replace('"three"','3')};
  return {schemaVersion:version, kind:'doctor-manual-revision', revisionId:'b'.repeat(32), createdAt:'2026-10-25T00:00:00.000Z',
    baseRecord:structuredClone(baseRecord), recordSha256:hash(JSON.stringify(baseRecord)), source:{...source,sha256:hash(source.text)},
    origin:'manual', compileStatus:'not_run', testStatus:'not_run', execution:{attempted:false},
    ...(version === 2 ? {documentEvidence:null, documentEvidenceSha256:null} : {})};
}
function attachEvidence(revision, results=[{...corpus.documents[0],score:1}]) {
  revision.documentEvidence = {schemaVersion:1,sdkVersion:corpus.sdkVersion,snapshotId:corpus.snapshotId,
    sourceRevision:corpus.sourceRevision,algorithm:'bm25',parameters:{k1:1.2,b:0.75},query:'synthetic manual reference',
    effectiveQuery:'synthetic manual reference',queryExpansion:'compiler-glossary-v1',
    tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,results:structuredClone(results),
    kind:'doctor-document-evidence',retrievalId:'e'.repeat(32),createdAt:'2026-10-24T23:59:59.000Z',
    sourceName:baseRecord.source.name,sourceSha256:baseRecord.source.sha256,recordSha256:revision.recordSha256,
    compilerVersion:baseRecord.compiler.version,corpusSha256:hash(corpusText),queryOrigin:'manual'};
  revision.documentEvidenceSha256 = hash(JSON.stringify(revision.documentEvidence));
  return revision;
}

test('legacy and new unattached revisions export the original diagnosis and remain unverified',async () => {
  for (const version of [1,2]) {
    const revision = revisionFixture(version), before = structuredClone(revision);
    await validateRevision(revision);
    const html = revisionHTML(revision);
    assert.match(html,/未编译 · 未测试/);
    assert.match(html,/本次修改未附带文档检索依据；不能据此推断未参考文档/);
    assert.match(html,/修改前的诊断/);
    assert.match(html,/mismatched types/);
    assert.match(html,/原诊断属于修改前的源码/);
    assert.match(html,/− .*&quot;three&quot;/);
    assert.match(html,/\+ .*Int64 = 3/);
    assert.match(html,/后续验证结果须查看对应的独立公开测试报告/);
    assert.match(html,/没有 AI 修复、保留测试或正式 A\/B 成绩/);
    assert.match(html,/default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'/);
    assert.equal((html.match(/<h2>原诊断文档依据<\/h2>/g) || []).length,1);
    for (const id of [revision.revisionId,revision.source.sha256,revision.recordSha256,revision.createdAt]) assert.ok(html.includes(id));
    assert.deepEqual(revision,before);
  }
});

test('attached evidence exports its hash, original provenance, official source and license',async () => {
  const revision = attachEvidence(revisionFixture()), before = structuredClone(revision);
  await validateRevision(revision);
  const html = revisionHTML(revision), evidence = revision.documentEvidence;
  for (const value of [revision.documentEvidenceSha256,evidence.retrievalId,evidence.snapshotId,evidence.sourceRevision,
    evidence.corpusSha256,evidence.query,evidence.results[0].url,evidence.results[0].title]) assert.ok(html.includes(value),value);
  assert.match(html,/CC BY 4\.0/);
  assert.match(html,/不是修改后源码的新诊断，也不证明修改正确或已通过测试/);
  assert.equal((html.match(/<h2>原诊断文档依据<\/h2>/g) || []).length,1);
  assert.deepEqual(revision,before);
  assert.equal(revision.compileStatus,'not_run'); assert.equal(revision.testStatus,'not_run');
});

test('an attached zero-match search stays distinct from missing evidence and never implies correctness',async () => {
  const revision = attachEvidence(revisionFixture(),[]);
  await validateRevision(revision);
  const html = revisionHTML(revision);
  assert.match(html,/该次查询没有命中；无匹配不表示源码正确或官方文档没有相关说明/);
  assert.doesNotMatch(html,/本次修改未附带文档检索依据/);
  assert.match(html,/未编译 · 未测试/);
  assert.ok(html.includes(revision.documentEvidence.retrievalId));
});

test('hostile source and reference text remain literal text in the standalone report',async () => {
  const payload = '</pre></title><script>alert("synthetic")</script><img src=x onerror=alert(1)> & \'quoted\'';
  const revision = attachEvidence(revisionFixture());
  revision.source.text += '// ' + payload + '\n'; revision.source.sha256 = hash(revision.source.text);
  revision.documentEvidence.query = revision.documentEvidence.effectiveQuery = payload;
  Object.assign(revision.documentEvidence.results[0],{title:payload,section:payload,text:payload});
  revision.documentEvidenceSha256 = hash(JSON.stringify(revision.documentEvidence));
  await validateRevision(revision);
  const html = revisionHTML(revision);
  assert.match(html,/&lt;\/pre&gt;&lt;\/title&gt;&lt;script&gt;/);
  assert.match(html,/&quot;synthetic&quot;/); assert.match(html,/&#39;quoted&#39;/);
  assert.doesNotMatch(html,/<(?:script|img|iframe|object|embed|link|form)\b/i);
  assert.equal((html.match(/<title>/g) || []).length,1);
  assert.equal((html.match(/<\/title>/g) || []).length,1);
});

test('validation refuses hostile links, corrupted evidence and evidence from another original diagnosis',async () => {
  for (const url of ['javascript:alert(1)','file:///C:/secret','http://docs.cangjie-lang.cn/','https://docs.cangjie-lang.cn.invalid.example/',
    'https://github.com/other/repository/','https://user:password@docs.cangjie-lang.cn/']) {
    const revision = attachEvidence(revisionFixture()); revision.documentEvidence.results[0].url = url;
    revision.documentEvidenceSha256 = hash(JSON.stringify(revision.documentEvidence));
    await assert.rejects(validateRevision(revision),/官方文档链接/,url);
  }
  const corrupt = attachEvidence(revisionFixture()); corrupt.documentEvidence.query = 'changed';
  await assert.rejects(validateRevision(corrupt),/SHA-256/);
  const foreign = attachEvidence(revisionFixture()); foreign.documentEvidence.sourceSha256 = '0'.repeat(64);
  foreign.documentEvidenceSha256 = hash(JSON.stringify(foreign.documentEvidence));
  await assert.rejects(validateRevision(foreign),/原诊断记录不一致/);
});
