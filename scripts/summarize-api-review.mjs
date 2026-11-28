import assert from 'node:assert/strict';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-review');
const design=read('design'), pack=read('candidates'), audit=read('verified');
const material=read('materials/receipt'), scoring=read('score/receipt');
assert.equal(sha(material),design.materialReceiptSha256);
assert.equal(sha(design),pack.designSha256);
assert.equal(sha(pack),scoring.candidatesSha256);
assert.equal(audit.rows.length,96);
const trials=new Map();
for(const [i,j] of design.schedule.entries()){
  const r=audit.rows[i], p=pack.results[i], v=scoring.rows[i];
  for(const k of ['repeat','group','caseId']){assert.equal(p[k],j[k]);assert.equal(v[k],j[k]);assert.equal(r[k],j[k]);}
  const key=[j.caseId,j.repeat,j.group].join('/');
  assert.ok(!trials.has(key));
  trials.set(key,{r,p,v});
}
const groups=['G','E'], strata=['passed','publicFailure','hiddenOnlyFailure'];
function arm(){
  return {runs:0,passed:0,fixed:0,regressed:0,preserved:0,stillFailing:0,guardPassed:0,guardRegressed:0,publicRejected:0,
    onDemandPassed:0,onDemandCalls:0,onDemandCostCNY:0,unchanged:0,byStarter:Object.fromEntries(strata.map(s=>[s,{n:0,passed:0}])),
    statuses:{},input:0,output:0,cached:0};
}
const arms={G:arm(),E:arm()}, baseline=Object.fromEntries(strata.map(s=>[s,0])), pairs={}, cases=[];
for(const [i,c] of design.cases.entries()){
  const m=material.rows[i];assert.equal(m.caseId,c.id);
  const publicOK=m.initial.status==='passed', z=publicOK && m.originalHoldout==='passed';
  const stratum=z?'passed':publicOK?'hiddenOnlyFailure':'publicFailure';
  baseline[stratum]++;
  const result={id:c.id,pair:c.pair,context:c.context,baseline:stratum,G:0,E:0};
  pairs[c.pair]??={Z:0,G:0,E:0};pairs[c.pair].Z+=Number(z)*2;
  for(const group of groups)for(let repeat=1;repeat<=2;repeat++){
    const {r,p,v}=trials.get([c.id,repeat,group].join('/')),a=arms[group],ok=r.status==='passed';
    const accept=v.publicStatus==='passed', guarded=accept?ok:z;
    a.runs++;a.passed+=Number(ok);a.statuses[r.status]=(a.statuses[r.status]??0)+1;
    a.fixed+=Number(ok&&!z);a.regressed+=Number(!ok&&z);
    a.preserved+=Number(ok&&z);a.stillFailing+=Number(!ok&&!z);
    a.guardPassed+=Number(guarded);a.guardRegressed+=Number(z&&!guarded);a.publicRejected+=Number(!accept);
    a.onDemandPassed+=Number(publicOK?z:guarded);
    if(!publicOK){a.onDemandCalls++;a.onDemandCostCNY+=r.costCNY;}
    a.byStarter[stratum].n++;a.byStarter[stratum].passed+=Number(ok);
    a.unchanged+=Number(p.codeSha256===c.sourceHash);
    const u=p.usage;assert.equal(u.prompt_cache_hit_tokens+u.prompt_cache_miss_tokens,u.prompt_tokens);
    assert.equal(new Date(Date.parse(p.startedAt)+28800000).toISOString().slice(0,10),'2026-11-28');
    a.input+=u.prompt_tokens;a.output+=u.completion_tokens;a.cached+=u.prompt_cache_hit_tokens;
    pairs[c.pair][group]+=Number(ok);result[group]+=Number(ok);
  }
  cases.push(result);
}
for(const a of Object.values(arms)){
  assert.equal(a.runs,48);assert.equal(a.passed,baseline.passed*2+a.fixed-a.regressed);
  a.onDemandCostCNY=+a.onDemandCostCNY.toFixed(6);
}
assert.equal(Object.keys(pairs).length,12);
const diffs=Object.values(pairs).map(p=>p.E-p.G);
const comparison={net:arms.E.passed-arms.G.passed,improvedPairs:diffs.filter(v=>v>0).length,
  tiedPairs:diffs.filter(v=>v===0).length,worsePairs:diffs.filter(v=>v<0).length};
const total=key=>arms.G[key]+arms.E[key];
const conservativeCNY=(total('input')*2+total('output')*8)/1e6;
assert.ok(Math.abs(conservativeCNY-audit.rows.reduce((s,r)=>s+r.costCNY,0))<1e-8);
const result={designSha256:sha(design),verifiedSha256:sha(audit),baseline,arms,comparison,pairs,cases,
  conservativeCNY,offPeakCacheAwareCNY:(total('input')-total('cached')+.02*total('cached')+4*total('output'))/1e6,
  cumulativeEstimatedCNY:+(design.priorCNY+conservativeCNY).toFixed(6),materialReports:audit.materialReports,scoreReports:audit.scoreReports};
if(process.argv.includes('--write'))dump(directory+'/summary.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('summary'));
console.log(JSON.stringify({...result,cases:undefined},null,2));
