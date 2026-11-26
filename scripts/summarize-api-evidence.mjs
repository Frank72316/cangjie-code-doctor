import {read} from './api-evidence-common.mjs';
import assert from 'node:assert/strict';
const design=read('design'),audit=read('verified'),rows=audit.rows;
const groups=['R','M','G','P'], panels=['prior','transfer'];
const cases=design.cases.map(c=>({id:c.id,panel:c.panel,gold:c.gold,retrieved:c.apiRanks[0],top3:c.apiRanks.includes(c.gold),pass:Object.fromEntries(groups.map(g=>{
 const r=rows.filter(x=>x.caseId===c.id&&x.group===g);assert.equal(r.length,3);return [g,r.filter(x=>x.status==='passed').length];
}))}));
const sum=(xs,fn)=>xs.reduce((n,x)=>n+fn(x),0);
function totals(list){
 const selected=rows.filter(x=>list.some(c=>c.id===x.caseId));
 return Object.fromEntries(groups.map(g=>{
  const rs=selected.filter(x=>x.group===g);
  return [g,{passed:rs.filter(x=>x.status==='passed').length,attempts:rs.length,input:sum(rs,x=>x.input),output:sum(rs,x=>x.output),estimateCNY:+sum(rs,x=>x.costCNY).toFixed(6)}];
 }));
}
const rnd=()=>{let seed=20261126;return n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/4294967296*n);};};
function contrast(a,b){
 const diff=c=>c.pass[a]-c.pass[b],pts=(x,n)=>+(100*x/(3*n)).toFixed(4);
 const split=panels.map(p=>cases.filter(c=>c.panel===p)),next=rnd(),draws=[];
 for(let i=0;i<10000;i++){
  let d=0;for(const list of split)for(let j=0;j<list.length;j++)d+=diff(list[next(list.length)]);
  draws.push(pts(d,cases.length));
 }
 draws.sort((x,y)=>x-y);
 return {differencePoints:pts(sum(cases,diff),cases.length),percentile95:[draws[249],draws[9749]],better:cases.filter(c=>diff(c)>0).length,tied:cases.filter(c=>diff(c)===0).length,worse:cases.filter(c=>diff(c)<0).length};
}
console.log(JSON.stringify({cases,overall:totals(cases),panels:Object.fromEntries(panels.map(p=>[p,totals(cases.filter(c=>c.panel===p))])),comparisons:{GminusP:contrast('G','P'),MminusR:contrast('M','R'),GminusM:contrast('G','M')},retrieval:{top1:cases.filter(c=>c.gold===c.retrieved).length,top3:cases.filter(c=>c.top3).length,cases:cases.length},statusCounts:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length])),estimatedCNY:+sum(rows,r=>r.costCNY).toFixed(6)},null,2));
