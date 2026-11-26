import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {AIService} from '../scripts/ai-service.mjs';
import {AIHistory} from '../scripts/ai-history.mjs';
import {makeServer} from '../scripts/preview.mjs';
import {adviceMatchesCurrent} from '../web/ai-settings.mjs';
const record=JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const config={ready:true,key:'synthetic-test-key',model:'deepseek-flash'};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function saved(){
  const root=await mkdtemp(join(tmpdir(),'doctor-ai-history-'));
  const service=new AIService({root,config,fetcher:async()=>new Response(JSON.stringify({model:'synthetic',choices:[{message:{content:'模拟回答，不是实验结果'},finish_reason:'length'}],usage:{total_tokens:10}}))});
  const result=await service.explain({record,confirmed:true});
  return {root,result,folder:join(root,'runs/ai',result.id),history:new AIHistory(root)};
}
test('history recovers answer and exact sent context without config, network or core',async()=>{
  const {root,result,history}=await saved();
  const service=new AIService({root,config:{ready:false,detail:'not configured'},fetcher:()=>{throw Error('must not call');}});
  const list=await service.history();assert.equal(list.items[0].state,'completed');
  const item=await service.advice(result.id);assert.equal(item.result.answer,result.answer);assert.equal(item.result.truncated,true);
  assert.deepEqual(item.context.source,record.source);assert.equal(item.context.diagnostics[0].line,2);
  assert.deepEqual(item.context.documents,[]);assert.equal(service.health.used,0);
  assert.deepEqual(await history.read(result.id),item);
});
test('history distinguishes unfinished, failed, and contradictory records without implying success',async()=>{
  const {result,folder,history}=await saved();await unlink(join(folder,'result.json'));
  assert.equal((await history.read(result.id)).state,'incomplete');
  await writeFile(join(folder,'failure.json'),JSON.stringify({finishedAt:new Date().toISOString(),started:true,message:'synthetic upstream detail'}));
  const failed=await history.read(result.id);assert.equal(failed.state,'failed');assert.equal(failed.result,null);assert.ok(!JSON.stringify(failed).includes('synthetic upstream detail'));
  await writeFile(join(folder,'result.json'),JSON.stringify(result));await assert.rejects(history.read(result.id),e=>e.status===409);
  assert.equal((await history.list()).items[0].state,'invalid');
});
test('history rejects changed request, substituted source, invalid result and validation claims',async()=>{
  for(const change of ['request','source','id','flags','usage']){
    const {result,folder,history}=await saved();const q=JSON.parse(await readFile(join(folder,'request.json'),'utf8'));
    if(change==='request')q.messages[0].content='changed';
    if(change==='source'){const c=JSON.parse(q.messages[1].content);c.source.text='changed';q.messages[1].content=JSON.stringify(c);result.requestSha256=digest(JSON.stringify(q));}
    if(change==='id')result.id='0'.repeat(32);
    if(change==='flags')result.compiled=true;
    if(change==='usage')result.usage.total_tokens=-1;
    await writeFile(join(folder,'request.json'),JSON.stringify(q));await writeFile(join(folder,'result.json'),JSON.stringify(result));
    assert.equal((await history.list()).items[0].state,'invalid',change);
  }
});
test('history keeps attached document snapshot and rejects non-official links',async()=>{
  const {result,folder,history}=await saved();const q=JSON.parse(await readFile(join(folder,'request.json'),'utf8'));
  const c=JSON.parse(q.messages[1].content);c.documents=[{id:'example',title:'测试原文',url:'https://docs.cangjie-lang.cn/docs/1.0.5/',text:'合成测试文本'}];
  q.retrievalId='a'.repeat(32);result.retrievalId=q.retrievalId;
  async function update(){q.messages[1].content=JSON.stringify(c);result.requestSha256=digest(JSON.stringify(q));await writeFile(join(folder,'request.json'),JSON.stringify(q));await writeFile(join(folder,'result.json'),JSON.stringify(result));}
  await update();assert.equal((await history.read(result.id)).context.documents[0].text,'合成测试文本');
  c.documents[0].url='javascript:alert(1)';await update();await assert.rejects(history.read(result.id));
});
test('history handles empty, missing, malformed and oversized files with bounded public errors',async()=>{
  const empty=await mkdtemp(join(tmpdir(),'doctor-ai-empty-'));assert.deepEqual(await new AIHistory(empty).list(),{items:[],limited:false});
  const {result,folder,history}=await saved();
  await assert.rejects(history.read('../.env.local'),e=>e.status===400);await assert.rejects(history.read('f'.repeat(32)),e=>e.status===404);
  for(const raw of ['not-json','x'.repeat(192*1024+1)]){await writeFile(join(folder,'result.json'),raw);await assert.rejects(history.read(result.id),e=>e.status===409);}
  await unlink(join(folder,'request.json'));assert.equal((await history.list()).items[0].state,'invalid');
});
test('history rejects linked archive directories outside project',async()=>{
  const {root,result,folder,history}=await saved();const linkId='b'.repeat(32);
  await symlink(folder,join(root,'runs/ai',linkId),'junction');
  await assert.rejects(history.read(linkId),e=>e.status===409);assert.equal((await history.read(result.id)).state,'completed');
});
test('history list bounds loaded archives and labels remaining records',async()=>{
  const root=await mkdtemp(join(tmpdir(),'doctor-ai-limit-'));await mkdir(join(root,'runs/ai'),{recursive:true});
  for(let i=0;i<101;i++)await mkdir(join(root,'runs/ai',i.toString(16).padStart(32,'0')));
  const list=await new AIHistory(root).list();assert.equal(list.items.length,100);assert.equal(list.limited,true);assert.ok(list.items.every(r=>r.state==='invalid'));
});
test('history HTTP requires local token and origin even when model config is absent',async t=>{
  const {root,result}=await saved();const service=new AIService({root,config:{ready:false},fetcher:()=>{throw Error('no network');}});
  const server=makeServer({bridge:{token:'history-token'},aiService:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url=`http://127.0.0.1:${server.address().port}`,headers={'X-Doctor-Token':'history-token'};
  for(const path of ['/api/ai/history',`/api/ai/history/${result.id}`]){
    assert.equal((await fetch(url+path)).status,403);
    assert.equal((await fetch(url+path,{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(url+path,{headers})).status,200);
  }
  const data=await(await fetch(url+`/api/ai/history/${result.id}`,{headers})).json();assert.equal(data.result.executed,false);assert.equal(service.health.used,0);
});
test('restored advice matches only unchanged source, original diagnostics and current editor',async()=>{
  const {result,history}=await saved(),archive=await history.read(result.id),c={record:structuredClone(record),current:true,loading:false};
  assert.equal(adviceMatchesCurrent(archive,c),true);
  assert.equal(adviceMatchesCurrent(archive,{...c,current:false}),false);
  assert.equal(adviceMatchesCurrent(archive,{...c,loading:true}),false);
  const other=structuredClone(record);other.compiler.stderr='';assert.equal(adviceMatchesCurrent(archive,{...c,record:other}),false);
  other.source.sha256='f'.repeat(64);assert.equal(adviceMatchesCurrent(archive,{...c,record:other}),false);
});
