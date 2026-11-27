import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read,unseal,transferPrivate,transferOnlyStudy,conditionCount} from './api-evidence-common.mjs';
import {challengeCatalog,privateChallenge} from './challenge-data.mjs';
import {sha,candidate} from './pilot-common.mjs';
import {usageCost} from './pilot-generate.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';
import {formalPublicSource} from './formal-public-harness.mjs';
import {harnessSource} from './pilot-holdout.mjs';

const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const fresh=read('transfer'),newPrivate=transferPrivate(key);
const hiddenTests=h=>[{id:'holdout',stdin:'',expectedStdout:h.expectedStdout}];
function evidence(phase){
 const receipt=read(phase+'/receipt'),raw=unseal(read(phase+'/evidence.enc'),key);
 assert.equal(receipt.phase,phase);assert.equal(raw.length,receipt.reports);
 const reports=new Map(raw.map(r=>[r.id,r]));assert.equal(reports.size,raw.length);
 function take(id,name,source,tests){
  const r=reports.get(id);assert.ok(r);reports.delete(id);
  assert.equal(r.image,receipt.image);assert.equal(r.sdkVersion,'1.0.5');assert.notEqual(r.status,'tool_error');
  assert.equal(r.source.sha256,sha(source));assert.equal(r.source.text,source);
  assert.equal(r.requestSha256,sha(verificationRequestText({name,text:source},tests)));
  assert.ok(r.containers.length && r.containers.every(c=>c.cleanup?.removed));return r;
 }
 return {receipt,take,finish:()=>assert.equal(reports.size,0)};
}
const materials=evidence('materials');
assert.equal(materials.receipt.transferSha256,sha(fresh));assert.equal(materials.receipt.holdoutSha256,read('transfer.enc').sha256);
for(const [i,c] of fresh.entries()){
 const h=newPrivate.find(x=>x.id===c.id),row=materials.receipt.rows[i];assert.equal(row.caseId,c.id);
 const checks=[[c.source.text,c.publicTests,'test_failed'],[h.reference,c.publicTests,'passed'],[harnessSource(h.reference,h.harness),hiddenTests(h),'passed'],[harnessSource(c.source.text,h.harness),hiddenTests(h),'test_failed']];
 for(const [j,[src,tests,status]] of checks.entries()){const r=materials.take(row.reportIds[j],c.source.name,src,tests);assert.equal(r.status,status);
  if(j===0)assert.deepEqual(row.initial,{caseId:c.id,status:r.status,diagnostics:r.compile.normalized?.diagnostics??[],tests:r.tests.map(t=>({id:t.id,status:t.status,stdout:t.process?.stdout??'',stderr:t.process?.stderr??''}))});
 }
}
materials.finish();
if(process.argv.includes('--materials')){console.log('Verified '+materials.receipt.reports+' material reports');process.exit(0);}
const design=read('design'),pack=read('candidates'),scoring=evidence('score'),receipt=scoring.receipt;
const snapshot=transferOnlyStudy?null:await challengeCatalog(),oldPrivate=snapshot?privateChallenge(snapshot,key).cases:[];
assert.equal(sha(materials.receipt),design.materialReceiptSha256);assert.equal(sha(design),pack.designSha256);
assert.equal(receipt.candidatesSha256,sha(pack));assert.equal(receipt.designSha256,sha(design));
if(snapshot)assert.equal(snapshot.holdoutSha256,design.oldHoldoutSha256);assert.equal(read('transfer.enc').sha256,design.newHoldoutSha256);
assert.equal(pack.results.length,conditionCount);assert.equal(receipt.rows.length,conditionCount);
const review=read('review');assert.equal(review.packSha256,sha(pack));
const approved=new Set(review.acceptedBodyHashes);const seen=new Set(),ids=new Set(),rows=[];
for(const [i,j] of design.schedule.entries()){
 const d=design.cases.find(c=>c.id===j.caseId),p=pack.results[i],r=receipt.rows[i],c=[...fresh,...(snapshot?.catalog.cases??[])].find(c=>c.id===j.caseId);
 for(const k of ['caseId','group','repeat']){assert.equal(p[k],j[k]);assert.equal(r[k],j[k]);}
 assert.equal(p.requestSha256,sha(d.requests[j.group]));assert.equal(d.hashes[j.group],p.requestSha256);
 assert.equal(p.costCNY,usageCost(p.usage));assert.equal(p.model,design.model);assert.equal(p.httpStatus,200);
 assert.ok(p.responseId&&!ids.has(p.responseId));ids.add(p.responseId);
 let status=p.status;
 if(status==='generated'){
  assert.equal(candidate(p.answer),p.code);assert.equal(sha(p.code),p.codeSha256);
  const bodyHash=sha(p.code);seen.add(bodyHash);
  let source;try{source=formalPublicSource(p.code,c);}catch{status='harness_incompatible';}
  if(source){
   const pub=scoring.take(r.publicId,c.source.name,source,c.publicTests);
   assert.equal(pub.status,r.publicStatus);status=pub.status;
   if(status==='passed'){
    const h=[...newPrivate,...oldPrivate].find(x=>x.id===c.id);
    const hr=scoring.take(r.holdoutId,c.source.name,harnessSource(p.code,h.harness),hiddenTests(h));
    assert.equal(hr.status,r.holdoutStatus);status=hr.status==='passed'?'passed':'holdout_failed';
   }else assert.ok(!r.holdoutId);
  }
 }else{assert.equal(status,'invalid');if(p.finishReason==='stop')assert.throws(()=>candidate(p.answer));}
 assert.equal(r.status,status);
 if(status==='passed'&&!approved.has(p.codeSha256))status='contract_rejected';
 rows.push({...j,status,costCNY:p.costCNY,input:p.usage.prompt_tokens,output:p.usage.completion_tokens});
}
scoring.finish();
assert.deepEqual(new Set([...review.acceptedBodyHashes,...review.rejectedBodyHashes]),seen);
assert.equal(review.acceptedBodyHashes.length+review.rejectedBodyHashes.length,seen.size);
console.log(JSON.stringify({materialReports:materials.receipt.reports,scoreReports:receipt.reports,rows},null,2));
