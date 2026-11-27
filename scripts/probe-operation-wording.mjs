import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read,dump,directory,operationStudy} from './api-evidence-common.mjs';
import {rankWithOperation} from './rank-api-operation.mjs';

assert.ok(operationStudy);
const corpus=JSON.parse(fs.readFileSync('docs/experiments/2026-11-27-api-families/corpus.json','utf8'));
const tasks=read('transfer'),labels=read('labels'),design=read('design');
// Exploratory one-clause changes after the main ranks were known; no model calls.
const edits=[
 {pair:'fare',variant:'alternate',from:'乘客依次进入队列，请报出',to:'请报出'},
 {pair:'weighted',variant:'primary',from:'第一个取走的值乘 1，第二个乘 2，以此类推，返回加权和。',to:'每项乘以它被取走时从 1 起算的序号，返回加权和。'},
 {pair:'bookmark',variant:'primary',from:'第一个值等于 t 的节点',to:'从左到右首次匹配 t 的节点'},
];
const rows=[];
for(const e of edits)for(const l of labels.filter(l=>l.pair===e.pair)){
  const task=tasks.find(t=>t.id===l.id), seed=e.variant==='primary'?task.task:l.alternate;
  const baseline=design.cases.find(c=>c.id===l.id);
  assert.ok(seed.includes(e.from));
  const rerank=text=>{
    const r=rankWithOperation(corpus,text,task.source.text),id=r.ranks[0].id;
    return {facets:r.facets,first:id,hit:l.acceptable.includes(id)};
  };
  const before=rerank(seed),after=rerank(seed.replace(e.from,e.to));
  assert.equal(before.first,(e.variant==='primary'?baseline.primary:baseline.alternateRanks).I[0]);
  rows.push({id:l.id,variant:e.variant,from:e.from,to:e.to,before,after});
}
const result={scope:'post-hoc wording diagnosis; six existing items and no model runs',rows};
if(process.argv.includes('--write'))dump(directory+'/wording-probe.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('wording-probe'));
console.log(JSON.stringify(result,null,2));
