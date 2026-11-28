import assert from 'node:assert/strict';
import fs from 'node:fs';
import {directory, dump, read, setting, transferPrivate, unseal} from './api-evidence-common.mjs';
import {parse as parseLinked} from './linked-fixture-oracle.mjs';
import {parseArray} from './feedback-array-fixtures.mjs';
import {sha} from './pilot-common.mjs';

assert.equal(setting.generation, 'api-feedback');
const key = fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const metadata = read('starters');
const fixtures = new Map(transferPrivate(key).map((h,i) => {
  assert.equal(h.id,metadata[i].id);
  const linked = metadata[i].panel === 'linked';
  const rows = (linked ? parseLinked : parseArray)(h.harness);
  const other = rows.map(row=>row.input[0].length !== (linked ? 0 : 1));
  assert.ok(other.some(Boolean) && other.some(b=>!b));
  return [h.id,other];
}));
const accepted = new Set(read('review').acceptedBodyHashes);
const candidates = read('candidates'), receipt = read('score/receipt');
const reports = new Map(unseal(read('score/evidence.enc'),key).map(r=>[r.id,r]));
const rows = receipt.rows.map((row,i) => {
  const candidate = candidates.results[i], mask = fixtures.get(row.caseId);
  assert.equal(candidate.caseId,row.caseId);
  assert.equal(candidate.group,row.group);
  assert.equal(candidate.repeat,row.repeat);
  const pub = row.publicStatus === 'passed';
  let otherShapePassed = false, traceComplete = false;
  if (pub) {
    const report = reports.get(row.holdoutId);
    const lines = report.tests[0]?.process?.stdout?.trim().split(/\r?\n/) ?? [];
    traceComplete = lines.length === mask.length && lines.every(s=>s==='true'||s==='false');
    if (traceComplete) {
      assert.equal(report.status==='passed',lines.every(s=>s==='true'));
      otherShapePassed = accepted.has(candidate.codeSha256) && lines.every((s,i)=>!mask[i]||s==='true');
    } else assert.notEqual(row.status,'passed');
  }
  return {caseId:row.caseId,group:row.group,repeat:row.repeat,traceComplete,otherShapePassed};
});
const result = {scoreSha256:sha(receipt),rows};
if (process.argv.includes('--write')) dump(directory+'/holdout-traces.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('holdout-traces'));
console.log('Verified '+rows.length+' different-length-category outcomes against raw SDK output.');
