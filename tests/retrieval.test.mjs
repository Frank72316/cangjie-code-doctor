// Transport fixtures below are synthetic checks, not retrieval evaluation data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { NativeBridge } from '../scripts/native-bridge.mjs';
import { makeServer } from '../scripts/preview.mjs';
import { officialUrl } from '../scripts/retrieval.mjs';
const original = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const digest = text => createHash('sha256').update(text).digest('hex');
const corpus = {schemaVersion:1,sdkVersion:'1.0.5',snapshotId:'synthetic-contract-check',sourceRevision:'test-only',
  documents:[{id:'test-types',title:'合成类型条款',section:'合成检查',
    url:'https://docs.cangjie-lang.cn/docs/1.0.5/test-only.html',text:'这是合成的接口检查数据，不是官方文档摘录或实验成绩。'}]};
async function fixture(executor) {
  await mkdir('runs',{recursive:true});
  const root = resolve(await mkdtemp('runs/retrieval-contract-'));
  await mkdir(join(root,'data/docs'),{recursive:true});
  const text = JSON.stringify(corpus);
  await writeFile(join(root,'data/docs/cangjie-1.0.5.json'),text);
  await writeFile(join(root,'data/docs/manifest.json'),JSON.stringify({sdkVersion:'1.0.5',corpusFile:'cangjie-1.0.5.json',
    snapshotId:corpus.snapshotId,sourceRevision:corpus.sourceRevision,corpusSha256:digest(text)}));
  const bridge = new NativeBridge({root,executable:'synthetic-core',compiler:'synthetic-compiler',executor});
  bridge.health = {available:true};
  return {bridge,root};
}
async function nativeResponse(_,args,options) {
  assert.equal(args[0],'retrieve'); assert.ok(args.slice(1).every(arg=>/^[\x00-\x7f]*$/.test(arg)));
  const query = JSON.parse(await readFile(join(options.cwd,args[2]),'utf8'));
  const savedCorpus = JSON.parse(await readFile(join(options.cwd,args[1]),'utf8'));
  assert.equal(savedCorpus.snapshotId,corpus.snapshotId);
  return {code:0,signal:null,reason:'',stderr:'',stdout:JSON.stringify({schemaVersion:1,sdkVersion:'1.0.5',
    snapshotId:corpus.snapshotId,sourceRevision:corpus.sourceRevision,algorithm:'bm25',parameters:{k1:1.2,b:0.75},
    query:query.query,effectiveQuery:query.query,queryExpansion:'compiler-glossary-v1',
    tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,results:[{...corpus.documents[0],score:1.5}]})};
}
test('retrieval binds input, snapshot and native citations to durable evidence',async()=>{
  const {bridge,root} = await fixture(nativeResponse);
  const result = await bridge.retrieve({record:original});
  assert.equal(result.kind,'doctor-document-evidence');
  assert.equal(result.sourceSha256,original.source.sha256);
  assert.equal(result.recordSha256,digest(JSON.stringify(original)));
  assert.equal(result.queryOrigin,'diagnostics'); assert.match(result.query,/mismatched types/);
  assert.equal(bridge.busy,false);
  const directory = join(root,'runs/retrieval',result.retrievalId);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'evidence.json'),'utf8')),result);
  assert.equal(digest(await readFile(join(directory,'corpus.json'))),result.corpusSha256);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'request.json'),'utf8')).record,original);
});
test('no-hit retrieval remains an empty result and manual query is recorded',async()=>{
  const {bridge} = await fixture(async(...args)=>{
    const r = await nativeResponse(...args), parsed = JSON.parse(r.stdout); parsed.results = [];
    return {...r,stdout:JSON.stringify(parsed)};
  });
  const result = await bridge.retrieve({record:original,query:'没有匹配的词'});
  assert.deepEqual(result.results,[]); assert.equal(result.queryOrigin,'manual');
  assert.equal(result.query,'没有匹配的词');
});
test('version mismatch, invalid source hash and path injection never launch retrieval',async()=>{
  let calls = 0; const {bridge} = await fixture(()=>{ calls++; throw new Error('must not start'); });
  const changed = structuredClone(original); changed.compiler.version = 'Cangjie Compiler: 1.2.0 (cjnative)';
  await assert.rejects(bridge.retrieve({record:changed}),e=>e.status===422);
  changed.compiler.version = original.compiler.version; changed.source.text += ' ';
  await assert.rejects(bridge.retrieve({record:changed}),/SHA-256/);
  await assert.rejects(bridge.retrieve({record:original,path:'../../holdout'}),e=>e.status===400);
  await assert.rejects(bridge.retrieve({record:original,query:'x'.repeat(2001)}),e=>e.status===400);
  assert.equal(calls,0); assert.equal(bridge.busy,false);
});
test('mutated snapshot is refused before launching the native core',async()=>{
  let calls=0; const {bridge,root} = await fixture(()=>{calls++;});
  await writeFile(join(root,'data/docs/cangjie-1.0.5.json'),JSON.stringify({...corpus,snapshotId:'changed'}));
  await assert.rejects(bridge.retrieve({record:original}),/摘要不一致/);
  assert.equal(calls,0);
});
test('forged citations, duplicate matches and invalid scores never become saved evidence',async()=>{
  for (const mode of ['text','url','duplicate','score','snapshot']) {
    const {bridge,root} = await fixture(async(...args)=>{
      const r = await nativeResponse(...args), result = JSON.parse(r.stdout);
      if (mode === 'duplicate') result.results.push(result.results[0]);
      else if (mode === 'snapshot') result.snapshotId='other-version';
      else if (mode === 'score') result.results[0].score=-1;
      else result.results[0][mode] = 'forged';
      return {...r,stdout:JSON.stringify(result)};
    });
    await assert.rejects(bridge.retrieve({record:original}));
    const [id] = await readdir(join(root,'runs/retrieval'));
    const files = await readdir(join(root,'runs/retrieval',id));
    assert.ok(files.includes('failure.json')); assert.ok(!files.includes('evidence.json')); assert.equal(bridge.busy,false);
  }
});
test('cancelled native retrieval keeps failure evidence and releases the busy state',async()=>{
  const {bridge,root} = await fixture(async()=>({code:null,signal:null,reason:'cancelled',stdout:'',stderr:''}));
  await assert.rejects(bridge.retrieve({record:original}),/cancelled/);
  const [id] = await readdir(join(root,'runs/retrieval'));
  const failure = JSON.parse(await readFile(join(root,'runs/retrieval',id,'failure.json'),'utf8'));
  assert.equal(failure.process.reason,'cancelled'); assert.equal(bridge.busy,false);
  bridge.busy=true;
  await assert.rejects(bridge.retrieve({record:original}),e=>e.status===409);
  bridge.busy=false; const controller=new AbortController(); controller.abort();
  await assert.rejects(bridge.retrieve({record:original},controller.signal),e=>e.status===499);
  assert.equal((await readdir(join(root,'runs/retrieval'))).length,1);
});
test('documentation URLs reject executable schemes and misleading hosts',()=>{
  assert.ok(officialUrl('https://docs.cangjie-lang.cn/docs/1.0.5/section.html'));
  assert.ok(officialUrl('https://github.com/cangjielanguage/cangjie_docs/blob/commit/section.md'));
  for (const url of ['javascript:alert(1)','https://docs.cangjie-lang.cn.evil.example/x','https://user@docs.cangjie-lang.cn/x',
    'https://github.com/other/project','http://docs.cangjie-lang.cn/x']) assert.equal(officialUrl(url),false);
});
test('retrieval HTTP endpoint enforces local token, origin, body limit and input schema',async t=>{
  const {bridge} = await fixture(nativeResponse);
  const server=makeServer({bridge}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}/api/retrieve`;
  const headers={'Content-Type':'application/json','X-Doctor-Token':bridge.token};
  const post=(body,extra={})=>fetch(base,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  assert.equal((await post({record:original},{'X-Doctor-Token':''})).status,403);
  assert.equal((await post({record:original},{Origin:'https://outside.example'})).status,403);
  assert.equal((await post({record:original},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post({record:original,corpus:'../../private'})).status,400);
  assert.equal((await post({record:original,query:'x'.repeat(2200000)})).status,413);
  const response=await post({record:original,query:'类型'}); assert.equal(response.status,200);
  assert.equal((await response.json()).query,'类型');
});
