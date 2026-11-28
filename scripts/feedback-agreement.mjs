import assert from 'node:assert/strict';
import {read, setting, directory, dump} from './api-evidence-common.mjs';

assert.equal(setting.generation,'api-feedback');
const design = read('design'), candidates = read('candidates'), audit = read('verified'), receipt = read('score/receipt');
const trials = new Map(), bySource = new Map();
const materials = new Map(read('materials/receipt').rows.map(r=>[r.caseId,r]));
const sourceHashes = new Map(design.cases.map(c=>[c.id,c.sourceHash]));
let unchangedCompared = 0, unchangedDisagreements = 0;
for (const [i, job] of design.schedule.entries()) {
  const candidate = candidates.results[i], scored = audit.rows[i], sdk = receipt.rows[i];
  for (const row of [candidate,scored,sdk]) for (const field of ['group','repeat','caseId']) assert.equal(row[field],job[field]);
  const source = candidate.codeSha256;
  trials.set([job.caseId,job.repeat,job.group].join('/'),{source,ok:scored.status==='passed'});
  if (!source) continue;
  if (source === sourceHashes.get(job.caseId)) {
    const starter = materials.get(job.caseId);
    const initial = starter.initial.status === 'passed' && starter.originalHoldout === 'passed';
    unchangedCompared++;
    unchangedDisagreements += Number((scored.status==='passed') !== initial);
  }
  const key = job.caseId+'/'+source;
  const cluster = bySource.get(key) ?? {n:0,verdicts:new Set()};
  cluster.n++;
  cluster.verdicts.add(JSON.stringify([sdk.publicStatus,sdk.probeStatus,sdk.holdoutStatus,scored.status]));
  bySource.set(key,cluster);
}
const panels = {};
for (const task of design.cases) {
  const p = panels[task.panel] ??= {};
  for (const [g,c] of [['R','H'],['S','H'],['R','S']]) {
    const a = p[g+'-'+c] ??= {n:0,sameSource:0,bothPassed:0,bothFailed:0,won:0,lost:0};
    for (const repeat of [1,2]) {
      const left = trials.get([task.id,repeat,g].join('/')), right = trials.get([task.id,repeat,c].join('/'));
      a.n++;
      a.sameSource += Number(Boolean(left.source)&&left.source===right.source);
      a.bothPassed += Number(left.ok && right.ok);
      a.bothFailed += Number(!left.ok && !right.ok);
      a.won += Number(left.ok && !right.ok);
      a.lost += Number(!left.ok && right.ok);
    }
  }
}
const repeated = [...bySource.values()].filter(cluster=>cluster.n>1);
const result = {panels,unchangedCompared,unchangedDisagreements,uniqueSourcesWithinCase:bySource.size,repeatedSources:repeated.length,
  inconsistentRepeatedSources:repeated.filter(cluster=>cluster.verdicts.size>1).length};
if (process.argv.includes('--write')) dump(directory+'/agreement.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('agreement'));
console.log(JSON.stringify(result));
