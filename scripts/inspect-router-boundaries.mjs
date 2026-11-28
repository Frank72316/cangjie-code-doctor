import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read, transferPrivate, unseal, setting, directory, dump} from './api-evidence-common.mjs';

const review = setting.generation === 'api-review';
assert.ok(review || setting.generation === 'api-router');
const key = fs.readFileSync('data/holdout/challenge-v1/key.txt', 'utf8').trim();
const hidden = new Map(transferPrivate(key).map(c => [c.id, c]));
const newIds = review ? new Set(hidden.keys()) : new Set(read('panels').filter(c => c.panel === 'new').map(c => c.id));

function reports(phase) {
  return new Map(unseal(read(phase + '/evidence.enc'), key).map(r => [r.id, r]));
}
function counts() {
  return {boundaryOnly: 0, ordinaryOnly: 0, mixed: 0, incompleteTrace: 0};
}
function classify(test, report) {
  const output = report.tests?.[0]?.process?.stdout?.trim().split(/\r?\n/) ?? [];
  if (output.length !== test.assertions || !output.every(x => x === 'true' || x === 'false')) return 'incompleteTrace';
  const fixtures = test.harness.trim().split(/\r?\n/);
  assert.equal(fixtures.length, 3 * test.assertions);
  const failures = new Set();
  for (const [i, value] of output.entries()) {
    if (value === 'true') continue;
    const array = /LinkedList<Int64>\((?:\[([^\]]*)\]|Array<Int64>\(\))\)/.exec(fixtures[3*i]);
    const arg = /=\s*repair\(q\d+,\s*(None|-?\d+|q\d+\.nodeAt\((\d+)\)),/.exec(fixtures[3*i+1]);
    assert.ok(array && arg);
    const size = array[1] ? array[1].split(',').length : 0;
    const pos = arg[1] === 'None' ? -1 : Number(arg[2] ?? arg[1]);
    failures.add(size === 0 || pos < 0 || pos >= size ? 'boundaryOnly' : 'ordinaryOnly');
  }
  assert.ok(failures.size);
  return failures.size === 1 ? [...failures][0] : 'mixed';
}

const score = reports('score'), total = counts(), rows = [];
for (const row of read('score/receipt').rows) {
  if (row.status !== 'holdout_failed' || !newIds.has(row.caseId)) continue;
  const category = classify(hidden.get(row.caseId), score.get(row.holdoutId));
  total[category]++;
  rows.push({caseId:row.caseId, repeat:row.repeat, group:row.group, category});
}
const result = {scope:'Post hoc, new physical candidates failing hidden checks. Boundary means empty list or invalid/missing position.', counts:total, rows};
if (review) {
  const materials = reports('materials');
  result.scope = 'Descriptive classification of public-passing drafts that fail hidden checks. Boundary means empty list or invalid/missing position.';
  result.byGroup = {Z:counts(), G:counts(), E:counts()};
  for (const row of rows) result.byGroup[row.group][row.category]++;
  for (const row of read('materials/receipt').rows) {
    if (row.initial.status !== 'passed' || row.originalHoldout === 'passed') continue;
    const category = classify(hidden.get(row.caseId), materials.get(row.reportIds[3]));
    result.byGroup.Z[category]++;
  }
}
if (process.argv.includes('--write')) dump(directory + '/boundary-failures.json', result);
if (process.argv.includes('--verify')) assert.deepEqual(result, read('boundary-failures'));
console.log(JSON.stringify(result.byGroup ?? total));
