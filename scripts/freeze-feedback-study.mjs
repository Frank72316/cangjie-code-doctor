import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read, setting, directory, dump} from './api-evidence-common.mjs';
import {sha, SYSTEM} from './pilot-common.mjs';
import {CHALLENGE_SETTINGS} from './challenge-design.mjs';

assert.equal(setting.generation,'api-feedback');
const parent = name => JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-review/'+name+'.json','utf8'));
const oldDesign = parent('design'), oldSummary = parent('summary');
const transfer = read('transfer'), metadata = read('starters'), probes = read('probes'), materials = read('materials/receipt');
assert.ok(materials.accepted && materials.reports === 192);
assert.equal(materials.transferSha256,sha(transfer));
assert.equal(materials.probesSha256,sha(probes));
assert.equal(materials.holdoutSha256,read('transfer.enc').sha256);

const orders = ['HSR','HRS','SRH','RSH','RHS','SHR'];
const cases = transfer.map((task,i) => {
  const meta = metadata[i], probe = probes[i], row = materials.rows[i];
  for (const id of [meta.id,probe.id,row.caseId]) assert.equal(id,task.id);
  assert.deepEqual(row.probe.reference,{status:'passed',...probe.expected});
  const previous = oldDesign.cases.find(c=>c.id===task.id);
  let payload;
  if (meta.panel === 'linked') {
    assert.equal(previous.sourceHash,sha(task.source.text));
    payload = JSON.parse(previous.requests.E.messages[1].content);
    assert.deepEqual(payload.source,task.source);
    assert.deepEqual(payload.initial,row.initial);
  } else {
    assert.equal(previous,undefined);
    payload = {sdkVersion:'1.0.5',task:task.task,source:task.source,publicTests:task.publicTests,initial:row.initial,documents:[],
      review:'当前源码是待复查的数组实现。复查空数组、单元素、阈值相等、端点和提前返回的分支。若实现正确，保留完整原程序；发现问题时按题意修正。'};
  }
  const example = {input:probe.input,expected:probe.expected};
  const contents = {H:payload,S:{...payload,example},R:{...payload,example,observed:row.probe.starter}};
  const requests = {}, hashes = {};
  for (const group of ['H','S','R']) {
    const messages = [{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(contents[group])}];
    requests[group] = {...CHALLENGE_SETTINGS,messages};
    hashes[group] = sha(requests[group]);
  }
  if (previous) assert.equal(hashes.H,previous.hashes.E);
  return {id:task.id,panel:meta.panel,family:meta.family,sourceHash:sha(task.source.text),requests,hashes};
});
const schedule = [];
for (const repeat of [1,2]) {
  const indices = Array.from(cases.keys());
  if (repeat === 2) indices.reverse();
  for (const i of indices) {
    const order = [...orders[i%6]];
    if (repeat === 2) order.reverse();
    for (const group of order) schedule.push({caseId:cases[i].id,repeat,group});
  }
}
const maximumReservedCNY = schedule.reduce((sum,job) => {
  const body = cases.find(c=>c.id===job.caseId).requests[job.group];
  return sum + ((Buffer.byteLength(JSON.stringify(body))+1024)*2 + body.max_tokens*8)/1e6;
},0);
assert.equal(schedule.length,192);
assert.ok(maximumReservedCNY <= setting.cap);
const design = {model:CHALLENGE_SETTINGS.model,priorCNY:oldSummary.cumulativeEstimatedCNY,capCNY:setting.cap,maximumReservedCNY,
  materialReceiptSha256:sha(materials),newHoldoutSha256:materials.holdoutSha256,probesSha256:sha(probes),cases,schedule};
if (process.argv.includes('--verify')) assert.deepEqual(design,read('design'));
else dump(directory+'/design.json',design);
console.log(JSON.stringify({requests:schedule.length,maximumReservedCNY,materialReports:materials.reports}));
