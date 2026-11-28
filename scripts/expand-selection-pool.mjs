import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read,setting,directory,dump,unseal,transferPrivate} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {parseArray} from './feedback-array-fixtures.mjs';
import {contractResult,selectExamples} from './select-contract-examples.mjs';
import {differs} from './selection-observations.mjs';

assert.equal(setting.generation,'api-selection');
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const original=read('pool'), selections=read('selection'), hidden=transferPrivate(key);
const oldPack=JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-feedback/transfer.enc.json','utf8'));
const history=new Map(unseal(oldPack,key).cases.map(c=>[c.id,c]));
const alphabet=[-3,-1,0,2,4,6], domain=[];
for(let code=0;code<alphabet.length**5;code++){
  let n=code;
  const array=Array.from({length:5},()=>{const v=alphabet[n%alphabet.length];n=Math.floor(n/alphabet.length);return v;});
  domain.push({array,t:2});
}
domain.sort((a,b)=>sha(a).localeCompare(sha(b)));
const tasks=read('transfer');
const rows=selections.map((s,i)=>{
  const available=[...original], added=[], blocked=new Set();
  const privateRows=[...parseArray(hidden[i].harness),...parseArray(tasks[i].source.text)];
  if(history.has(s.id)) privateRows.push(...parseArray(history.get(s.id).harness));
  for(const r of privateRows)blocked.add(sha({array:r.input[0],t:r.input[1]}));
  const unresolved=[];
  for(const v of s.variants.slice(1)){
    const separates=p=>differs(contractResult(s.id,p.array,p.t),contractResult(s.id,p.array,p.t,v));
    if(available.some(separates)) continue;
    const extra=domain.find(p=>!blocked.has(sha(p))&&separates(p));
    if(extra){available.push(extra);added.push({variant:v,input:extra});}
    else unresolved.push(v);
  }
  const best=selectExamples(s.id,available);
  const changed=best.D.some((j,k)=>j!==s.D[k]);
  return {id:s.id,added,unresolved,changed,indices:best.D,examples:best.D.map(j=>available[j])};
});
const result={domainSize:domain.length,rows};
if(process.argv.includes('--write'))dump(directory+'/supplement.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('supplement'));
console.log(JSON.stringify(rows.filter(r=>r.added.length||r.unresolved.length).map(({id,changed,added,unresolved})=>({id,changed,added:added.length,unresolved}))));
