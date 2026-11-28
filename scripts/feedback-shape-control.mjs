import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read, setting, directory, dump, unseal, transferPrivate} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {parse as parseLinked} from './linked-fixture-oracle.mjs';
import {parseArray} from './feedback-array-fixtures.mjs';

// Counterfactual using only initial executions; no model answer or scoring receipt is read.
assert.equal(setting.generation,'api-feedback');
const key = fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const material = read('materials/receipt');
const reports = new Map(unseal(read('materials/evidence.enc'),key).map(r=>[r.id,r]));
const fixtures = transferPrivate(key), starters = read('starters'), tasks = read('transfer');
const panels = {}, rows = [];
for (const [i, m] of material.rows.entries()) {
  const {panel,id} = starters[i];
  assert.equal(m.caseId,id);
  const linked = panel === 'linked', visibleLength = linked ? 0 : 1;
  const parse = linked ? parseLinked : parseArray;
  const shown = parse(tasks[i].source.text), hidden = parse(fixtures[i].harness);
  assert.equal(shown.length,2);
  assert.ok(shown.every(r=>r.input[0].length !== visibleLength));
  const targeted = hidden.map(r=>r.input[0].length === visibleLength);
  assert.ok(targeted.some(Boolean) && targeted.some(v=>!v));
  const initialPassed = m.initial.status === 'passed' && m.originalHoldout === 'passed';
  let classification = 'fails';
  if (m.initial.status === 'passed') {
    const report = reports.get(m.reportIds[3]);
    assert.equal(report.status,m.originalHoldout);
    const lines = report.tests[0]?.process?.stdout?.trim().split(/\r?\n/) ?? [];
    const valid = lines.length === hidden.length && lines.every(v=>v==='true'||v==='false');
    if (!valid) classification = 'indeterminate';
    else {
      assert.equal(lines.every(v=>v==='true'),initialPassed);
      if (lines.every((v,j)=>targeted[j]||v==='true')) classification = 'passes';
    }
  }
  const p = panels[panel] ??= {n:0,initial:0,passes:0,fails:0,indeterminate:0,newPasses:0};
  p.n++;
  p.initial += Number(initialPassed);
  p[classification]++;
  p.newPasses += Number(!initialPassed && classification==='passes');
  rows.push({id,panel,initialPassed,classification});
}
const result = {materialSha256:sha(material),panels,rows};
if (process.argv.includes('--write')) dump(directory+'/shape-control.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('shape-control'));
console.log(JSON.stringify(panels));
