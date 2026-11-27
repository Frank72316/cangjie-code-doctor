import assert from 'node:assert/strict';
import {read,rankingStudy} from './api-evidence-common.mjs';
assert.ok(rankingStudy,'Pass --ranking');
const design=read('design'),verified=read('verified'),dev=read('development');
const groups=['B','F'],panels=['seen','unseen'];
const cases=design.cases.map(c=>{
  const pass={},hit1={},hit3={};
  for(const g of groups){
    const rows=verified.rows.filter(r=>r.caseId===c.id && r.group===g);
    assert.equal(rows.length,3);
    pass[g]=rows.filter(r=>r.status==='passed').length;
    hit1[g]=c.ranks[g][0]===c.gold;
    hit3[g]=c.ranks[g].includes(c.gold);
  }
  return {id:c.id,panel:c.panel,gold:c.gold,ranks:c.ranks,hit1,hit3,pass,sameRequest:c.hashes.B===c.hashes.F};
});
const sum=(xs,f)=>xs.reduce((n,x)=>n+Number(f(x)),0);
function byGroup(list){
  return Object.fromEntries(groups.map(g=>{
    const ids=new Set(list.map(c=>c.id));
    const rows=verified.rows.filter(r=>ids.has(r.caseId) && r.group===g);
    return [g,{passed:sum(list,c=>c.pass[g]),attempts:rows.length,top1:sum(list,c=>c.hit1[g]),top3:sum(list,c=>c.hit3[g]),
      input:sum(rows,r=>r.input),output:sum(rows,r=>r.output),estimatedCNY:+sum(rows,r=>r.costCNY).toFixed(6)}];
  }));
}
const delta=c=>c.pass.F-c.pass.B;
const strata=panels.map(p=>cases.filter(c=>c.panel===p));
let seed=20261127;const uniform=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor((seed/2**32)*n);};
const points=(n,denom)=>+(100*n/denom).toFixed(4);
const draws=[];
for(let i=0;i<10000;i++){
  let count=0;
  for(const stratum of strata)for(let j=0;j<stratum.length;j++)count+=delta(stratum[uniform(stratum.length)]);
  draws.push(points(count,3*cases.length));
}
draws.sort((a,b)=>a-b);
const summary={cases,development:Object.fromEntries(groups.map(g=>[g,{top1:sum(dev.cases,c=>c[g][0]===c.gold),top3:sum(dev.cases,c=>c[g].includes(c.gold)),n:dev.cases.length}])),
 overall:byGroup(cases),panels:Object.fromEntries(strata.map(l=>[l[0].panel,byGroup(l)])),
 differencePoints:points(sum(cases,delta),3*cases.length),percentile95:[draws[249],draws[9749]],
 better:cases.filter(c=>delta(c)>0).length,tied:cases.filter(c=>delta(c)===0).length,worse:cases.filter(c=>delta(c)<0).length,
 sameRequests:cases.filter(c=>c.sameRequest).length,statusCounts:Object.fromEntries([...new Set(verified.rows.map(r=>r.status))].map(s=>[s,verified.rows.filter(r=>r.status===s).length])),
 estimatedCNY:+sum(verified.rows,r=>r.costCNY).toFixed(6)};
console.log(JSON.stringify(summary,null,2));
