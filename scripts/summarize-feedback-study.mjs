import assert from 'node:assert/strict';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-feedback');
const design = read('design'), pack = read('candidates'), score = read('score/receipt');
const audit = read('verified'), materials = read('materials/receipt'), traces = read('holdout-traces');
const accepted = new Set(read('review').acceptedBodyHashes);
assert.equal(sha(score),traces.scoreSha256);
assert.equal(sha(materials),design.materialReceiptSha256);
assert.equal(sha(design),pack.designSha256);
assert.equal(sha(pack),score.candidatesSha256);
const groups = ['H','S','R'];
function metrics() {
  return {runs:0,publicPassed:0,probePassed:0,passed:0,probeOnly:0,unseenOnly:0,otherShapePassed:0,fixed:0,regressed:0,unchanged:0};
}
function panel() {
  return {n:0,basePassed:0,baseProbe:{passed:0,mismatch:0,unavailable:0}, arms:Object.fromEntries(groups.map(g=>[g,metrics()])),
    byObservation:{passed:{H:0,S:0,R:0},mismatch:{H:0,S:0,R:0},unavailable:{H:0,S:0,R:0}},
    policies:Object.fromEntries(['public','publicOrProbe','always'].map(name=>[name,{calls:0,passed:0,costCNY:0}])), families:{}};
}
const panels = {linked:panel(),array:panel()}, cases = {}, starter = new Map();
for (const [i,c] of design.cases.entries()) {
  const m = materials.rows[i];
  assert.equal(m.caseId,c.id);
  const basePassed = m.initial.status === 'passed' && m.originalHoldout === 'passed';
  const probe = m.probe.starter;
  const baseProbe = probe.status === 'passed' ? 'passed' : 'returned' in probe ? 'mismatch' : 'unavailable';
  starter.set(c.id,{c,basePassed,baseProbe,publicFailure:m.initial.status!=='passed'});
  const p = panels[c.panel];
  p.n++;
  p.basePassed += Number(basePassed);
  p.baseProbe[baseProbe]++;
  p.families[c.family] ??= {H:0,S:0,R:0};
  cases[c.id] = {panel:c.panel,family:c.family,basePassed,baseProbe,H:0,S:0,R:0};
}
const tokens = {input:0, cached:0, output:0}, seen = new Set();
for (const [i,job] of design.schedule.entries()) {
  const r = score.rows[i], v = audit.rows[i], t = traces.rows[i], candidate = pack.results[i];
  for (const record of [r,v,t,candidate]) {
    for (const field of ['group','caseId','repeat']) assert.equal(record[field],job[field]);
  }
  const key = [job.caseId,job.group,job.repeat].join('/');
  assert.ok(!seen.has(key)); seen.add(key);
  const {c,basePassed,baseProbe,publicFailure} = starter.get(job.caseId);
  const p = panels[c.panel], a = p.arms[job.group];
  const passed = v.status === 'passed', publicPassed = r.publicStatus === 'passed';
  const probePassed = publicPassed && r.probeStatus === 'passed' && accepted.has(candidate.codeSha256);
  assert.ok(!passed || t.otherShapePassed);
  p.byObservation[baseProbe][job.group] += Number(passed);
  if (job.group === 'R') {
    const triggers = {public:publicFailure, publicOrProbe:publicFailure || baseProbe !== 'passed', always:true};
    for (const [name,call] of Object.entries(triggers)) {
      const policy = p.policies[name];
      policy.calls += Number(call);
      policy.passed += Number(call ? passed : basePassed);
      if (call) policy.costCNY += v.costCNY;
    }
  }
  a.runs++;
  a.publicPassed += Number(publicPassed);
  a.probePassed += Number(probePassed);
  a.passed += Number(passed);
  a.probeOnly += Number(probePassed && !passed);
  a.unseenOnly += Number(!probePassed && passed);
  a.otherShapePassed += Number(t.otherShapePassed);
  a.fixed += Number(passed && !basePassed);
  a.regressed += Number(!passed && basePassed);
  a.unchanged += Number(candidate.codeSha256 === c.sourceHash);
  p.families[c.family][job.group] += Number(passed);
  cases[c.id][job.group] += Number(passed);
  const u = candidate.usage;
  assert.equal(u.prompt_tokens,u.prompt_cache_hit_tokens+u.prompt_cache_miss_tokens);
  assert.equal(new Date(Date.parse(candidate.startedAt)+8*3600000).toISOString().slice(0,10),'2026-11-28');
  tokens.input += u.prompt_tokens; tokens.cached += u.prompt_cache_hit_tokens; tokens.output += u.completion_tokens;
}

assert.equal(seen.size,192);
for (const [panelName,p] of Object.entries(panels)) {
  const subset = Object.values(cases).filter(c=>c.panel===panelName);
  for (const policy of Object.values(p.policies)) policy.costCNY = Number(policy.costCNY.toFixed(6));
  p.comparisons = {};
  for (const [treatment,control] of [['R','H'],['S','H'],['R','S']]) {
    const delta = p.arms[treatment].passed-p.arms[control].passed;
    const diffs = subset.map(c=>c[treatment]-c[control]);
    p.comparisons[treatment+'-'+control] = {delta,improved:diffs.filter(v=>v>0).length,tied:diffs.filter(v=>v===0).length,worse:diffs.filter(v=>v<0).length};
  }
  p.leaveOneFamilyOut = Object.fromEntries(Object.entries(p.families).map(([name,f])=>[name,p.comparisons['R-H'].delta-(f.R-f.H)]));
  for (const a of Object.values(p.arms)) {
    assert.equal(a.runs,p.n*2);
    assert.equal(a.passed,p.basePassed*2+a.fixed-a.regressed);
    assert.equal(a.probePassed-a.probeOnly+a.unseenOnly,a.passed);
  }
}
const conservativeCNY = (2*tokens.input+8*tokens.output)/1e6;
assert.ok(Math.abs(conservativeCNY-audit.rows.reduce((sum,row)=>sum+row.costCNY,0))<1e-8);
const result = {designSha256:sha(design),verifiedSha256:sha(audit),panels,cases,tokens,conservativeCNY,
  offPeakEstimatedCNY:(tokens.input-tokens.cached+0.02*tokens.cached+4*tokens.output)/1e6,
  cumulativeEstimatedCNY:Number((design.priorCNY+conservativeCNY).toFixed(6)),materials:audit.materialReports,scoreReports:audit.scoreReports};
if (process.argv.includes('--write')) dump(directory+'/summary.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('summary'));
console.log(JSON.stringify({...result,cases:undefined},null,2));
