import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCipheriv, randomBytes } from 'node:crypto';
import { challengeCatalog, privateChallenge } from './challenge-data.mjs';
import { sha, candidate } from './pilot-common.mjs';
import { harnessSource } from './pilot-holdout.mjs';
import { verifyPublic } from './sandbox-verify.mjs';
import { followupRequest } from './development-feedback.mjs';

const [phase, image] = process.argv.slice(2);
if (process.platform !== 'linux' || !/^sha256:[a-f0-9]{64}$/.test(image) || !['public','score'].includes(phase)) throw Error('Expected Linux SDK image and phase');
const directory = 'docs/experiments/2026-11-26-challenge';
const formal = process.argv.includes('--formal');
const split = formal ? 'evaluation' : 'development';
const prefix = formal ? 'formal/' : 'dev-';
const load = async name => JSON.parse(await readFile(directory + '/' + name + '.json','utf8'));
const design = await load('offline-design');
const pack = await load(prefix + 'first');
const snapshot = await challengeCatalog();
if (sha(design) !== pack.designSha256 || snapshot.catalogSha256 !== design.catalogSha256 || pack.results.length !== design[split].length) throw Error('Calibration input mismatch');
if (formal) {
  const freeze = await load('formal/freeze');
  if (!pack.finishedAt || pack.freezeSha256 !== sha(freeze) || sha(design) !== freeze.designSha256 || snapshot.holdoutSha256 !== design.holdoutSha256) throw Error('Formal run identity mismatch');
}
const evidence = [];
const results = [];
const output = 'runs/' + split + '-' + phase;
await mkdir(output,{recursive:true});
async function verify(source, tests) {
  const report = await verifyPublic({source, tests}, {root:process.cwd(), image, core:resolve('target/debug/doctor')});
  if (report.status === 'tool_error' || !report.containers.length || report.containers.some(c => !c.cleanup?.removed)) throw Error('Sandbox infrastructure failed');
  evidence.push(report);
  return report;
}
function publicFeedback(report) {
  return {
    status:report.status, diagnostics:report.compile.normalized?.diagnostics ?? [],
    tests:report.tests.map(t => ({id:t.id, status:t.status, stdout:t.process?.stdout ?? '', stderr:t.process?.stderr ?? ''}))
  };
}
const key = phase === 'score' ? process.env.CHALLENGE_TEST_KEY : undefined;
const hidden = key ? privateChallenge(snapshot,key) : null;
const second = phase === 'score' ? await load(prefix + 'second') : null;
const publicReceipt = second ? await load(prefix + 'public') : null;
if (phase === 'score' && (!hidden || second.firstSha256 !== sha(pack) || !second.finishedAt)) throw Error('Second round is not locked');
if (second && (second.publicReceiptSha256 !== sha(publicReceipt) || publicReceipt.firstSha256 !== sha(pack) ||
    second.results.length !== publicReceipt.results.filter(r => r.status !== 'passed').length)) throw Error('Public check or retry count changed');
for (const [index, first] of pack.results.entries()) {
  const {caseId,group,repeat} = design[split][index];
  const item = design.cases.find(c => c.caseId === caseId && c.split === split);
  const problem = snapshot.catalog.cases.find(c => c.id === caseId);
  if (formal && first.repeat !== repeat) throw Error('Frozen repetition changed');
  if (first.caseId !== caseId || first.group !== group || first.requestSha256 !== item.requestHashes[group]) throw Error('Pair order or request changed');
  const retry = second?.results.find(r => r.caseId === caseId && r.group === group && (!formal || r.repeat === repeat));
  if (second) {
    const expected = followupRequest(item.requests[group],first,publicReceipt.results[index]);
    if (expected ? retry?.requestSha256 !== sha(expected) : retry !== undefined) throw Error('Follow-up request changed');
  }
  for (const [round, row] of [[1,first], ...(retry ? [[2,retry]] : [])]) {
    const result = {caseId,group,round,status:row.status,codeSha256:row.codeSha256};
    if (formal) result.repeat = repeat;
    results.push(result);
    if (row.status !== 'generated') continue;
    if (candidate(row.answer) !== row.code || sha(row.code) !== row.codeSha256) throw Error('Candidate changed');
    const source = {name:problem.source.name,text:row.code};
    const pub = await verify(source,problem.publicTests);
    result.public = publicFeedback(pub);
    result.status = pub.status;
    result.publicReportId = pub.id;
    if (phase === 'score' && pub.status === 'passed') {
      const h = hidden.cases.find(c => c.id === caseId);
      let text;
      try { text = harnessSource(row.code,h.harness); } catch { result.status = 'harness_incompatible'; }
      if (text) {
        const report = await verify({name:source.name,text},[{id:'holdout',stdin:'',expectedStdout:h.expectedStdout}]);
        result.holdoutStatus = report.status;
        result.holdoutReportId = report.id;
        result.status = report.status === 'passed' ? 'passed' : 'holdout_failed';
      }
    }
  }
}
const receipt = {phase,commit:process.env.GITHUB_SHA,image,firstSha256:sha(pack),secondSha256:second && sha(second),reports:evidence.length,results};
await writeFile(output+'/receipt.json',JSON.stringify(receipt,null,2));
if (key) {
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
  const raw=JSON.stringify(evidence);
  const data=Buffer.concat([cipher.update(raw),cipher.final()]);
  await writeFile(output+'/evidence.enc.json',JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),sha256:sha(raw),data:data.toString('base64')}));
} else {
  await writeFile(output+'/public-reports.json',JSON.stringify(evidence));
}
console.log(JSON.stringify({phase,rows:results.length,reports:evidence.length}));
