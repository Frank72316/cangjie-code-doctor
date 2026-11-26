// Recompute the six-case calibration result from locked responses and encrypted sandbox evidence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { challengeCatalog, privateChallenge } from './challenge-data.mjs';
import { verificationRequestText } from '../web/process-evidence.mjs';
import { harnessSource } from './pilot-holdout.mjs';
import { sha, candidate } from './pilot-common.mjs';
import { usageCost } from './pilot-generate.mjs';
import { followupRequest } from './development-feedback.mjs';

const dir='docs/experiments/2026-11-26-challenge/';
const load=async name=>JSON.parse(await readFile(dir+name+'.json','utf8'));
const first=await load('dev-first'), second=await load('dev-second'), initialPublic=await load('dev-public');
const design=await load('offline-design'), receipt=await load('dev-scored/receipt'), sealed=await load('dev-scored/evidence.enc');
assert.equal(receipt.firstSha256,sha(first));
assert.equal(receipt.secondSha256,sha(second));
assert.equal(second.publicReceiptSha256,sha(initialPublic));
assert.equal(first.designSha256,sha(design));
const snapshot=await challengeCatalog();
assert.equal(snapshot.holdoutSha256,design.holdoutSha256);
const key=(await readFile('data/holdout/challenge-v1/key.txt','utf8')).trim();
const privateData=privateChallenge(snapshot,key);
const decrypt=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(sealed.iv,'hex'));
decrypt.setAuthTag(Buffer.from(sealed.tag,'hex'));
const raw=Buffer.concat([decrypt.update(Buffer.from(sealed.data,'base64')),decrypt.final()]).toString('utf8');
assert.equal(sha(raw),sealed.sha256);
const reports=JSON.parse(raw), used=new Set();
function checkReport(id,code,name,tests,status) {
  const r=reports.find(r=>r.id===id);
  assert.ok(r && !used.has(id));
  used.add(id);
  assert.equal(r.status,status);
  assert.equal(r.image,receipt.image);
  assert.equal(r.sdkVersion,'1.0.5');
  assert.equal(r.source.sha256,sha(code));
  assert.equal(r.requestSha256,sha(verificationRequestText({name,text:code},tests)));
  assert.ok(r.containers.length && r.containers.every(c=>c.cleanup?.removed));
}
const totals=Object.fromEntries(['A','B','C'].map(g=>[g,{first:0,final:0,calls:0,inputTokens:0,outputTokens:0,estimatedPeakCNY:0}]));
const cases=[];
for (const [index,{caseId,group}] of design.development.entries()) {
  const problem=snapshot.catalog.cases.find(c=>c.id===caseId && c.split==='development');
  const hidden=privateData.cases.find(h=>h.id===caseId);
  const item=design.cases.find(c=>c.caseId===caseId);
  const publicCheck=initialPublic.results[index], original=first.results[index];
  const followup=followupRequest(item.requests[group], original, publicCheck);
  const attempts=[[original,item.requests[group]]];
  if (followup) attempts.push([second.results.find(c=>c.caseId===caseId && c.group===group),followup]);
  let firstStatus, finalStatus;
  for (const [i,[response,request]] of attempts.entries()) {
    assert.equal(response.caseId,caseId);assert.equal(response.group,group);
    assert.equal(response.requestSha256,sha(request));
    const row=receipt.results.find(r=>r.caseId===caseId && r.group===group && r.round===i+1);
    let status=response.status;
    if (response.status==='generated') {
      assert.equal(candidate(response.answer),response.code);
      assert.equal(sha(response.code),row.codeSha256);
      checkReport(row.publicReportId,response.code,problem.source.name,problem.publicTests,row.public.status);
      if (!i) assert.deepEqual(row.public,publicCheck.public);
      status=row.public.status;
      if (status==='passed') {
        const text=harnessSource(response.code,hidden.harness);
        checkReport(row.holdoutReportId,text,problem.source.name,[{id:'holdout',stdin:'',expectedStdout:hidden.expectedStdout}],row.holdoutStatus);
        status=row.holdoutStatus==='passed'?'passed':'holdout_failed';
      }
    } else {
      assert.equal(status,'invalid');
      if(response.finishReason==='stop') assert.throws(()=>candidate(response.answer));
    }
    assert.equal(status,row.status);
    if (!i) firstStatus=status;
    if (!i || response.status==='generated') finalStatus=status;
    const t=totals[group];t.calls++;t.inputTokens+=response.usage.prompt_tokens;t.outputTokens+=response.usage.completion_tokens;
    assert.equal(response.costUpperEstimateCNY,usageCost(response.usage));
    t.estimatedPeakCNY+=response.costUpperEstimateCNY;
  }
  totals[group].first+=Number(firstStatus==='passed');totals[group].final+=Number(finalStatus==='passed');
  cases.push({caseId,group,first:firstStatus,final:finalStatus});
}
assert.equal(used.size,reports.length);assert.equal(used.size,receipt.reports);
assert.equal(receipt.results.length,first.results.length+second.results.length);
assert.equal(second.results.length,initialPublic.results.filter(r=>r.status!=='passed').length);
console.log(JSON.stringify({reports:used.size,evidenceSha256:sealed.sha256,totals,cases},null,2));
