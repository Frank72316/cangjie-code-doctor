import assert from 'node:assert/strict';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation, 'api-review');
const design = read('design');
const candidates = read('candidates');
const audit = read('verified');
const materials = read('materials/receipt');
const scoring = read('score/receipt');
const groups = ['G', 'E'];
const strata = ['passed', 'publicFailure', 'hiddenOnlyFailure'];

assert.equal(sha(materials), design.materialReceiptSha256);
assert.equal(sha(design), candidates.designSha256);
assert.equal(sha(candidates), scoring.candidatesSha256);
assert.equal(audit.rows.length, 96);

const key = (caseId, repeat, group) => [caseId, repeat, group].join('/');
const trials = new Map();
for (const [i, job] of design.schedule.entries()) {
  const candidate = candidates.results[i], verdict = audit.rows[i], score = scoring.rows[i];
  for (const record of [candidate, verdict, score]) {
    for (const field of ['repeat', 'group', 'caseId']) assert.equal(record[field], job[field]);
  }
  const id = key(job.caseId, job.repeat, job.group);
  assert.ok(!trials.has(id));
  trials.set(id, {candidate, verdict, score});
}

function newArm() {
  return {
    runs: 0, passed: 0, fixed: 0, regressed: 0, preserved: 0, stillFailing: 0,
    guardPassed: 0, guardRegressed: 0, publicRejected: 0,
    onDemandPassed: 0, onDemandCalls: 0, onDemandCostCNY: 0,
    unchanged: 0, sameCodeAcrossRepeats: 0,
    byStarter: Object.fromEntries(strata.map(s => [s, {n: 0, passed: 0, unchanged: 0}])),
    statuses: {}, input: 0, output: 0, cached: 0
  };
}

const arms = {G: newArm(), E: newArm()};
const baseline = Object.fromEntries(strata.map(s => [s, 0]));
const pairs = {}, cases = [];
for (const [i, task] of design.cases.entries()) {
  const material = materials.rows[i];
  assert.equal(material.caseId, task.id);
  const publicOK = material.initial.status === 'passed';
  const starterPassed = publicOK && material.originalHoldout === 'passed';
  const stratum = starterPassed ? 'passed' : publicOK ? 'hiddenOnlyFailure' : 'publicFailure';
  baseline[stratum]++;
  const row = {id: task.id, pair: task.pair, context: task.context, baseline: stratum, G: 0, E: 0};
  const pair = pairs[task.pair] ??= {Z: 0, G: 0, E: 0};
  pair.Z += 2 * Number(starterPassed);

  for (const group of groups) {
    const arm = arms[group], bucket = arm.byStarter[stratum];
    const first = trials.get(key(task.id, 1, group)).candidate;
    const second = trials.get(key(task.id, 2, group)).candidate;
    arm.sameCodeAcrossRepeats += Number(Boolean(first.codeSha256) && first.codeSha256 === second.codeSha256);
    for (const repeat of [1, 2]) {
      const {candidate, verdict, score} = trials.get(key(task.id, repeat, group));
      const passed = verdict.status === 'passed';
      const revisedPublicOK = score.publicStatus === 'passed';
      const guarded = revisedPublicOK ? passed : starterPassed;
      const unchanged = candidate.codeSha256 === task.sourceHash;

      arm.runs++;
      arm.passed += Number(passed);
      arm.statuses[verdict.status] = (arm.statuses[verdict.status] ?? 0) + 1;
      arm.fixed += Number(passed && !starterPassed);
      arm.regressed += Number(!passed && starterPassed);
      arm.preserved += Number(passed && starterPassed);
      arm.stillFailing += Number(!passed && !starterPassed);
      arm.guardPassed += Number(guarded);
      arm.guardRegressed += Number(starterPassed && !guarded);
      arm.publicRejected += Number(!revisedPublicOK);
      arm.onDemandPassed += Number(publicOK ? starterPassed : guarded);
      if (!publicOK) {
        arm.onDemandCalls++;
        arm.onDemandCostCNY += verdict.costCNY;
      }
      arm.unchanged += Number(unchanged);
      bucket.n++;
      bucket.passed += Number(passed);
      bucket.unchanged += Number(unchanged);
      pair[group] += Number(passed);
      row[group] += Number(passed);

      const usage = candidate.usage;
      assert.equal(usage.prompt_cache_hit_tokens + usage.prompt_cache_miss_tokens, usage.prompt_tokens);
      const dateInBeijing = new Date(Date.parse(candidate.startedAt) + 8 * 3600_000);
      assert.equal(dateInBeijing.toISOString().slice(0, 10), '2026-11-28');
      arm.input += usage.prompt_tokens;
      arm.output += usage.completion_tokens;
      arm.cached += usage.prompt_cache_hit_tokens;
    }
  }
  cases.push(row);
}

for (const arm of Object.values(arms)) {
  assert.equal(arm.runs, 48);
  assert.equal(arm.passed, 2 * baseline.passed + arm.fixed - arm.regressed);
  arm.onDemandCostCNY = Number(arm.onDemandCostCNY.toFixed(6));
}
assert.equal(Object.keys(pairs).length, 12);
const differences = Object.values(pairs).map(pair => pair.E - pair.G);
const comparison = {
  net: arms.E.passed - arms.G.passed,
  improvedPairs: differences.filter(v => v > 0).length,
  tiedPairs: differences.filter(v => v === 0).length,
  worsePairs: differences.filter(v => v < 0).length
};
const total = field => arms.G[field] + arms.E[field];
const conservativeCNY = (total('input') * 2 + total('output') * 8) / 1e6;
assert.ok(Math.abs(conservativeCNY - audit.rows.reduce((s, r) => s + r.costCNY, 0)) < 1e-8);
const result = {
  designSha256: sha(design), verifiedSha256: sha(audit), baseline, arms, comparison, pairs, cases,
  conservativeCNY,
  offPeakCacheAwareCNY: (total('input') - total('cached') + 0.02 * total('cached') + 4 * total('output')) / 1e6,
  cumulativeEstimatedCNY: Number((design.priorCNY + conservativeCNY).toFixed(6)),
  materialReports: audit.materialReports, scoreReports: audit.scoreReports
};
if (process.argv.includes('--write')) dump(directory + '/summary.json', result);
if (process.argv.includes('--verify')) assert.deepEqual(result, read('summary'));
console.log(JSON.stringify({...result, cases: undefined}, null, 2));
