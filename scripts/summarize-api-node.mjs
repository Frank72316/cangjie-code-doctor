import assert from 'node:assert/strict';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation, 'api-node');
const design = read('design'), pack = read('candidates'), audit = read('verified');
assert.equal(sha(design), pack.designSha256);
assert.equal(audit.rows.length, 64);
const byGroup = Object.fromEntries(design.groups.map(g => [g,{statuses:{}, input:0, cached:0, output:0}]));
const byCase = Object.fromEntries(design.cases.map(c => [c.id,{L:0,N:0,O:0,B:0}]));
const seen = new Set();
for (const [i, job] of design.schedule.entries()) {
  const row = audit.rows[i], reply = pack.results[i];
  for (const key of ['group','caseId','repeat']) {
    assert.equal(row[key],job[key]);
    assert.equal(reply[key],job[key]);
  }
  const id = JSON.stringify(job);
  assert.ok(!seen.has(id));
  seen.add(id);
  const arm = byGroup[job.group], u = reply.usage;
  assert.equal(u.prompt_tokens, u.prompt_cache_hit_tokens + u.prompt_cache_miss_tokens);
  arm.statuses[row.status] = (arm.statuses[row.status] ?? 0) + 1;
  arm.input += u.prompt_tokens;
  arm.cached += u.prompt_cache_hit_tokens;
  arm.output += u.completion_tokens;
  if (row.status === 'passed') byCase[job.caseId][job.group]++;
}
const byPair = {};
for (const c of design.cases) {
  const pair = byPair[c.pair] ??= {L:0,N:0,O:0,B:0};
  for (const g of design.groups) pair[g] += byCase[c.id][g];
}
function contrast(weights) {
  const pairedCounts = Object.values(byPair).map(p => Object.entries(weights).reduce((v,[g,w]) => v+w*p[g],0));
  return {netPassed:pairedCounts.reduce((a,b) => a+b,0), pairedCounts};
}
const comparisons = {
  bothVsList:contrast({B:1,L:-1}), nodeVsList:contrast({N:1,L:-1}), optionVsList:contrast({O:1,L:-1}),
  bothVsNode:contrast({B:1,N:-1}), bothVsOption:contrast({B:1,O:-1}), interaction:contrast({B:1,N:-1,O:-1,L:1})
};
const arms = Object.values(byGroup);
for (const a of arms) assert.equal(Object.values(a.statuses).reduce((x,y)=>x+y,0),16);
const conservativeCNY = arms.reduce((s,a)=>s+a.input*2+a.output*8,0)/1e6;
assert.ok(Math.abs(audit.rows.reduce((s,r)=>s+r.costCNY,0)-conservativeCNY)<1e-8);
// The pricing window here applies only to the frozen Saturday run (Beijing time).
for (const r of pack.results) assert.equal(new Date(new Date(r.startedAt).getTime()+8*3600000).toISOString().slice(0,10),'2026-11-28');
const offPeakCacheAwareCNY = arms.reduce((s,a)=>s+(a.input-a.cached)+a.cached*.02+a.output*4,0)/1e6;
const result = {designSha256:sha(design), verifiedSha256:sha(audit), byGroup, byCase, byPair, comparisons, conservativeCNY,
  offPeakCacheAwareCNY, cumulativeEstimatedCNY:+(design.priorCNY+conservativeCNY).toFixed(6), materialReports:audit.materialReports, scoreReports:audit.scoreReports};
if (process.argv.includes('--write')) dump(directory+'/summary.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('summary'));
console.log(JSON.stringify(result,null,2));
