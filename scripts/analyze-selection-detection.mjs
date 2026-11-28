import assert from 'node:assert/strict';
import {read, setting, directory, dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {decodePool, differs} from './selection-observations.mjs';

assert.equal(setting.generation,'api-selection');
const gate=read('materials/receipt'),pool=read('pool'),selection=read('selection'),meta=read('starters');
assert.ok(gate.accepted);
function counts(){
  return {n:0,errors:0,controls:0,pubFailed:0,U:0,D:0,uniformExpected:0,UExtra:0,DExtra:0,
    uniformExtra:0,falsePositiveU:0,falsePositiveD:0,poolBlind:0};
}
const cases=gate.rows.map((row,i)=>{
  const {id,family,panel,control}=meta[i];
  assert.equal(row.caseId,id);assert.equal(selection[i].id,id);
  const ref=decodePool(row.probe.reference,pool),actual=decodePool(row.probe.starter,pool);
  const failed=actual.map((v,j)=>differs(v,ref[j]));
  const bad=failed.filter(Boolean).length;
  const pairs=pool.length*(pool.length-1)/2, clean=pool.length-bad;
  const detectingPairs=pairs-clean*(clean-1)/2;
  assert.equal(pairs,276);
  const publicFail=row.initial.status!=='passed', hiddenFail=row.originalHoldout!=='passed';
  if(control) assert.ok(!publicFail&&!hiddenFail&&!bad);
  return {id,family,panel,control,publicFail,hiddenFail,poolFailures:bad,detectingPairs,
    U:selection[i].U.some(j=>failed[j]),D:selection[i].D.some(j=>failed[j])};
});
function aggregate(rows){
  const countsForRows=counts(), dist=[1];
  for(const r of rows){
    const p=r.detectingPairs/276;
    countsForRows.n++;
    countsForRows.controls+=Number(r.control);
    if(!r.hiddenFail){
      countsForRows.falsePositiveU+=Number(r.U);countsForRows.falsePositiveD+=Number(r.D);
      continue;
    }
    countsForRows.errors++;countsForRows.pubFailed+=Number(r.publicFail);
    countsForRows.U+=Number(r.U);countsForRows.D+=Number(r.D);countsForRows.uniformExpected+=p;
    countsForRows.poolBlind+=Number(r.poolFailures===0);
    if(!r.publicFail){
      countsForRows.UExtra+=Number(r.U);countsForRows.DExtra+=Number(r.D);countsForRows.uniformExtra+=p;
    }
    for(let j=dist.length;j>=0;j--)dist[j]=(dist[j]??0)*(1-p)+(j>0?dist[j-1]*p:0);
  }
  assert.ok(Math.abs(dist.reduce((a,b)=>a+b,0)-1)<1e-9);
  return {...countsForRows,uniformAtLeastD:dist.slice(countsForRows.D).reduce((a,b)=>a+b,0)};
}
const panels={};
for(const name of ['new','legacy']){
  const rows=cases.filter(r=>r.panel===name);
  const families=Object.fromEntries([...new Set(rows.map(r=>r.family))].map(f=>[f,aggregate(rows.filter(r=>r.family===f))]));
  panels[name]={...aggregate(rows),families};
}
const result={materialReceiptSha256:sha(gate),panels,cases};
if(process.argv.includes('--write'))dump(directory+'/detection.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('detection'));
console.log(JSON.stringify(Object.fromEntries(Object.entries(panels).map(([k,v])=>[k,{...v,families:undefined}]))));
