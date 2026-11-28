import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, setting, transferPrivate, unseal} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-review');
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const old=JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-router/transfer.enc.json','utf8'));
const oldCases=unseal(old,key).cases;
const tasks=read('transfer');
import {parse, oracle} from './linked-fixture-oracle.mjs';
const pairs=new Map();let total=0;
for(const h of transferPrivate(key)){
  const prior=oldCases.find(c=>c.id===h.id), prev=parse(prior.harness), pub=parse(tasks.find(c=>c.id===h.id).source.text);
  assert.equal(prev.length,prior.assertions);assert.equal(pub.length,2);
  const oldInputs=new Set([...prev,...pub].map(c=>sha(c.input)));
  const cases=parse(h.harness);
  assert.equal(cases.length,18);assert.equal(new Set(cases.map(c=>sha(c.input))).size,18);
  for(const c of cases){
    assert.ok(!oldInputs.has(sha(c.input)));
    assert.deepEqual(oracle(h.id,c.input),[c.value,c.after]);
  }
  const id=h.id.replace(/_(mark|all)$/,''), inputs=cases.map(c=>c.input);
  if(pairs.has(id))assert.deepEqual(pairs.get(id),inputs);
  else pairs.set(id,inputs);
  total+=cases.length;
}
assert.equal(total,432);assert.equal(pairs.size,12);
console.log('Verified 432 disjoint inputs, independent array oracles and identical inputs within 12 task pairs.');
