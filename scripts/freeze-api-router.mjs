import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {routeNodeEvidence} from './route-node-evidence.mjs';
import {CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {sha, SYSTEM} from './pilot-common.mjs';

assert.equal(setting.generation,'api-router');
const tasks = read('transfer'), panels = read('panels'), gate = read('materials/receipt');
assert.ok(gate.accepted && gate.reports === 128 && gate.rows.length === 32);
assert.equal(gate.transferSha256,sha(tasks));
assert.equal(gate.holdoutSha256,read('transfer.enc').sha256);
const previous = JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-node/design.json','utf8'));
const cards = JSON.parse(previous.cases[0].requests.B.messages[1].content).documents;
assert.deepEqual(cards.map(c=>c.id),['signatures-LinkedList','node-members','option-match']);
for (const c of previous.cases) assert.deepEqual(JSON.parse(c.requests.B.messages[1].content).documents,cards);
const cases = tasks.map((task,i) => {
  assert.equal(task.id,panels[i].id);
  assert.equal(task.id,gate.rows[i].caseId);
  const choices = routeNodeEvidence(task.source.text, task.task);
  const requests = {}, hashes = {};
  for (const group of ['L','A']) {
    const documents = group==='A' ? cards : cards.slice(0,1);
    const payload = {sdkVersion:'1.0.5',task:task.task,source:task.source,publicTests:task.publicTests,initial:gate.rows[i].initial,documents};
    requests[group] = {...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(payload)}]};
    hashes[group]=sha(requests[group]);
  }
  const l = JSON.parse(requests.L.messages[1].content), a = JSON.parse(requests.A.messages[1].content);
  assert.deepEqual({...a,documents:a.documents.slice(0,1)},l);
  return {...panels[i],policy:{L:'L',A:'A',S:choices.sourceOnly?'A':'L',J:choices.combined?'A':'L'},requests,hashes};
});
const schedule=[];
for(let r=1;r<=3;r++) {
  for(let j=0;j<cases.length;j++) {
    const i=r===2 ? cases.length-1-j : j;
    const order=(i+r)%2===0 ? ['A','L']:['L','A'];
    for(const group of order) schedule.push({caseId:cases[i].id,repeat:r,group});
  }
}
const maximumReservedCNY=schedule.reduce((sum,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return sum+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===192 && maximumReservedCNY <= setting.cap);
const design={model:CHALLENGE_SETTINGS.model,priorCNY:5.096668,capCNY:setting.cap,maximumReservedCNY,
  materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,cardSha256:sha(cards),
  routeSha256:sha(fs.readFileSync('scripts/route-node-evidence.mjs','utf8').replaceAll('\r\n','\n')),cases,schedule};
if(process.argv.includes('--verify')) assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({requests:schedule.length,maximumReservedCNY,materialReports:gate.reports}));
