import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {rankApiSections} from './rank-api-sections.mjs';
import {rankWithReceiver} from './rank-api-receiver.mjs';
import {nativeRanking} from './native-api-ranking.mjs';
import {challengeQuery,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {sha,SYSTEM} from './pilot-common.mjs';
import {directory,read,dump,familyStudy} from './api-evidence-common.mjs';

assert.ok(familyStudy,'Pass --families');
const tasks=read('transfer'), labels=read('labels'), gate=read('materials/receipt');
assert.ok(gate.accepted && gate.rows.length===12);
assert.equal(gate.transferSha256,sha(tasks));
assert.equal(gate.holdoutSha256,read('transfer.enc').sha256);
const apiFile=directory+'/corpus.json', guideFile='data/experiments/challenge-v1/corpus.json';
const apiRaw=await fs.readFile(apiFile,'utf8'), guideRaw=await fs.readFile(guideFile,'utf8');
assert.equal(sha(apiRaw),read('sources').corpusSha256);
const api=JSON.parse(apiRaw), guide=JSON.parse(guideRaw), folder='tmp/api-family-queries';
await fs.mkdir(folder,{recursive:true});
const cases=[];
for(const task of tasks){
  const label=labels.find(l=>l.id===task.id);
  assert.ok(label.acceptable.includes(label.gold));
  for(const id of label.acceptable) assert.equal(api.documents.find(d=>d.id===id)?.title,label.panel);
  const initial=gate.rows.find(r=>r.caseId===task.id).initial;
  const query=challengeQuery(task,initial);
  const guides=await nativeRanking(folder,task,query,guideFile,guide);
  const original=await nativeRanking(folder,task,query,apiFile,api);
  const field=rankApiSections(api,task.task,task.source.text);
  const typed=rankWithReceiver(api,task.task,task.source.text);
  const top=list=>list.slice(0,3).map(d=>d.id);
  const ranks={B:top(original),F:top(field),T:top(typed.ranks)};
  assert.ok(guides.length>=2 && Object.values(ranks).every(ids=>ids.length===3));
  const requests={}, hashes={};
  for(const arm of ['F','T']){
    const apiEntry=api.documents.find(d=>d.id===ranks[arm][0]);
    const documents=[...guides.slice(0,2),apiEntry].map(({id,title,url,text})=>({id,title,url,text}));
    const data={sdkVersion:'1.0.5',task:task.task,source:task.source,publicTests:task.publicTests,initial,documents};
    requests[arm]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(data)}]};
    hashes[arm]=sha(requests[arm]);
  }
  cases.push({...label,detectedOwner:typed.owner,query,ranks,hashes,requests});
}
const families=[...new Set(labels.map(l=>l.panel))];
assert.ok(families.length===4 && families.every(f=>cases.filter(c=>c.panel===f).length===3));
const ordered=[0,1,2].flatMap(i=>families.map(f=>cases.filter(c=>c.panel===f)[i]));
const schedule=[];
for(let repeat=1;repeat<=2;repeat++) for(const [i,c] of ordered.entries()){
  for(const group of (i+repeat)%2 ? ['F','T'] : ['T','F']) schedule.push({caseId:c.id,repeat,group});
}
const maximumReservedCNY=schedule.reduce((s,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return s+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===48 && maximumReservedCNY<=4);
const rankerHashes={};
for(const p of ['rank-api-sections','rank-api-receiver']) rankerHashes[p]=sha((await fs.readFile('scripts/'+p+'.mjs','utf8')).replaceAll('\r\n','\n'));
const design={model:CHALLENGE_SETTINGS.model,rankerHashes,labelsSha256:sha(labels),apiCorpusSha256:sha(apiRaw),
  guideCorpusSha256:sha(guideRaw),materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,
  priorCNY:3.190156,capCNY:4,maximumReservedCNY,cases,schedule};
if(process.argv.includes('--verify')) assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({cases:cases.length,requests:schedule.length,maximumReservedCNY}));
