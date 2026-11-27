// Targeted post-generation stress check, separate from the frozen primary metric.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {read,dump,rankingStudy,transferPrivate,unseal,sealEvidence} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {harnessSource} from './pilot-holdout.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';
import {verifyPublic} from './sandbox-verify.mjs';
assert.ok(rankingStudy);
const audit=process.argv.includes('--audit');
const key=audit?fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim():process.env.CHALLENGE_TEST_KEY;
delete process.env.CHALLENGE_TEST_KEY;
const sealed=read('unicode-probe.enc'),probe=unseal(sealed,key),pack=read('candidates');
const locked=read('transfer').find(c=>c.id===probe.caseId),hidden=transferPrivate(key).find(c=>c.id===probe.caseId);
const cases=[{id:'reference',code:hidden.reference},...pack.results.filter(r=>r.caseId===probe.caseId).map(r=>({id:r.group+r.repeat,code:r.code}))];
assert.equal(cases.length,7);
const tests=[{id:'supplement',stdin:'',expectedStdout:probe.expectedStdout}];
const folder='runs/api-evidence-score';
const receipt=audit?read('score/probe'):{image:process.argv[2],candidatesSha256:sha(pack),probeSha256:sealed.sha256,rows:[]};
const reports=audit?unseal(read('score/probe-evidence.enc'),key):[];
assert.equal(receipt.candidatesSha256,sha(pack));assert.equal(receipt.probeSha256,sealed.sha256);
if(audit){assert.equal(receipt.rows.length,7);assert.equal(reports.length,7);assert.equal(receipt.image,read('score/receipt').image);}
const seen=new Set();
for(const [i,c] of cases.entries()){
  const source={name:locked.source.name,text:harnessSource(c.code,probe.harness)};
  const report=audit?reports[i]:await verifyPublic({source,tests},{root:process.cwd(),image:receipt.image,core:resolve('target/debug/doctor')});
  assert.equal(report.image,receipt.image);assert.equal(report.sdkVersion,'1.0.5');
  assert.equal(report.source.sha256,sha(source.text));assert.equal(report.requestSha256,sha(verificationRequestText(source,tests)));
  assert.ok(report.containers.length && report.containers.every(x=>x.cleanup?.removed));
  assert.notEqual(report.status,'tool_error');assert.ok(!seen.has(report.id));seen.add(report.id);
  const stdout=report.tests[0]?.process?.stdout??'';
  const lines=stdout.trim().split('\n');
  const passedAssertions=(lines.length===probe.pairs.length && lines.every(x=>x==='true'||x==='false')) ? lines.filter(x=>x==='true').length : null;
  const row={id:c.id,sourceSha256:sha(c.code),reportId:report.id,status:report.status,passedAssertions,total:probe.pairs.length};
  if(audit)assert.deepEqual(row,receipt.rows[i]);else{reports.push(report);receipt.rows.push(row);}
}
if(!audit){
  dump(folder+'/probe-evidence.enc.json',sealEvidence(reports,key));
  dump(folder+'/probe.json',receipt);
}
assert.equal(receipt.rows[0].status,'passed');assert.equal(receipt.rows[0].passedAssertions,probe.pairs.length);
console.log(JSON.stringify(receipt.rows.map(({id,status,passedAssertions})=>({id,status,passedAssertions}))));
