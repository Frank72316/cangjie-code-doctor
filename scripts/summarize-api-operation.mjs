import assert from 'node:assert/strict';
import {read,directory,dump,operationStudy} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.ok(operationStudy,'Pass --operation');
const design=read('design'),labels=read('labels');
assert.equal(sha(labels),design.labelsSha256);
const methods=['T','I'], arms=['G','T','I'];
function retrieval(c,field){
  return Object.fromEntries(methods.map(g=>{
    const ids=c[field][g];
    assert.equal(new Set(ids).size,3);
    return [g,{first:ids[0],preferred:ids[0]===c.gold,hit1:c.acceptable.includes(ids[0]),hit3:ids.some(id=>c.acceptable.includes(id))}];
  }));
}
const rows=design.cases.map(c=>{
  const label=labels.find(l=>l.id===c.id);
  assert.deepEqual(label.acceptable,c.acceptable);assert.equal(label.alternate,c.alternate);
  return {id:c.id,pair:c.pair,family:c.panel,primary:retrieval(c,'primary'),alternate:retrieval(c,'alternateRanks'),
    inputChanged:c.hashes.T!==c.hashes.I};
});
const pairs=[...new Set(rows.map(r=>r.pair))];
const retrievalTotals={};
for(const g of methods){
 const bothInPair=field=>pairs.filter(p=>rows.filter(r=>r.pair===p).every(r=>r[field][g].hit1)).length;
 retrievalTotals[g]={};
 for(const wording of ['primary','alternate']){
  retrievalTotals[g][wording]={hit1:rows.filter(r=>r[wording][g].hit1).length,hit3:rows.filter(r=>r[wording][g].hit3).length,
   preferred:rows.filter(r=>r[wording][g].preferred).length,pairsBothHit1:bothInPair(wording)};
 }
 retrievalTotals[g].bothWordingsHit1=rows.filter(r=>r.primary[g].hit1 && r.alternate[g].hit1).length;
}
if(process.argv.includes('--retrieval')){
 console.log(JSON.stringify({retrievalTotals,rows},null,2));process.exit(0);
}
const verified=read('verified'),pack=read('candidates');
assert.equal(pack.designSha256,sha(design));assert.equal(verified.rows.length,72);
assert.equal(pack.results.length,72);assert.equal(design.schedule.length,72);
for(const [i,job] of design.schedule.entries()){
  for(const k of ['caseId','repeat','group']){
    assert.equal(verified.rows[i][k],job[k]);assert.equal(pack.results[i][k],job[k]);
  }
  assert.equal(verified.rows[i].costCNY,pack.results[i].costCNY);
}
for(const row of rows){
  row.pass={};
  for(const g of arms){
    const results=verified.rows.filter(r=>r.caseId===row.id && r.group===g);
    assert.deepEqual(results.map(r=>r.repeat),[1,2]);row.pass[g]=results.filter(r=>r.status==='passed').length;
  }
}
const sum=(arr,fn)=>arr.reduce((s,r)=>s+fn(r),0);
function totals(sel){return Object.fromEntries(arms.map(g=>[g,sum(sel,r=>r.pass[g])]));}
const byPair=Object.fromEntries(pairs.map(p=>[p,totals(rows.filter(r=>r.pair===p))]));
function comparison(baseline){
 const values=Object.values(byPair).map(p=>(p.I-p[baseline])*25);
 assert.equal(values.length,6);
 let means=[0];
 for(let i=0;i<6;i++)means=means.flatMap(s=>values.map(v=>s+v));
 means=means.map(s=>s/6).sort((a,b)=>a-b);
 const pct=p=>{const i=(means.length-1)*p,f=Math.floor(i);return means[f]+(i-f)*(means[Math.ceil(i)]-means[f]);};
 return {differencePoints:sum(values,x=>x)/6,percentile95:[pct(.025),pct(.975)],
  improvedPairs:values.filter(v=>v>0).length,tiedPairs:values.filter(v=>v===0).length,worsePairs:values.filter(v=>v<0).length};
}
const statuses=Object.fromEntries(arms.map(g=>{
 const counts={};for(const r of verified.rows.filter(r=>r.group===g)) counts[r.status]=(counts[r.status]??0)+1;return [g,counts];
}));
const costCNY=+sum(verified.rows,r=>r.costCNY).toFixed(6);
const result={designSha256:sha(design),verifiedSha256:sha(verified),rows,retrievalTotals,overall:totals(rows),byPair,statuses,
 comparisons:{IminusT:comparison('T'),IminusG:comparison('G')},
 changed:rows.filter(r=>r.inputChanged).length,changedTotals:totals(rows.filter(r=>r.inputChanged)),sameTotals:totals(rows.filter(r=>!r.inputChanged)),
 materialReports:verified.materialReports,scoreReports:verified.scoreReports,costCNY,cumulativeEstimatedCNY:+(design.priorCNY+costCNY).toFixed(6),
 tokens:{input:sum(verified.rows,r=>r.input),output:sum(verified.rows,r=>r.output)}};
if(process.argv.includes('--write'))dump(directory+'/summary.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('summary'));
console.log(JSON.stringify(result,null,2));
