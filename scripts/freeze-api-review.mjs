import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {sha, SYSTEM} from './pilot-common.mjs';
import {CHALLENGE_SETTINGS} from './challenge-design.mjs';

assert.equal(setting.generation,'api-review');
const parent=name=>JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-router/'+name+'.json','utf8'));
const parentDesign=parent('design'), pack=parent('candidates');
const tasks=read('transfer'), starters=read('starters'), gate=read('materials/receipt');
assert.ok(gate.accepted && gate.reports===96 && tasks.length===24);
assert.equal(gate.transferSha256,sha(tasks));
assert.equal(gate.holdoutSha256,read('transfer.enc').sha256);
const focus={
  G:'复查已有实现的运算、访问、状态变化和最终返回。逐项判断这些处理是否符合题意。',
  E:'复查空表、无有效位置、到达端点和提前返回的分支。逐项判断这些处理是否符合题意。'
};
const cases=tasks.map((t,i)=>{
  const starter=starters[i], row=gate.rows[i], c=parentDesign.cases.find(c=>c.id===t.id);
  const previous=pack.results[starter.parentIndex];
  assert.equal(t.id,starter.id);assert.equal(row.caseId,t.id);
  assert.ok(previous.repeat===1 && previous.group===c.policy.J && previous.caseId===t.id);
  assert.equal(sha(t.source.text),previous.codeSha256);assert.equal(t.source.text,previous.code);
  const old=JSON.parse(c.requests[c.policy.J].messages[1].content);
  const data={sdkVersion:old.sdkVersion,task:t.task,source:t.source,publicTests:t.publicTests,initial:row.initial,documents:old.documents};
  assert.equal(data.initial.status,starter.publicStatus);
  const requests={},hashes={};
  for(const group of ['G','E']){
    const prompt='当前源码是第一次修改后的程序。'+focus[group]+'若实现正确，保留完整原程序；发现问题时按题意修正。';
    requests[group]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({...data,review:prompt})}]};
    hashes[group]=sha(requests[group]);
  }
  const payload=g=>JSON.parse(requests[g].messages[1].content);
  assert.deepEqual({...payload('E'),review:payload('G').review},payload('G'));
  return {id:t.id,pair:c.pair,context:c.context,sourceHash:starter.sourceHash,requests,hashes};
});
const schedule=[];
for(let repeat=1;repeat<=2;repeat++)for(let j=0;j<cases.length;j++){
  const i=repeat===1?j:cases.length-1-j;
  const order=(i+repeat)%2?['G','E']:['E','G'];
  for(const group of order)schedule.push({caseId:cases[i].id,repeat,group});
}
const maximumReservedCNY=schedule.reduce((sum,j)=>{
  const b=cases.find(c=>c.id===j.caseId).requests[j.group];
  return sum+((Buffer.byteLength(JSON.stringify(b))+1024)*2+b.max_tokens*8)/1e6;
},0);
assert.ok(schedule.length===96 && maximumReservedCNY<=setting.cap);
const design={model:CHALLENGE_SETTINGS.model,priorCNY:6.055576,capCNY:setting.cap,maximumReservedCNY,
  materialReceiptSha256:sha(gate),newHoldoutSha256:gate.holdoutSha256,parentCandidatesSha256:sha(pack),cases,schedule};
if(process.argv.includes('--verify'))assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({requests:schedule.length,maximumReservedCNY,materialReports:gate.reports}));
