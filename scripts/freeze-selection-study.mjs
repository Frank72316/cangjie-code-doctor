import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read, setting, directory, dump} from './api-evidence-common.mjs';
import {sha, SYSTEM} from './pilot-common.mjs';
import {CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {selectExamples, contractResult} from './select-contract-examples.mjs';
import {decodePool} from './selection-observations.mjs';

assert.equal(setting.generation,'api-selection');
const tasks=read('transfer'), metas=read('starters'), choices=read('selection'), pool=read('pool'), gate=read('materials/receipt');
assert.ok(gate.accepted && gate.reports===144 && tasks.length===24);
assert.equal(gate.transferSha256,sha(tasks));
assert.equal(gate.probesSha256,sha(read('probes')));
assert.equal(gate.holdoutSha256,read('transfer.enc').sha256);
const cases=tasks.map((t,i)=>{
  const {id}=t, meta=metas[i], row=gate.rows[i], sel=choices[i];
  for(const other of [row.caseId,meta.id,sel.id]) assert.equal(other,id);
  assert.deepEqual(sel,{id,...selectExamples(id,pool)});
  const oracle=decodePool(row.probe.reference,pool), actual=decodePool(row.probe.starter,pool);
  assert.deepEqual(oracle,pool.map(x=>contractResult(id,x.array,x.t)));
  const prompt={sdkVersion:'1.0.5',task:t.task,source:t.source,publicTests:t.publicTests,initial:row.initial,documents:[],
    review:'请结合完整题意、源码、原公开样例和两组实测记录复查实现。若正确，保留原程序；如有问题，修正一般行为。'};
  const requests={}, hashes={};
  for(const g of ['U','D']){
    const examples=sel[g].map(j=>({input:pool[j],expected:oracle[j],observed:actual[j]}));
    const messages=[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({...prompt,examples})}];
    requests[g]={...CHALLENGE_SETTINGS,messages};hashes[g]=sha(requests[g]);
  }
  return {id,panel:meta.panel,family:meta.family,sourceHash:sha(t.source.text),requests,hashes};
});
const schedule=[];
for(const repeat of [1,2]){
  const indices=Array.from(cases.keys());
  if(repeat===2)indices.reverse();
  for(const i of indices){
    for(const group of ((i+repeat)%2===1?['U','D']:['D','U']))schedule.push({caseId:cases[i].id,group,repeat});
  }
}
const maximumReservedCNY=schedule.reduce((total,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return total+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(maximumReservedCNY<=setting.cap && schedule.length===96);
const parent=JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-feedback/summary.json','utf8'));
const design={model:CHALLENGE_SETTINGS.model,priorCNY:parent.cumulativeEstimatedCNY,capCNY:setting.cap,maximumReservedCNY,
  materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,selectionSha256:sha(choices),cases,schedule};
if(process.argv.includes('--verify'))assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({requests:schedule.length,materialReports:gate.reports,maximumReservedCNY}));
