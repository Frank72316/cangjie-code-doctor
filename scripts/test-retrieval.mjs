// Actual native retrieval and HTTP checks on public development records only.
// These checks do not measure repair success or use the evaluation/holdout set.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { NativeBridge } from './native-bridge.mjs';
import { makeServer } from './preview.mjs';
import { RevisionStore } from './revision-store.mjs';
import { readRecord, compileView, sha256 } from '../web/report.mjs';
import { validateRevision } from '../web/revision.mjs';
import { revisionHTML } from '../web/revision-report.mjs';

const bridge = new NativeBridge({root:process.cwd(),executable:resolve(process.argv[2]),compiler:resolve(process.argv[3])});
assert.equal((await bridge.probe()).available,true);
const corpusBytes = await readFile('data/docs/cangjie-1.0.5.json');
const corpus = JSON.parse(corpusBytes);
const corpusSha = createHash('sha256').update(corpusBytes).digest('hex');
const sources = new Map(corpus.documents.map(doc=>[doc.id,doc]));
for (const name of ['type_mismatch','undefined_name','argument_count']) {
  const record = JSON.parse(await readFile(`tests/fixtures/${name}.json`,'utf8'));
  const evidence = await bridge.retrieve({record});
  assert.equal(evidence.kind,'doctor-document-evidence');
  assert.equal(evidence.corpusSha256,corpusSha);
  assert.equal(evidence.sourceSha256,record.source.sha256);
  assert.ok(evidence.results.length > 0,'Development diagnostic should have lexical matches');
  for (const hit of evidence.results) {
    const {score,...source} = hit; assert.ok(score > 0);
    assert.deepEqual(source,sources.get(hit.id),'Native citation must reproduce the pinned source exactly');
  }
  const saved = JSON.parse(await readFile(join('runs/retrieval',evidence.retrievalId,'evidence.json'),'utf8'));
  assert.deepEqual(saved,evidence);
  const repeat = await bridge.retrieve({record});
  assert.deepEqual(repeat.results,evidence.results,'Same frozen inputs produce identical ordering and scores');
  console.log(`PASS native evidence, snapshot and repeatability: ${name} → ${evidence.results.map(hit=>hit.id).join(', ')}`);
}
const record = JSON.parse(await readFile('tests/fixtures/type_mismatch.json','utf8'));
const empty = await bridge.retrieve({record,query:'zzznomatchdoctor2026'});
assert.deepEqual(empty.results,[]);
const server = makeServer({bridge}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'Content-Type':'application/json','X-Doctor-Token':bridge.token};
  const response = await fetch(base+'/api/retrieve',{method:'POST',headers,body:JSON.stringify({record,query:'函数 参数 调用'})});
  assert.equal(response.status,200);
  const result = await response.json(); assert.equal(result.queryOrigin,'manual');
  assert.ok(result.results.some(hit=>hit.id.startsWith('function-')));
  const changed = structuredClone(record); changed.compiler.version='Cangjie Compiler: 1.2.0 (cjnative)';
  assert.equal((await fetch(base+'/api/retrieve',{method:'POST',headers,body:JSON.stringify({record:changed})})).status,422);
  console.log('PASS HTTP official-document retrieval, empty matches and SDK mismatch rejection');

  // A confirmed manual edit references a server-owned completed native retrieval.
  // Saving and exporting it never compiles or executes this candidate source.
  const source = {name:record.source.name,text:record.source.text.replace('"three"','4')};
  const saveRevision = input => fetch(base+'/api/revisions',{
    method:'POST',headers,body:JSON.stringify({baseRecord:record,source,confirmed:true,...input})
  });
  const savedResponse = await saveRevision({retrievalId:result.retrievalId});
  assert.equal(savedResponse.status,200);
  const revision = await validateRevision(await savedResponse.json());
  assert.equal(revision.schemaVersion,2);
  assert.deepEqual(revision.documentEvidence,result);
  assert.equal(revision.documentEvidenceSha256,await sha256(JSON.stringify(result)));
  assert.equal(revision.compileStatus,'not_run');
  assert.equal(revision.testStatus,'not_run');
  assert.equal(revision.execution.attempted,false);
  const readResponse = await fetch(`${base}/api/revisions/${revision.revisionId}`,{headers});
  assert.equal(readResponse.status,200);
  assert.deepEqual(await readResponse.json(),revision);
  assert.deepEqual(await new RevisionStore(process.cwd()).get(revision.revisionId),revision);
  console.log('PASS HTTP native retrieval → confirmed revision v2 → GET and fresh-store evidence persistence');

  const differentRecord = structuredClone(record);
  differentRecord.compiler.stdout += '\n';
  await readRecord(JSON.stringify(differentRecord));
  assert.equal(compileView(differentRecord).status,compileView(record).status);
  const mismatchResponse = await saveRevision({baseRecord:differentRecord,retrievalId:result.retrievalId});
  assert.equal(mismatchResponse.status,400,'The same source with different compiler evidence is a different diagnosis');
  assert.equal(typeof (await mismatchResponse.json()).error,'string');
  console.log('PASS HTTP rejects native evidence bound to a different valid diagnosis');

  const unreferencedResponse = await saveRevision({});
  assert.equal(unreferencedResponse.status,200);
  const unreferenced = await validateRevision(await unreferencedResponse.json());
  assert.equal(unreferenced.schemaVersion,2);
  assert.equal(unreferenced.documentEvidence,null);
  assert.equal(unreferenced.documentEvidenceSha256,null);
  const noMatchResponse = await saveRevision({retrievalId:empty.retrievalId});
  assert.equal(noMatchResponse.status,200);
  const noMatch = await validateRevision(await noMatchResponse.json());
  assert.deepEqual(noMatch.documentEvidence,empty);
  assert.deepEqual(noMatch.documentEvidence.results,[]);
  assert.equal(noMatch.documentEvidenceSha256,await sha256(JSON.stringify(empty)));
  assert.notEqual(noMatch.documentEvidence,null,'A completed zero-match retrieval is distinct from no attached evidence');
  console.log('PASS HTTP revisions distinguish unreferenced edits from completed zero-match native retrievals');

  const html = revisionHTML(revision);
  assert.ok(html.includes(result.retrievalId));
  assert.ok(html.includes(result.recordSha256));
  assert.ok(html.includes(result.corpusSha256));
  assert.ok(html.includes(result.results[0].url.replaceAll('&','&amp;')));
  assert.match(html,/未编译/);
  assert.match(html,/未测试/);
  assert.match(revisionHTML(unreferenced),/未附带/);
  assert.match(revisionHTML(noMatch),/没有命中/);
  console.log('PASS offline revision HTML includes actual native citations and keeps uncompiled/untested boundaries');
} finally { await new Promise(r=>server.close(r)); }
