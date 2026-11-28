import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read, setting, transferPrivate, unseal} from './api-evidence-common.mjs';
import {parse as parseLinked, oracle as linkedOracle} from './linked-fixture-oracle.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation,'api-feedback');
const key = fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const history = ['router','review'].map(study => {
  const data = JSON.parse(fs.readFileSync('docs/experiments/2026-11-28-'+study+'/transfer.enc.json','utf8'));
  return new Map(unseal(data,key).cases.map(c=>[c.id,c]));
});

import {parseArray, arrayOracle} from './feedback-array-fixtures.mjs';

const tasks = read('transfer'), starters = read('starters'), probes = read('probes');
const privateCases = transferPrivate(key);
assert.equal(tasks.length,32);
assert.equal(new Set(tasks.map(t=>t.id)).size,32);
assert.deepEqual(privateCases.map(c=>c.id), tasks.map(c=>c.id));
assert.deepEqual(probes.map(c=>c.id), tasks.map(c=>c.id));
const shared = new Map();
for (const [i, c] of tasks.entries()) {
  const h = privateCases[i], p = probes[i], meta = starters[i];
  assert.equal(meta.id,c.id);
  const linked = meta.panel === 'linked';
  const parse = linked ? parseLinked : parseArray;
  const oracle = linked ? linkedOracle : arrayOracle;
  const diagnostic = linked ? [p.input.list,p.input.position,p.input.t] : [p.input.array,p.input.t];
  assert.deepEqual(diagnostic, linked ? [[],['seek','twin','alternating'].includes(meta.family)?null:-1,37] : [[11],11]);
  assert.deepEqual(oracle(c.id,diagnostic),[p.expected.returned,p.expected.after]);
  const pub = parse(c.source.text);
  assert.equal(pub.length,2);
  const prior = linked ? history.flatMap(study => {
    const previous = study.get(c.id), parsed = parse(previous.harness);
    assert.equal(parsed.length,previous.assertions);
    return parsed;
  }) : [];
  const used = new Set([...pub,...prior].map(row=>sha(row.input)));
  assert.ok(!used.has(sha(diagnostic)));
  used.add(sha(diagnostic));
  const rows = parse(h.harness);
  assert.equal(rows.length,18);
  for (const row of rows) {
    assert.ok(!used.has(sha(row.input)),'Repeated input in '+c.id);
    used.add(sha(row.input));
    assert.deepEqual(oracle(c.id,row.input),[row.value,row.after]);
  }
  const pair = linked ? meta.pair : meta.family;
  const inputs = rows.map(row=>row.input);
  if (shared.has(pair)) assert.deepEqual(inputs,shared.get(pair));
  else shared.set(pair,inputs);
}
console.log('Verified 32 visible examples and 576 held-out assertions, input separation and expected returns and state.');
