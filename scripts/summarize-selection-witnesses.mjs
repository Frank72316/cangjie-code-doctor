import assert from 'node:assert/strict';
import {read,setting,directory,dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-selection');
const selection=read('supplement'), receipt=read('score/supplement'), prior=read('detection');
assert.equal(sha(selection),receipt.supplementSha256);
const results=new Map(receipt.rows.map(row=>[row.id,row]));
const panels={}, cases=[];
for(const [i,s] of selection.rows.entries()){
  const starting=prior.cases[i];
  assert.equal(starting.id,s.id);
  assert.equal(s.changed,results.has(s.id));
  const row=results.get(s.id);
  if(row) assert.ok(row.reference.failed.every(v=>v===false));
  const detected=s.changed ? row.starter.failed.some(Boolean) : starting.D;
  const p=panels[starting.panel]??={cases:0,errors:0,changedPairs:0,original:0,expanded:0,gained:0,lost:0,falsePositives:0};
  p.cases++;p.changedPairs+=Number(s.changed);
  if(starting.hiddenFail){
    p.errors++;p.original+=Number(starting.D);p.expanded+=Number(detected);
    p.gained+=Number(detected&&!starting.D);p.lost+=Number(!detected&&starting.D);
  }else p.falsePositives+=Number(detected);
  cases.push({id:s.id,changed:s.changed,original:starting.D,expanded:detected});
}
const result={receiptSha256:sha(receipt),panels,cases};
if(process.argv.includes('--write'))dump(directory+'/witness-summary.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('witness-summary'));
console.log(JSON.stringify(panels));
