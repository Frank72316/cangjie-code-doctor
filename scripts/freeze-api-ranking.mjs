import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {rankApiSections} from './rank-api-sections.mjs';
import {challengeQuery,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {nativeRanking} from './native-api-ranking.mjs';
import {sha,SYSTEM} from './pilot-common.mjs';
import {directory,read,dump,rankingStudy} from './api-evidence-common.mjs';

assert.ok(rankingStudy,'Pass --ranking');
const dev=read('development'),tasks=read('transfer'),gate=read('materials/receipt'),labels=read('labels');
assert.equal(sha((await fs.readFile('scripts/rank-api-sections.mjs','utf8')).replaceAll('\r\n','\n')),dev.rankerSha256);
assert.ok(gate.accepted && gate.rows.length===12 && gate.transferSha256===sha(tasks) && gate.holdoutSha256===read('transfer.enc').sha256);
const apiFile='docs/experiments/2026-11-26-api-evidence/corpus.json';
const guideFile='data/experiments/challenge-v1/corpus.json';
const apiRaw=await fs.readFile(apiFile,'utf8'),guideRaw=await fs.readFile(guideFile,'utf8');
assert.equal(sha(apiRaw),dev.apiCorpusSha256);
const api=JSON.parse(apiRaw),guide=JSON.parse(guideRaw);
const folder='tmp/api-ranking-queries';await fs.mkdir(folder,{recursive:true});
const show=({id,title,text,url})=>({id,title,url,text});
const cases=[];
for(const task of tasks){
  const initial=gate.rows.find(r=>r.caseId===task.id).initial;
  const query=challengeQuery(task,initial);
  const guides=await nativeRanking(folder,task,query,guideFile,guide);
  const original=await nativeRanking(folder,task,query,apiFile,api),field=rankApiSections(api,task.task,task.source.text);
  const ranks={B:original.map(d=>d.id),F:field.slice(0,3).map(d=>d.id)};
  assert.equal(guides.length,3);
  const requests={},hashes={};
  for(const group of ['B','F']){
    const apiEntry=api.documents.find(d=>d.id===ranks[group][0]);assert.ok(apiEntry);
    const data={sdkVersion:'1.0.5',task:task.task,source:task.source,publicTests:task.publicTests,initial,
      documents:[...guides.slice(0,2),apiEntry].map(show)};
    requests[group]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(data)}]};
    hashes[group]=sha(requests[group]);
  }
  const annotation=labels.find(l=>l.id===task.id);
  assert.ok(api.documents.some(d=>d.id===annotation.gold));
  cases.push({...annotation,query,ranks,hashes,requests});
}
// Interleave task strata, rotate treatment order within a task over repetitions.
const panels=['seen','unseen'].map(panel=>cases.filter(c=>c.panel===panel));assert.ok(panels.every(p=>p.length===6));
const order=panels[0].flatMap((c,i)=>[c,panels[1][i]]);
const schedule=[];
for(let r=0;r<3;r++)for(const [i,c] of order.entries()) {
  const reverse=(Math.floor(i/2)+i%2+r)%2;
  for(const group of reverse?['F','B']:['B','F'])schedule.push({caseId:c.id,repeat:r+1,group});
}
const maximumReservedCNY=schedule.reduce((s,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return s+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===72 && maximumReservedCNY<=5);
const frozen={model:CHALLENGE_SETTINGS.model,rankerSha256:dev.rankerSha256,developmentSha256:sha(dev),
  labelsSha256:sha(labels),apiCorpusSha256:sha(apiRaw),guideCorpusSha256:sha(guideRaw),materialReceiptSha256:sha(gate),
  newHoldoutSha256:gate.holdoutSha256,priorCNY:2.767942,capCNY:5,maximumReservedCNY,cases,schedule};
if(process.argv.includes('--verify'))assert.deepEqual(frozen,read('design'));
else dump(directory+'/design.json',frozen);
console.log(JSON.stringify({cases:cases.length,requests:schedule.length,maximumReservedCNY}));
