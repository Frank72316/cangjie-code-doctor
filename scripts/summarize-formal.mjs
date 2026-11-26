// Summarize verified attempts. Bootstrap resampling is by question, keeping all paired runs together.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sha} from './pilot-common.mjs';
const folder='docs/experiments/2026-11-26-challenge/formal/';
const load=async name=>JSON.parse(await readFile(folder+name+'.json','utf8'));
const audit=await load('verified'), first=await load('first'), second=await load('second');
const review=await load('review');
const sources=new Set([...first.results,...second.results].filter(r=>r.status==='generated').map(r=>r.codeSha256));
assert.equal(review.candidateSetSha256,sha([...sources].sort()));
const excluded=new Set(review.excluded.map(e=>e.codeSha256));
const key=r=>[r.caseId,r.group,r.repeat].join('/');
const index=rows=>new Map(rows.map(r=>[key(r),r]));
const one=index(first.results),two=index(second.results);
const cases=audit.cases.map(r=>{
  const r1=one.get(key(r)),r2=two.get(key(r)),chosen=r2?.status==='generated'?r2:r1;
  return {...r,first:excluded.has(r1.codeSha256)?'contract_violation':r.first,final:excluded.has(chosen.codeSha256)?'contract_violation':r.final};
});
const groups=['A','B','C'];
const questions=[...new Set(cases.map(r=>r.caseId))];
assert.equal(questions.length,24);
assert.equal(new Set(cases.map(key)).size,216);
const stats={};
for(const group of groups) {
  const rows=cases.filter(r=>r.group===group), tokens=audit.totals[group];
  const calls=[...first.results,...second.results].filter(r=>r.group===group);
  const timing=calls.map(r=>Date.parse(r.finishedAt)-Date.parse(r.startedAt)).sort((a,b)=>a-b);
  const counts=field=>Object.fromEntries([...new Set(rows.map(r=>r[field]))].map(status=>[status,rows.filter(r=>r[field]===status).length]));
  stats[group]={first:counts('first'),final:counts('final'),calls:calls.length,inputTokens:tokens.inputTokens,outputTokens:tokens.outputTokens,
    costEstimateCNY:tokens.estimatedPeakCNY,medianLatencySeconds:(timing[Math.floor((timing.length-1)/2)]+timing[Math.floor(timing.length/2)])/2000,
    strata:Object.fromEntries([...new Set(rows.map(r=>r.stratum))].map(s=>[s,rows.filter(r=>r.stratum===s && r.final==='passed').length]))};
}
function comparison(base) {
  let seed=20261126;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  const diffs=questions.map(id=>{
    const points=g=>cases.filter(r=>r.caseId===id&&r.group===g&&r.final==='passed').length/3;
    return points('B')-points(base);
  });
  const draws=Array.from({length:10000},()=>100*questions.reduce(sum=>sum+diffs[Math.floor(random()*24)],0)/24).sort((a,b)=>a-b);
  return {differencePoints:100*diffs.reduce((a,b)=>a+b,0)/24,percentile95:[draws[249],draws[9749]],betterCases:diffs.filter(x=>x>0).length,tiedCases:diffs.filter(x=>x===0).length,worseCases:diffs.filter(x=>x<0).length};
}
console.log(JSON.stringify({questions:24,groups:stats,comparisons:{BminusA:comparison('A'),BminusC:comparison('C')},cases},null,2));
