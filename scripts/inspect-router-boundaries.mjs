import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, transferPrivate, unseal, setting, directory, dump} from './api-evidence-common.mjs';
assert.equal(setting.generation,'api-router');
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const hidden=new Map(transferPrivate(key).map(c=>[c.id,c]));
const reports=new Map(unseal(read('score/evidence.enc'),key).map(r=>[r.id,r]));
const newIds=new Set(read('panels').filter(c=>c.panel==='new').map(c=>c.id));
const counts={boundaryOnly:0,ordinaryOnly:0,mixed:0,incompleteTrace:0};
const rows=[];
for(const row of read('score/receipt').rows){
  if(row.status!=='holdout_failed'||!newIds.has(row.caseId))continue;
  const test=hidden.get(row.caseId), report=reports.get(row.holdoutId);
  const fixtures=test.harness.split('\n');
  const output=report.tests?.[0]?.process?.stdout?.trim().split(/\r?\n/)??[];
  let category='incompleteTrace';
  if(output.length===test.assertions && output.every(x=>x==='true'||x==='false')){
    const failures=[];
    assert.equal(fixtures.length,3*test.assertions);
    for(let i=0;i<output.length;i++){
      const array=/LinkedList<Int64>\((?:\[([^\]]*)\]|Array<Int64>\(\))\)/.exec(fixtures[3*i]);
      const arg=/=repair\(q\d+, (None|-?\d+|q\d+\.nodeAt\(\d+\)),/.exec(fixtures[3*i+1]);
      assert.ok(array && arg);
      const size=array[1]?array[1].split(',').length:0;
      const hasInvalidPosition=arg[1]==='None'||(/^-?\d+$/.test(arg[1]) && (+arg[1]<0||+arg[1]>=size));
      if(output[i]==='false')failures.push(size===0||hasInvalidPosition?'boundary':'ordinary');
    }
    assert.ok(failures.length);
    category=failures.every(k=>k==='boundary')?'boundaryOnly':failures.every(k=>k==='ordinary')?'ordinaryOnly':'mixed';
  }
  counts[category]++;
  rows.push({caseId:row.caseId,repeat:row.repeat,group:row.group,category});
}
const result={scope:'Post hoc, new physical candidates failing hidden checks. Boundary means empty list or invalid/missing position.',counts,rows};
if(process.argv.includes('--write'))dump(directory+'/boundary-failures.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('boundary-failures'));
console.log(JSON.stringify(counts));
