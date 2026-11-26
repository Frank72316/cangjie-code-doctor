import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {AIService,loadAIConfig} from '../scripts/ai-service.mjs';import {makeServer} from '../scripts/preview.mjs';
const record=JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const secret='synthetic-secret-never-real';
const config={ready:true,key:secret,model:'deepseek-flash'};
const body={record,confirmed:true,retrievalId:null};
const response=()=>new Response(JSON.stringify({model:'synthetic-model',choices:[{message:{content:'仅为模拟建议'},finish_reason:'stop'}],usage:{prompt_tokens:30,completion_tokens:10,total_tokens:40}}));
const root=()=>mkdtemp(join(tmpdir(),'doctor-ai-'));
test('local config loads only allowed settings, never executable env or arbitrary hosts',async()=>{
 const dir=await root();assert.equal((await loadAIConfig(dir)).ready,false);
 await writeFile(join(dir,'.env.local'),`DEEPSEEK_API_KEY=${secret}\nDEEPSEEK_BASE_URL=https://evil.example\nDEEPSEEK_MODEL=deepseek-flash`);
 assert.equal((await loadAIConfig(dir)).ready,false);
 await writeFile(join(dir,'.env.local'),`DEEPSEEK_API_KEY=${secret}\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nDEEPSEEK_MODEL=deepseek-flash`);
 assert.equal((await loadAIConfig(dir)).ready,true);
});
test('bounded request uses fixed origin; status and durable records omit key',async()=>{
 const dir=await root();const s=new AIService({root:dir,config,fetcher:async(url,o)=>{
 assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(o.redirect,'error');
 assert.equal(o.headers.Authorization,`Bearer ${secret}`);const b=JSON.parse(o.body);assert.equal(b.max_tokens,1500);assert.equal(b.thinking.type,'disabled');assert.ok(!o.body.includes(secret));return response();}});
 const result=await s.explain(body);assert.equal(result.executed,false);assert.equal(result.formalExperiment,false);
 assert.ok(!JSON.stringify(s.health).includes(secret));
 for(const f of await readdir(join(dir,'runs/ai',result.id)))assert.ok(!(await readFile(join(dir,'runs/ai',result.id,f),'utf8')).includes(secret));
 assert.equal(s.health.used,1);
});
test('consent, record hash, retrieval binding and input schema rejected before sending',async()=>{
 let calls=0;const s=new AIService({root:await root(),config,fetcher:async()=>{calls++;return response();}});
 for(const bad of [{...body,confirmed:false},{...body,url:'https://evil.example'},{...body,retrievalId:'../secret'},
 {...body,record:{...record,source:{...record.source,text:'changed'}}},{...body,retrievalId:'0'.repeat(32)}])await assert.rejects(s.explain(bad));
 assert.equal(calls,0);assert.equal(s.health.used,0);
});
test('provider errors do not echo response secrets and do not retry',async()=>{
 let calls=0;const dir=await root();const s=new AIService({root:dir,config,fetcher:async()=>{calls++;return new Response(secret,{status:401});}});
 await assert.rejects(s.explain(body),e=>!e.message.includes(secret)&&/密钥/.test(e.message));assert.equal(calls,1);assert.equal(s.health.busy,false);
});
test('concurrency and ten request ceiling bound usage, truncation stays explicit',async()=>{
 let release;const pending=new Promise(r=>release=r);
 const s=new AIService({root:await root(),config,fetcher:async()=>{await pending;return response();}});
 const p=s.explain(body);await assert.rejects(s.explain(body),e=>e.status===409);release();await p;
 for(let i=0;i<9;i++)await s.explain(body);await assert.rejects(s.explain(body),e=>e.status===429);assert.equal(s.health.used,10);
});
test('HTTP endpoint protects config and outbound invocation with origin and token',async t=>{
 let calls=0;const aiService=new AIService({root:await root(),config,fetcher:async()=>{calls++;return response();}});
 const server=makeServer({bridge:{token:'synthetic-token'},aiService});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(url+'/api/ai/status')).status,403);
 const h={'X-Doctor-Token':'synthetic-token','Content-Type':'application/json'};
 assert.equal((await fetch(url+'/api/ai/explain',{method:'POST',headers:{...h,Origin:'https://evil.example'},body:JSON.stringify(body)})).status,403);
 assert.equal((await fetch(url+'/api/ai/explain',{method:'POST',headers:h,body:JSON.stringify({...body,confirmed:false})})).status,400);
 const status=await (await fetch(url+'/api/ai/status',{headers:h})).text();assert.ok(!status.includes(secret));assert.equal(calls,0);
 assert.equal((await fetch(url+'/.env.local')).status,404);
});
test('retrieved documents sent only when archived evidence binds to original record',async()=>{
 const {createHash}=await import('node:crypto');const digest=v=>createHash('sha256').update(v).digest('hex');
 const corpus=JSON.parse(await readFile(new URL('../data/docs/cangjie-1.0.5.json',import.meta.url),'utf8'));
 const id='1'.repeat(32),dir=await root();
 const evidence={schemaVersion:1,sdkVersion:'1.0.5',snapshotId:corpus.snapshotId,sourceRevision:corpus.sourceRevision,algorithm:'bm25',parameters:{k1:1.2,b:0.75},query:'类型',effectiveQuery:'类型',queryExpansion:'compiler-glossary-v1',tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,results:[{...corpus.documents[0],score:1}],kind:'doctor-document-evidence',retrievalId:id,createdAt:new Date().toISOString(),sourceName:record.source.name,sourceSha256:record.source.sha256,recordSha256:digest(JSON.stringify(record)),compilerVersion:record.compiler.version,corpusSha256:'a'.repeat(64),queryOrigin:'manual'};
 const corpusText=await readFile(new URL('../data/docs/cangjie-1.0.5.json',import.meta.url),'utf8');evidence.corpusSha256=digest(corpusText);
 await mkdir(join(dir,'data/docs'),{recursive:true});
 await writeFile(join(dir,'data/docs/cangjie-1.0.5.json'),corpusText);
 await writeFile(join(dir,'data/docs/manifest.json'),await readFile(new URL('../data/docs/manifest.json',import.meta.url)));
 await mkdir(join(dir,'runs/retrieval',id),{recursive:true});await writeFile(join(dir,'runs/retrieval',id,'evidence.json'),JSON.stringify(evidence));
 const folder=join(dir,'runs/retrieval',id);
 await writeFile(join(folder,'corpus.json'),corpusText);
 await writeFile(join(folder,'query.json'),JSON.stringify({sdkVersion:'1.0.5',query:'类型',topK:3}));
 await writeFile(join(folder,'request.json'),JSON.stringify({schemaVersion:1,kind:'doctor-retrieval-request',retrievalId:id,createdAt:evidence.createdAt,sourceSha256:record.source.sha256,recordSha256:evidence.recordSha256,corpusSha256:evidence.corpusSha256,query:'类型',queryOrigin:'manual',record}));
 const s=new AIService({root:dir,config,fetcher:async(_,o)=>{
  const context=JSON.parse(JSON.parse(o.body).messages[1].content);assert.equal(context.documents[0].text,corpus.documents[0].text);return response();}});
 assert.equal((await s.explain({...body,retrievalId:id})).retrievalId,id);
 evidence.results[0].text+=' forged';await writeFile(join(folder,'evidence.json'),JSON.stringify(evidence));
 await assert.rejects(s.explain({...body,retrievalId:id}),/快照/);assert.equal(s.health.used,1);
});
test('cancelled, malformed and oversized responses fail without a second request',async()=>{
 for(const mode of ['cancel','malformed','oversized']){
  let calls=0;const s=new AIService({root:await root(),config,fetcher:async()=>{calls++;
   if(mode==='cancel')throw new DOMException('upstream details '+secret,'AbortError');
   return new Response(mode==='malformed'?'not-json':'x'.repeat(128*1024+1));}});
  await assert.rejects(s.explain(body),e=>!e.message.includes(secret));assert.equal(calls,1);assert.equal(s.health.busy,false);
 }
});
test('model text is redacted and length termination is explicit',async()=>{
 const s=new AIService({root:await root(),config,fetcher:async()=>new Response(JSON.stringify({model:secret,choices:[{message:{content:'echo '+secret},finish_reason:'length'}]}))});
 const r=await s.explain(body);assert.equal(r.truncated,true);assert.ok(!JSON.stringify(r).includes(secret));
});
test('AI page integration preserves controls and all established page sections',async()=>{
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
 for(const id of ['task-history','refresh-history','history','workspace','document-evidence','ai-assistant','ai-answer-panel','source-file','record-file'])assert.ok(html.includes(`id="${id}"`),id);
});
