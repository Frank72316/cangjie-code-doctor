import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read,setting,transferPrivate,unseal} from './api-evidence-common.mjs';
import {parseArray,arrayOracle} from './feedback-array-fixtures.mjs';
import {poolInputs,selectExamples,contractResult} from './select-contract-examples.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-selection');
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const previous=JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-feedback/transfer.enc.json','utf8'));
const past=new Map(unseal(previous,key).cases.map(c=>[c.id,c]));
const tasks=read('transfer'),hidden=transferPrivate(key),meta=read('starters'),probes=read('probes'),selection=read('selection');
const pool=read('pool');
assert.deepEqual(pool,poolInputs());
assert.equal(new Set(pool.map(r=>sha(r))).size,24);
assert.ok(pool.every(x=>x.array.length===5 && x.t===2));
assert.equal(tasks.length,24);
for (const [i,task] of tasks.entries()) {
  const id=task.id, h=hidden[i], p=probes[i], m=meta[i];
  for (const record of [h,p,m,selection[i]]) assert.equal(id,record.id);
  assert.equal(m.sourceHash,sha(task.source.text));
  assert.deepEqual(selection[i],{id,...selectExamples(id,pool)});
  const flat=[];
  const calls=[...p.harness.matchAll(/let (q\d+): Array<Int64> = (\[[^\]]*\])\s+let (r\d+)=repair\(\1, (-?\d+)\)\s+println\(\3\)\s+for \(value in \1\) \{ println\(value\) \}/g)];
  assert.equal(calls.length,24);
  for (const [j,entry] of calls.entries()) {
    const array=JSON.parse(entry[2]),t=Number(entry[4]);
    assert.deepEqual({array,t},pool[j]);
    const e=contractResult(id,array,t);
    flat.push(e.returned,...e.after);
  }
  assert.deepEqual(p.expected,{returned:0,after:flat});
  const pub=parseArray(task.source.text);
  assert.equal(pub.length,2);
  const old=m.panel==='legacy' ? [...parseArray(past.get(id).harness),{input:[[11],11]}] : [];
  const used=new Set([...pub,...old].map(r=>sha(r.input)));
  for(const {array,t} of pool) {assert.ok(!used.has(sha([array,t])));used.add(sha([array,t]));}
  const privateRows=parseArray(h.harness);
  assert.equal(privateRows.length,24);
  assert.ok(privateRows.some(r=>r.input[0].length===5) && privateRows.some(r=>r.input[0].length===0));
  for(const row of privateRows){
    const sig=sha(row.input);
    assert.ok(!used.has(sig));used.add(sig);
    assert.deepEqual(contractResult(id,...row.input),{returned:row.value,after:row.after});
    if (m.panel==='legacy') assert.deepEqual(arrayOracle(id,row.input),[row.value,row.after]);
  }
}
console.log('Verified 24 case contracts, 576 pool observations to be collected, 576 disjoint held-out assertions and both selection policies.');
