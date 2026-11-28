import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, setting, transferPrivate, unseal} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-review');
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const old=JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-router/transfer.enc.json','utf8'));
const oldCases=unseal(old,key).cases;
const tasks=read('transfer');
function parse(text) {
  const cases=[];
  for(const m of text.matchAll(/let (q\d+)\s*=\s*LinkedList<Int64>\((Array<Int64>\(\)|\[[^\]]*\])\)\s*let r(\d+)\s*=\s*repair\(\1,\s*(None|-?\d+|q\d+\.nodeAt\((\d+)\)),\s*(-?\d+)\)\s*println\(r\3\s*==\s*(-?\d+)\s*&&\s*\1\.toArray\(\)\s*==\s*(Array<Int64>\(\)|\[[^\]]*\])\)/g)){
    const vals=x=>x.startsWith('[')?JSON.parse(x):[];
    const pos=m[4]==='None'?null:Number(m[5]??m[4]);
    cases.push({input:[vals(m[2]),pos,Number(m[6])],value:Number(m[7]),after:vals(m[8])});
  }
  return cases;
}
function oracle(id,[data,pos,t]){
  const [op,side,scope]=id.split('_'), right=side==='right', seq=[...data], step=right?1:-1;
  let i=scope==='all'?(right?0:seq.length-1):pos===null||pos<0||pos>=seq.length?-100:pos+step;
  let n=0,acc=0,previous;
  for(;i>=0&&i<seq.length;i+=step){
    const value=seq[i];
    n++;
    if(op==='seek'&&value>=t)return [n,seq];
    if(op==='twin'&&n>1&&value===previous)return [n,seq];
    if(op==='alternating'){if(value===t)break;acc+=n%2?value:-value;}
    if(op==='invert'){if(value===t)break;if(value<0){seq[i]=-value;acc++;}}
    if(op==='paint'&&value%2&&acc<2){seq[i]+=t;acc++;}
    if(op==='stamp'&&value>t){seq.splice(i+Number(!right),0,t-1);return [value,seq];}
    previous=value;
  }
  return [op==='stamp'?-91:['twin','seek'].includes(op)?-1:acc,seq];
}
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
