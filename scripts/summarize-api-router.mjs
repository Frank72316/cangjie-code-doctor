import assert from 'node:assert/strict';
import {read, directory, dump, setting} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-router');
const design=read('design'), pack=read('candidates'), verified=read('verified');
assert.equal(sha(design),pack.designSha256);
assert.equal(verified.rows.length,192);
const policies=['L','S','J','A'];
const sums=()=>({n:0,passed:0,input:0,output:0,cached:0,statuses:{}});
const counts=(keys,make)=>Object.fromEntries(keys.map(k=>[k,make()]));
function add(t,row,u) {
  t.n++;
  t.passed+=Number(row.status==='passed');
  t.input+=u.prompt_tokens;
  t.output+=u.completion_tokens;
  t.cached+=u.prompt_cache_hit_tokens;
  t.statuses[row.status]=(t.statuses[row.status]??0)+1;
}
const index=new Map(), physical=sums();
for(const [i,j] of design.schedule.entries()){
  const row=verified.rows[i], reply=pack.results[i];
  for(const k of ['caseId','repeat','group']){assert.equal(row[k],j[k]);assert.equal(reply[k],j[k]);}
  const u=reply.usage;
  assert.equal(u.prompt_tokens,u.prompt_cache_hit_tokens+u.prompt_cache_miss_tokens);
  assert.equal(new Date(Date.parse(reply.startedAt)+28800000).toISOString().slice(0,10),'2026-11-28');
  const key=[j.caseId,j.repeat,j.group].join('/');
  assert.ok(!index.has(key));index.set(key,{row,u});add(physical,row,u);
}
const panels=counts(['new','prior'],()=>counts(policies,sums));
const perCase=[];
for(const c of design.cases){
  const passes=counts(policies,()=>0);
  for(const policy of policies){
    for(let r=1;r<=3;r++){
      const {row,u}=index.get([c.id,r,c.policy[policy]].join('/'));
      add(panels[c.panel][policy],row,u);
      passes[policy]+=Number(row.status==='passed');
    }
  }
  perCase.push({id:c.id,panel:c.panel,pair:c.pair,context:c.context,policy:c.policy,passes});
}
const newRows=perCase.filter(c=>c.panel==='new');
const pairs={};
for(const c of newRows){
  const values=pairs[c.pair]??=counts(policies,()=>0);
  for(const g of policies) values[g]+=c.passes[g];
}
assert.equal(Object.keys(pairs).length,12);
const differences={};
for(const [x,y] of [['J','L'],['J','A'],['S','L'],['S','A'],['J','S']]){
  const net=Object.values(pairs).map(p=>p[x]-p[y]);
  differences[x+'-'+y]={net:net.reduce((a,b)=>a+b,0),better:net.filter(n=>n>0).length,
    same:net.filter(n=>n===0).length,worse:net.filter(n=>n<0).length};
}
const routing={};
for(const panel of ['new','prior']){
  const selected=perCase.filter(c=>c.panel===panel);
  routing[panel]={};
  for(const g of policies)routing[panel][g]=Object.fromEntries(['position','whole'].map(context=>{
    const rows=selected.filter(c=>c.context===context);
    return [context,{tasks:rows.length,selected:rows.filter(c=>c.policy[g]==='A').length,passed:rows.reduce((n,c)=>n+c.passes[g],0)}];
  }));
  for(const g of policies)assert.equal(panels[panel][g].n,3*selected.length);
}
const conservativeCNY=(physical.input*2+physical.output*8)/1e6;
assert.ok(Math.abs(verified.rows.reduce((n,c)=>n+c.costCNY,0)-conservativeCNY)<1e-8);
const result={designSha256:sha(design),verifiedSha256:sha(verified),physical,panels,routing,pairs,differences,perCase,conservativeCNY,
  offPeakCacheAwareCNY:(physical.input-physical.cached+physical.cached*.02+physical.output*4)/1e6,
  cumulativeEstimatedCNY:+(design.priorCNY+conservativeCNY).toFixed(6),materialReports:verified.materialReports,scoreReports:verified.scoreReports};
if(process.argv.includes('--write')) dump(directory+'/summary.json',result);
if(process.argv.includes('--verify')) assert.deepEqual(result,read('summary'));
console.log(JSON.stringify({...result,perCase:undefined},null,2));
