import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {rankWithReceiver} from './rank-api-receiver.mjs';
import {rankWithOperation} from './rank-api-operation.mjs';
import {nativeRanking} from './native-api-ranking.mjs';
import {challengeQuery,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {sha,SYSTEM} from './pilot-common.mjs';
import {directory,read,dump,operationStudy} from './api-evidence-common.mjs';

assert.ok(operationStudy,'Pass --operation');
const tasks=read('transfer'), labels=read('labels'), gate=read('materials/receipt');
assert.ok(gate.accepted && gate.rows.length===12);
assert.equal(gate.transferSha256,sha(tasks));
assert.equal(gate.holdoutSha256,read('transfer.enc').sha256);
const base='docs/experiments/2026-11-27-api-families';
const apiRaw=await fs.readFile(base+'/corpus.json','utf8');
assert.equal(sha(apiRaw),JSON.parse(await fs.readFile(base+'/sources.json','utf8')).corpusSha256);
const api=JSON.parse(apiRaw), docs=new Map(api.documents.map(d=>[d.id,d]));
const guideFile='data/experiments/challenge-v1/corpus.json', guideRaw=await fs.readFile(guideFile,'utf8');
const guide=JSON.parse(guideRaw),folder='tmp/api-operation-queries';
await fs.mkdir(folder,{recursive:true});
const cases=[];
for(const task of tasks){
  const label=labels.find(l=>l.id===task.id);
  assert.ok(label.acceptable.includes(label.gold) && label.acceptable.every(id=>docs.get(id)?.title===label.panel));
  const initial=gate.rows.find(r=>r.caseId===task.id).initial;
  const query=challengeQuery(task,initial);
  const guides=await nativeRanking(folder,task,query,guideFile,guide);
  assert.ok(guides.length>=2);
  const rank=text=>{
    const t=rankWithReceiver(api,text,task.source.text), i=rankWithOperation(api,text,task.source.text);
    const top=list=>list.slice(0,3).map(d=>d.id);
    return {T:top(t.ranks),I:top(i.ranks),owner:t.owner,facets:i.facets};
  };
  const primary=rank(task.task), alternate=rank(label.alternate);
  const requests={}, hashes={};
  for(const group of ['G','T','I']){
    const chosen=guides.slice(0,2);
    if(group!=='G') chosen.push(docs.get(primary[group][0]));
    const documents=chosen.map(({id,title,url,text})=>({id,title,url,text}));
    const data={sdkVersion:'1.0.5',task:task.task,source:task.source,publicTests:task.publicTests,initial,documents};
    requests[group]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(data)}]};
    hashes[group]=sha(requests[group]);
  }
  const normalized=group=>{
    const body=structuredClone(requests[group]), msg=body.messages[1], data=JSON.parse(msg.content);
    assert.equal(data.documents.length,group==='G'?2:3);
    assert.deepEqual(Object.keys(data).sort(),['documents','initial','publicTests','sdkVersion','source','task']);
    data.documents=data.documents.slice(0,2);
    msg.content=JSON.stringify(data);
    return body;
  };
  assert.deepEqual(normalized('G'),normalized('T'));assert.deepEqual(normalized('G'),normalized('I'));
  cases.push({...label,primary,alternateRanks:alternate,query,hashes,requests});
}
const pairs=[...new Set(labels.map(l=>l.pair))];
assert.equal(pairs.length,6);
const paired=pairs.map(id=>cases.filter(c=>c.pair===id));
for(const [a,b,...rest] of paired){
  assert.equal(rest.length,0);assert.ok(a && b);
  const body=c=>tasks.find(t=>t.id===c.id).source.text.split('\nmain()')[0];
  assert.equal(body(a),body(b));
  const publicMain=c=>tasks.find(t=>t.id===c.id).source.text.split('\nmain()')[1];
  assert.notEqual(publicMain(a),publicMain(b));
}
const orders=[['G','T','I'],['G','I','T'],['T','G','I'],['T','I','G'],['I','G','T'],['I','T','G']];
const schedule=[];
for(let r=0;r<2;r++)for(let side=0;side<2;side++)for(const [index,pair] of paired.entries()){
  const c=pair[(side+r)%2], order=orders[(index+side+3*r)%6];
  for(const group of order)schedule.push({caseId:c.id,repeat:r+1,group});
}
const maximumReservedCNY=schedule.reduce((sum,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return sum+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===72 && maximumReservedCNY<=5);
const rankerHashes={};
for(const name of ['rank-api-sections','rank-api-receiver','rank-api-operation'])rankerHashes[name]=sha((await fs.readFile('scripts/'+name+'.mjs','utf8')).replaceAll('\r\n','\n'));
const design={model:CHALLENGE_SETTINGS.model,rankerHashes,labelsSha256:sha(labels),apiCorpusSha256:sha(apiRaw),
 guideCorpusSha256:sha(guideRaw),materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,
 priorCNY:3.472668,capCNY:5,maximumReservedCNY,cases,schedule};
if(process.argv.includes('--verify'))assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({cases:cases.length,pairs:pairs.length,requests:schedule.length,maximumReservedCNY}));
