import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read,setting,unseal,directory,dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {observation} from './feedback-probe.mjs';
import {decodePool,differs} from './selection-observations.mjs';

assert.equal(setting.generation,'api-selection');
const pool=read('pool'), choice=read('selection'), gate=read('materials/receipt'), score=read('score/receipt');
const design=read('design'),pack=read('candidates'),audit=read('verified'),detection=read('detection');
assert.equal(design.materialReceiptSha256,sha(gate));assert.equal(score.candidatesSha256,sha(pack));
assert.equal(pack.designSha256,sha(design));assert.equal(detection.materialReceiptSha256,sha(gate));

function calculateTraces(){
  const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
  const raw=new Map(unseal(read('score/evidence.enc'),key).map(r=>[r.id,r]));
  return score.rows.map((r,i)=>{
    let chosenPassed=false,poolPassed=false,complete=false;
    if(r.probeId){
      const idx=gate.rows.findIndex(m=>m.caseId===r.caseId);
      const observationRecord=observation(raw.get(r.probeId));
      if(Array.isArray(observationRecord.after)&&observationRecord.after.length===pool.length*6){
        const actual=decodePool(observationRecord,pool), ref=decodePool(gate.rows[idx].probe.reference,pool);
        const correct=actual.map((v,j)=>!differs(v,ref[j]));
        complete=true;poolPassed=correct.every(Boolean);
        chosenPassed=choice[idx][r.group].every(j=>correct[j]);
        assert.equal(poolPassed,r.probeStatus==='passed');
      }
    }
    return {caseId:r.caseId,group:r.group,repeat:r.repeat,chosenPassed,poolPassed,complete};
  });
}
if(process.argv.includes('--traces')){
  const result={receiptSha256:sha(score),rows:calculateTraces()};
  if(process.argv.includes('--write'))dump(directory+'/traces.json',result);
  else assert.deepEqual(result,read('traces'));
  console.log('Verified candidate sample outcomes for '+result.rows.length+' actual requests.');
  process.exit(0);
}
const traces=read('traces');assert.equal(traces.receiptSha256,sha(score));
const accepted=new Set(read('review').acceptedBodyHashes);
const cases=Object.fromEntries(detection.cases.map(r=>[r.id,{...r,base:!r.publicFail&&!r.hiddenFail,UScore:0,DScore:0}]));
function arm(){return {runs:0,passed:0,fixed:0,regressed:0,selectedPassed:0,sampleOnly:0,poolPassed:0,
  callsWhenTriggered:0,passedWhenTriggered:0,triggeredCostCNY:0,costCNY:0,input:0,cached:0,output:0};}
const panels={};
for(const panel of ['new','legacy']){
  const rows=Object.values(cases).filter(r=>r.panel===panel);
  panels[panel]={n:rows.length,basePassed:rows.filter(r=>r.base).length,U:arm(),D:arm(),families:{}};
}
const seen=new Set();
for(const [i,job] of design.schedule.entries()){
  const candidate=pack.results[i],out=audit.rows[i],tr=traces.rows[i],sdk=score.rows[i];
  for(const r of [candidate,out,tr,sdk])for(const k of ['caseId','group','repeat'])assert.equal(r[k],job[k]);
  const unique=[job.caseId,job.group,job.repeat].join('/');assert.ok(!seen.has(unique));seen.add(unique);
  const c=cases[job.caseId],p=panels[c.panel],g=job.group,a=p[g],pass=out.status==='passed';
  const trigger=c.publicFail || c[g];
  const selected=accepted.has(candidate.codeSha256) && tr.chosenPassed;
  a.runs++;a.passed+=Number(pass);a.fixed+=Number(pass&&!c.base);a.regressed+=Number(!pass&&c.base);
  a.selectedPassed+=Number(selected);a.sampleOnly+=Number(selected&&!pass);
  a.poolPassed+=Number(tr.poolPassed&&accepted.has(candidate.codeSha256));
  a.callsWhenTriggered+=Number(trigger);a.passedWhenTriggered+=Number(trigger?pass:c.base);
  if(trigger)a.triggeredCostCNY+=out.costCNY;
  a.costCNY+=out.costCNY;
  const u=candidate.usage;
  assert.equal(u.prompt_tokens,u.prompt_cache_hit_tokens+u.prompt_cache_miss_tokens);
  assert.equal(new Date(Date.parse(candidate.startedAt)+8*3600000).toISOString().slice(0,10),'2026-11-28');
  a.input+=u.prompt_tokens;a.cached+=u.prompt_cache_hit_tokens;a.output+=u.completion_tokens;
  c[g+'Score']+=Number(pass);
  const f=p.families[c.family]??={U:0,D:0};f[g]+=Number(pass);
}
assert.equal(seen.size,96);
const total={input:0,output:0,cached:0};
for(const [name,p] of Object.entries(panels)){
  const rows=Object.values(cases).filter(c=>c.panel===name);
  const delta=rows.map(c=>c.DScore-c.UScore);
  p.net=p.D.passed-p.U.passed;
  p.improved=delta.filter(x=>x>0).length;p.worse=delta.filter(x=>x<0).length;p.tied=delta.filter(x=>x===0).length;
  for(const g of ['U','D']){
    const a=p[g];assert.equal(a.runs,p.n*2);assert.equal(a.passed,p.basePassed*2+a.fixed-a.regressed);
    for(const k of Object.keys(total))total[k]+=a[k];
    a.costCNY=Number(a.costCNY.toFixed(6));a.triggeredCostCNY=Number(a.triggeredCostCNY.toFixed(6));
  }
}
const conservativeCNY=(total.input*2+total.output*8)/1e6;
assert.ok(Math.abs(conservativeCNY-audit.rows.reduce((s,r)=>s+r.costCNY,0))<1e-9);
const result={designSha256:sha(design),verifiedSha256:sha(audit),panels,cases,total,conservativeCNY,
  offPeakEstimatedCNY:(total.input-total.cached+total.cached*.02+4*total.output)/1e6,
  cumulativeEstimatedCNY:Number((design.priorCNY+conservativeCNY).toFixed(6)),materialReports:audit.materialReports,scoreReports:audit.scoreReports};
if(process.argv.includes('--write'))dump(directory+'/summary.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('summary'));
console.log(JSON.stringify({...result,cases:undefined},null,2));
