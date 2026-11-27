import assert from 'node:assert/strict';
import {read,wordingStudy,dump,directory} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.ok(wordingStudy);
const design=read('design'),pack=read('candidates'),verified=read('verified');
assert.equal(sha(design),pack.designSha256);
assert.equal(verified.rows.length,144);assert.equal(pack.results.length,144);
const groups=design.groups,pairs=[...new Set(design.cases.map(c=>c.pair))];
const rows=design.cases.map(c=>({id:c.id,pair:c.pair,family:c.panel,changed:c.apiIds.F!==c.apiIds.N,
  passes:Object.fromEntries(groups.map(g=>[g,0]))}));
const byId=new Map(rows.map(r=>[r.id,r]));
const byGroup=Object.fromEntries(groups.map(g=>[g,{runs:0,passed:0,statuses:{},input:0,output:0,cached:0,uncached:0}]));
const seen=new Set();
for(const [i,j] of design.schedule.entries()){
  const v=verified.rows[i],p=pack.results[i],arm=byGroup[j.group],row=byId.get(j.caseId);
  for(const k of ['group','repeat','caseId']){assert.equal(v[k],j[k]);assert.equal(p[k],j[k]);}
  const key=[j.caseId,j.repeat,j.group].join('/');assert.ok(!seen.has(key));seen.add(key);
  assert.equal(v.costCNY,p.costCNY);assert.equal(v.input,p.usage.prompt_tokens);assert.equal(v.output,p.usage.completion_tokens);
  const {prompt_cache_hit_tokens:cached,prompt_cache_miss_tokens:uncached}=p.usage;
  assert.ok(Number.isInteger(cached) && Number.isInteger(uncached) && cached+uncached===v.input);
  arm.runs++;arm.statuses[v.status]=(arm.statuses[v.status]??0)+1;
  arm.input+=v.input;arm.output+=v.output;arm.cached+=cached;arm.uncached+=uncached;
  if(v.status==='passed'){arm.passed++;row.passes[j.group]++;}
}
for(const g of groups){
  const a=byGroup[g];assert.equal(a.runs,24);
  a.conservativeCNY=(a.input*2+a.output*8)/1e6;
  a.peakCacheAwareCNY=(a.cached*.04+a.uncached*2+a.output*8)/1e6;
}
const sum=(items,fn)=>items.reduce((s,x)=>s+fn(x),0);
const groupTotals=selected=>Object.fromEntries(groups.map(g=>[g,sum(selected,r=>r.passes[g])]));
const byPair=Object.fromEntries(pairs.map(p=>{const sel=rows.filter(r=>r.pair===p);assert.equal(sel.length,2);return [p,groupTotals(sel)];}));
function contrast(weights){
  const values=pairs.map(p=>25*sum(Object.entries(weights),([g,w])=>byPair[p][g]*w));
  let samples=[0];
  for(let i=0;i<pairs.length;i++)samples=samples.flatMap(part=>values.map(v=>part+v));
  samples=samples.map(v=>v/pairs.length).sort((a,b)=>a-b);
  assert.equal(samples.length,46656);
  const pct=p=>{const index=p*(samples.length-1),j=Math.floor(index);return samples[j]+(index-j)*(samples[Math.ceil(index)]-samples[j]);};
  return {weights,differencePoints:sum(values,x=>x)/pairs.length,percentile95:[pct(.025),pct(.975)],
    positivePairs:values.filter(v=>v>0).length,tiedPairs:values.filter(v=>v===0).length,negativePairs:values.filter(v=>v<0).length};
}
const comparisons={
  docAtNatural:contrast({NF:1,NN:-1}),promptAtFormalDoc:contrast({FF:1,NF:-1}),catalogAtNatural:contrast({NS:1,NN:-1}),
  naturalDocVsGuides:contrast({NN:1,NG:-1}),docAtFormal:contrast({FF:1,FN:-1}),promptAtNaturalDoc:contrast({FN:1,NN:-1}),
  interaction:contrast({FF:1,FN:-1,NF:-1,NN:1})};
const strata=Object.fromEntries([['changed',true],['identical',false]].map(([s,flag])=>{
 const subset=rows.filter(r=>r.changed===flag);return [s,{cases:subset.length,passes:groupTotals(subset)}];
}));
const costCNY=+sum(groups,g=>byGroup[g].conservativeCNY).toFixed(6);
assert.ok(Math.abs(sum(verified.rows,r=>r.costCNY)-costCNY)<1e-8);
const result={designSha256:sha(design),verifiedSha256:sha(verified),groups:byGroup,byPair,comparisons,strata,rows,
 materialReports:verified.materialReports,scoreReports:verified.scoreReports,costCNY,
 peakCacheAwareCNY:+sum(groups,g=>byGroup[g].peakCacheAwareCNY).toFixed(8),
 cumulativeEstimatedCNY:+(design.priorCNY+costCNY).toFixed(6)};
if(process.argv.includes('--write'))dump(directory+'/summary.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('summary'));
console.log(JSON.stringify(result,null,2));
