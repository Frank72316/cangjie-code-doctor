import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {read, directory, setting, dump} from './api-evidence-common.mjs';
import {collectionSignatures} from './collection-signatures.mjs';
import {CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {sha, SYSTEM} from './pilot-common.mjs';

assert.equal(setting.generation, 'api-node');
const transfer = read('transfer');
const materials = read('materials/receipt');
assert.ok(materials.accepted && materials.rows.length === 8 && materials.reports === 32);
assert.equal(materials.transferSha256, sha(transfer));
assert.equal(materials.holdoutSha256, read('transfer.enc').sha256);
const parent = 'docs/experiments/2026-11-27-api-families/';
const bytes = readFileSync(parent + 'corpus.json', 'utf8');
const corpusHash = JSON.parse(readFileSync(parent + 'sources.json', 'utf8')).corpusSha256;
assert.equal(sha(bytes), corpusHash);
const corpus = JSON.parse(bytes);
const [nodeMembers, optionExample] = read('cards');
assert.equal(nodeMembers.id, 'node-members');
assert.equal(optionExample.id, 'option-match');
const groups = ['L', 'N', 'O', 'B'];
const cases = transfer.map(task => {
  const base = collectionSignatures(corpus, task.source.text);
  assert.equal(base.sources.length, 26);
  const supplements = {L: [], N: [nodeMembers], O: [optionExample], B: [nodeMembers, optionExample]};
  const initial = materials.rows.find(row => row.caseId === task.id).initial;
  const requests = {}, hashes = {};
  for (const group of groups) {
    const documents = [base.document, ...supplements[group]];
    const payload = {sdkVersion:'1.0.5', task:task.task, source:task.source, publicTests:task.publicTests, initial, documents};
    requests[group] = {...CHALLENGE_SETTINGS, messages:[
      {role:'system', content:SYSTEM}, {role:'user', content:JSON.stringify(payload)}
    ]};
    hashes[group] = sha(requests[group]);
  }
  return {id:task.id, pair:task.id.split('_')[0], requests, hashes};
});
const schedule = [];
const positions = Object.fromEntries(groups.map(g => [g, [0,0,0,0]]));
for (let repeat = 1; repeat <= 2; repeat++) {
  for (let k = 0; k < cases.length; k++) {
    const index = repeat === 1 ? k : cases.length-1-k;
    const rotation = (index + 2*(repeat-1)) % groups.length;
    for (const [position, offset] of [0,1,3,2].entries()) {
      const group = groups[(rotation+offset) % groups.length];
      positions[group][position]++;
      schedule.push({caseId:cases[index].id, repeat, group});
    }
  }
}
assert.ok(Object.values(positions).every(counts => counts.every(v => v === 4)));
const maximumReservedCNY = schedule.reduce((sum, job) => {
  const body = cases.find(c => c.id === job.caseId).requests[job.group];
  return sum + ((Buffer.byteLength(JSON.stringify(body))+1024)*2 + body.max_tokens*8)/1e6;
}, 0);
assert.ok(schedule.length === 64 && maximumReservedCNY <= setting.cap);
const design = {model:CHALLENGE_SETTINGS.model, apiCorpusSha256:corpusHash, materialReceiptSha256:sha(materials),
  newHoldoutSha256:materials.holdoutSha256, priorCNY:4.795460, capCNY:setting.cap, maximumReservedCNY, groups, positions, cases, schedule};
if (process.argv.includes('--verify')) assert.deepEqual(design, read('design'));
else dump(directory+'/design.json', design);
console.log(JSON.stringify({requests:schedule.length, maximumReservedCNY, positions}));
