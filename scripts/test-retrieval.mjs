// Actual native retrieval and HTTP checks on public development records only.
// These checks do not measure repair success or use the evaluation/holdout set.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { NativeBridge } from './native-bridge.mjs';
import { makeServer } from './preview.mjs';

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
} finally { await new Promise(r=>server.close(r)); }
