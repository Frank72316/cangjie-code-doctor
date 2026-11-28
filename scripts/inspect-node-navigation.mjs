import assert from 'node:assert/strict';
import {read, setting, dump, directory} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

// Descriptive check on locked source. A node's .next property differs from an iterator's .next() call.
assert.equal(setting.generation, 'api-node');
const design = read('design'), pack = read('candidates');
assert.equal(sha(design), pack.designSha256);
const totals = Object.fromEntries(design.groups.map(g => [g,{correctDirectionProperty:0,matchOnCursor:0}]));
const rows = pack.results.map((row,i) => {
  const expected = design.schedule[i];
  for (const k of ['caseId','repeat','group']) assert.equal(row[k],expected[k]);
  const body = row.code.split(/\nmain\s*\(/)[0].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"/g, ' ');
  const correctDirectionProperty = row.caseId.endsWith('_left')
    ? /\.\s*prev\b(?!\s*\()/.test(body)
    : /\.\s*next\b(?!\s*\()/.test(body);
  const matchOnCursor = /\bmatch\s*\(\s*cursor\s*\)/.test(body);
  totals[row.group].correctDirectionProperty += Number(correctDirectionProperty);
  totals[row.group].matchOnCursor += Number(matchOnCursor);
  return {...expected, correctDirectionProperty, matchOnCursor};
});
const result = {candidatesSha256:sha(pack), totals, rows};
if (process.argv.includes('--write')) dump(directory+'/navigation.json',result);
if (process.argv.includes('--verify')) assert.deepEqual(result,read('navigation'));
console.log(JSON.stringify(totals));
