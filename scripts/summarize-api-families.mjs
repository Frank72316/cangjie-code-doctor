import assert from 'node:assert/strict';
import {directory,read,dump,familyStudy} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.ok(familyStudy,'Pass --families');
const design=read('design'), corpus=read('corpus'), labels=read('labels');
assert.equal(sha(labels),design.labelsSha256);
const docs=new Map(corpus.documents.map(d=>[d.id,d]));
const arms=['B','F','T'];
const rows=design.cases.map(c=>{
  const label=labels.find(l=>l.id===c.id);
  assert.deepEqual(c.acceptable,label.acceptable);assert.equal(c.gold,label.gold);
  const retrieval=Object.fromEntries(arms.map(arm=>{
    const ids=c.ranks[arm],d=docs.get(ids[0]);
    assert.ok(ids.length===3 && ids.every(id=>docs.has(id)));
    return [arm,{first:d.title+'.'+d.section,ownerHit:d.title===c.panel,preferred:ids[0]===c.gold,
      hit1:c.acceptable.includes(ids[0]),hit3:ids.some(id=>c.acceptable.includes(id))}];
  }));
  return {id:c.id,family:c.panel,detected:c.detectedOwner,changed:c.hashes.F!==c.hashes.T,retrieval};
});
const retrieval=Object.fromEntries(arms.map(arm=>[arm,Object.fromEntries(['hit1','hit3','preferred','ownerHit'].map(key=>[key,rows.filter(r=>r.retrieval[arm][key]).length]))]));
if(process.argv.includes('--retrieval')){console.log(JSON.stringify({retrieval,rows},null,2));process.exit(0);}
const verified=read('verified'), pack=read('candidates');
assert.equal(sha(design),pack.designSha256);
assert.equal(verified.rows.length,design.schedule.length);
for(const [index,record] of verified.rows.entries()){
  const job=design.schedule[index],candidate=pack.results[index];
  for(const key of ['caseId','repeat','group']){
    assert.equal(record[key],job[key]);assert.equal(candidate[key],job[key]);
  }
  assert.equal(record.costCNY,candidate.costCNY);
}
const groups=['F','T'];
for(const row of rows){
  const perGroup=group=>verified.rows.filter(r=>r.caseId===row.id && r.group===group);
  for(const arm of groups) assert.deepEqual(perGroup(arm).map(r=>r.repeat),[1,2]);
  row.passed=Object.fromEntries(groups.map(g=>[g,perGroup(g).filter(r=>r.status==='passed').length]));
}
const sum=(list,fn)=>list.reduce((s,r)=>s+fn(r),0);
function effects(selected){
  const passed=Object.fromEntries(groups.map(g=>[g,sum(selected,r=>r.passed[g])]));
  return {cases:selected.length,perArm:selected.length*2,passed,differencePoints:100*(passed.T-passed.F)/(selected.length*2)};
}
const families=Object.fromEntries([...new Set(rows.map(r=>r.family))].map(f=>[f,effects(rows.filter(r=>r.family===f))]));
const diff=Object.values(families).map(s=>s.differencePoints);
const samples=[];
for(const a of diff)for(const b of diff)for(const c of diff)for(const d of diff)samples.push((a+b+c+d)/4);
samples.sort((a,b)=>a-b);
const pct=p=>{const i=(samples.length-1)*p,k=Math.floor(i);return samples[k]+(i-k)*(samples[Math.ceil(i)]-samples[k]);};
const costCNY=Number(sum(verified.rows,r=>r.costCNY).toFixed(6));
const statuses=Object.fromEntries(groups.map(g=>{const counts={};for(const r of verified.rows.filter(r=>r.group===g))counts[r.status]=(counts[r.status]??0)+1;return [g,counts];}));
const slices={};for(const [name,flag] of [['same',false],['changed',true]]){const sel=rows.filter(r=>r.changed===flag);slices[name]=sel.length?effects(sel):null;}
const result={designSha256:sha(design),verifiedSha256:sha(verified),retrieval,rows,families,overall:effects(rows),slices,
 clusterPercentile95:[pct(0.025),pct(0.975)],statuses,materialReports:verified.materialReports,scoreReports:verified.scoreReports,
 tokens:{input:sum(verified.rows,r=>r.input),output:sum(verified.rows,r=>r.output)},costCNY,cumulativeEstimatedCNY:Number((design.priorCNY+costCNY).toFixed(6))};
if(process.argv.includes('--write')) dump(directory+'/summary.json',result);
if(process.argv.includes('--verify')) assert.deepEqual(result,read('summary'));
console.log(JSON.stringify(result,null,2));
