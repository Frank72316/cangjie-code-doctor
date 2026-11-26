// First-attempt difficulty calibration. Each frozen development request is sent at most once.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { loadAIConfig } from './ai-service.mjs';
import { candidate, sha } from './pilot-common.mjs';
import { usageCost } from './pilot-generate.mjs';

const design = JSON.parse(await readFile('docs/experiments/2026-11-26-challenge/offline-design.json', 'utf8'));
const identity = 'df4fa3ca51f197fcb298321e900fede9eafe2a612d70f48d88b21319712658f9';
if (sha(design) !== identity || design.development.length !== 18) throw Error('Frozen design changed');
const jobs = design.development.map(({caseId, group}) => {
  const item = design.cases.find(c => c.caseId === caseId && c.split === 'development');
  const body = item.requests[group];
  if (sha(body) !== item.requestHashes[group] || body.model !== 'deepseek-flash') throw Error('Request changed');
  // Count UTF-8 bytes as an upper bound on input tokens, plus message framing.
  const reserved = ((Buffer.byteLength(JSON.stringify(body)) + 1024) * 2 + body.max_tokens * 8) / 1e6;
  return {caseId, group, body, reserved};
});
const ceiling = jobs.reduce((sum, job) => sum + job.reserved, 0);
if (ceiling > 2) throw Error('Calibration exceeds the 2 CNY allocation');
console.log(JSON.stringify({jobs: jobs.length, maximumEstimatedCNY: ceiling}));
if (!process.argv.includes('--live')) process.exit(0);
const config = await loadAIConfig(process.cwd());
if (!config.ready) throw Error('Local DeepSeek configuration unavailable');
const folder = 'runs/challenge-v1-dev-first';
await mkdir(folder); // An interrupted run must be inspected before spending again.
const pack = {designSha256: identity, phase: 'development-first-attempt', startedAt: new Date().toISOString(), ceilingCNY: ceiling, results: []};
async function save() {
  await writeFile(folder + '/pending.json', JSON.stringify(pack, null, 2));
  await rename(folder + '/pending.json', folder + '/candidates.json');
}
for (const {caseId, group, body, reserved} of jobs) {
  const row = {caseId, group, requestSha256: sha(body), startedAt: new Date().toISOString(), status: 'pending', costUpperEstimateCNY: reserved};
  pack.results.push(row);
  await save();
  let response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + config.key},
      body: JSON.stringify(body)
    });
    row.httpStatus = response.status;
    if (!response.ok) throw Error('Service rejected request');
    const data = await response.json();
    if (JSON.stringify(data).includes(config.key)) throw Error('Unexpected secret in response');
    row.model = data.model;
    row.responseId = data.id;
    row.usage = data.usage;
    const estimate = usageCost(data.usage);
    if (estimate === null || estimate > reserved || data.model !== body.model) throw Error('Metering or model mismatch');
    row.costUpperEstimateCNY = estimate;
    row.finishReason = data.choices?.[0]?.finish_reason;
    row.answer = data.choices?.[0]?.message?.content;
    row.status = 'invalid';
    if (row.finishReason === 'stop') {
      try {
        row.code = candidate(row.answer);
        row.codeSha256 = sha(row.code);
        row.status = 'generated';
      } catch { /* Keep invalid answer for diagnosis. */ }
    }
  } catch {
    row.status = 'service_failed';
  }
  row.finishedAt = new Date().toISOString();
  await save();
  console.log(caseId, group, row.status);
  if (row.status === 'service_failed') throw Error('Stopped after service or accounting failure');
}
pack.finishedAt = new Date().toISOString();
await save();
