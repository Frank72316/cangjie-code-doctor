import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {collectionSignatures} from './collection-signatures.mjs';
import {rankWithOperation} from './rank-api-operation.mjs';
import {nativeRanking} from './native-api-ranking.mjs';
import {challengeQuery,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {sha,SYSTEM} from './pilot-common.mjs';
import {directory,read,dump,wordingStudy} from './api-evidence-common.mjs';

assert.ok(wordingStudy,'Pass --wording');
const parent='docs/experiments/2026-11-27-operation', reference=JSON.parse(await fs.readFile(parent+'/design.json','utf8'));
const tasks=read('transfer'), gate=read('materials/receipt');
assert.ok(gate.accepted && gate.rows.length===12);
assert.equal(sha(gate),reference.materialReceiptSha256);
assert.equal(sha(tasks),gate.transferSha256);
assert.equal(read('transfer.enc').sha256,reference.newHoldoutSha256);
const apiRaw=await fs.readFile('docs/experiments/2026-11-27-api-families/corpus.json','utf8');
const api=JSON.parse(apiRaw),byId=new Map(api.documents.map(d=>[d.id,d]));
const guideFile='data/experiments/challenge-v1/corpus.json',guideRaw=await fs.readFile(guideFile,'utf8');
assert.equal(sha(apiRaw),reference.apiCorpusSha256);assert.equal(sha(guideRaw),reference.guideCorpusSha256);
const guides=JSON.parse(guideRaw),work='tmp/api-wording-queries';await fs.mkdir(work,{recursive:true});
const groups=['FF','FN','NF','NN','NS','NG'],cases=[];
for(const task of tasks){
  const old=reference.cases.find(c=>c.id===task.id),wording={F:task.task,N:old.alternate};
  const initial=gate.rows.find(r=>r.caseId===task.id).initial;
  const query=challengeQuery({source:task.source,task:''},initial);
  const common=(await nativeRanking(work,task,query,guideFile,guides)).slice(0,2);
  assert.equal(common.length,2);
  const apiIds={};
  for(const w of ['F','N']){
    apiIds[w]=rankWithOperation(api,wording[w],task.source.text).ranks[0].id;
    assert.equal(apiIds[w],(w==='F'?old.primary:old.alternateRanks).I[0]);
  }
  const signatures=collectionSignatures(api,task.source.text);
  const evidence={F:byId.get(apiIds.F),N:byId.get(apiIds.N),S:signatures?.document??byId.get(apiIds.N)};
  const requests={},hashes={};
  for(const group of groups){
    const [w,doc]=group;
    const documents=(doc==='G'?common:[...common,evidence[doc]]).map(({id,title,url,text})=>({id,title,url,text}));
    const data={sdkVersion:'1.0.5',task:wording[w],source:task.source,publicTests:task.publicTests,initial,documents};
    requests[group]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(data)}]};
    hashes[group]=sha(requests[group]);
  }
  const payload=g=>JSON.parse(requests[g].messages[1].content);
  for(const g of groups){
    const p=payload(g),n=payload('NG');
    assert.equal(p.task,wording[g[0]]);
    assert.equal(p.documents.length,g==='NG'?2:3);
    assert.deepEqual({...p,task:n.task,documents:p.documents.slice(0,2)},n);
  }
  assert.deepEqual(payload('FF').documents,payload('NF').documents);
  assert.deepEqual(payload('FN').documents,payload('NN').documents);
  cases.push({id:task.id,pair:old.pair,panel:old.panel,guideQuery:query,apiIds,
    signatureSources:signatures?.sources??[],requests,hashes});
}
const pairs=[...new Set(cases.map(c=>c.pair))].map(p=>cases.filter(c=>c.pair===p));
assert.equal(pairs.length,6);assert.ok(pairs.every(p=>p.length===2));
const schedule=[],positions=Object.fromEntries(groups.map(g=>[g,Array(6).fill(0)]));
const order=[0,1,5,2,4,3];
for(let r=0;r<2;r++)for(let side=0;side<2;side++)for(const [i,pair] of pairs.entries()){
  const c=pair[(side+r)%2],offset=(i+side+3*r)%6;
  for(const [j,k] of order.entries()){
    const group=groups[(k+offset)%6];positions[group][j]++;
    schedule.push({caseId:c.id,repeat:r+1,group});
  }
}
assert.ok(groups.every(g=>positions[g].every(n=>n===4)));
const maximumReservedCNY=schedule.reduce((s,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return s+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===144 && maximumReservedCNY<=8);
const frozen={model:CHALLENGE_SETTINGS.model,parentDesignSha256:sha(reference),apiCorpusSha256:sha(apiRaw),guideCorpusSha256:sha(guideRaw),
 materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,priorCNY:3.932676,capCNY:8,maximumReservedCNY,groups,positions,cases,schedule};
if(process.argv.includes('--verify'))assert.deepEqual(frozen,read('design'));
else dump(directory+'/design.json',frozen);
console.log(JSON.stringify({requests:schedule.length,materialReports:gate.reports,maximumReservedCNY,
 changedDocuments:cases.filter(c=>c.apiIds.N!==c.apiIds.F).length,signatures:cases.map(c=>c.signatureSources.length)}));
