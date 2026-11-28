import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {read,transferPrivate,sealEvidence,dump,setting,transferOnlyStudy} from './api-evidence-common.mjs';
import {sha,candidate} from './pilot-common.mjs';
import {challengeCatalog,privateChallenge} from './challenge-data.mjs';
import {verifyPublic} from './sandbox-verify.mjs';
import {formalPublicSource} from './formal-public-harness.mjs';
import {harnessSource} from './pilot-holdout.mjs';

const [phase,image]=process.argv.slice(2);
assert.ok(process.platform==='linux' && ['materials','score'].includes(phase) && /^sha256:[a-f0-9]{64}$/.test(image));
const key=process.env.CHALLENGE_TEST_KEY; delete process.env.CHALLENGE_TEST_KEY;
const transfer=read('transfer'),newPrivate=transferPrivate(key),out='runs/api-evidence-'+phase;
fs.mkdirSync(out,{recursive:true});
const reports=[],receipt={phase,image,commit:process.env.GITHUB_SHA,startedAt:new Date().toISOString(),rows:[]};
async function check(problem,text,tests){
 const r=await verifyPublic({source:{name:problem.source.name,text},tests},{root:process.cwd(),image,core:resolve('target/debug/doctor')});
 if(r.status==='tool_error' || !r.containers.length || !r.containers.every(c=>c.cleanup?.removed)){
  // Preserve the interrupted check for local diagnosis. It cannot enter the scored receipt.
  dump(out+'/interrupted.enc.json',sealEvidence({commit:receipt.commit,phase,caseId:problem.id,finishedChecks:reports.length,report:r},key));
  throw Error('Verification interrupted for '+problem.id+'; diagnostic report sealed');
 }
 reports.push(r);return r;
}
const hiddenTests=h=>[{id:'holdout',stdin:'',expectedStdout:h.expectedStdout}];
if(phase==='materials'){
 receipt.transferSha256=sha(transfer);receipt.holdoutSha256=read('transfer.enc').sha256;
 for(const c of transfer){
  const h=newPrivate.find(x=>x.id===c.id);
  const initial=await check(c,c.source.text,c.publicTests);
  const ref=await check(c,h.reference,c.publicTests);
  const hidden=await check(c,harnessSource(h.reference,h.harness),hiddenTests(h));
  const bug=await check(c,harnessSource(c.source.text,h.harness),hiddenTests(h));
  receipt.rows.push({caseId:c.id,initial:{caseId:c.id,status:initial.status,diagnostics:initial.compile.normalized?.diagnostics??[],tests:initial.tests.map(t=>({id:t.id,status:t.status,stdout:t.process?.stdout??'',stderr:t.process?.stderr??''}))},initialId:initial.id,referencePublic:ref.status,referenceHoldout:hidden.status,originalHoldout:bug.status,assertions:h.assertions,reportIds:[initial.id,ref.id,hidden.id,bug.id]});
 }
 const starters=setting.generation==='api-review' ? read('starters') : null;
 receipt.accepted=receipt.rows.every((r,i)=>r.referencePublic==='passed' && r.referenceHoldout==='passed' &&
   (starters ? r.caseId===starters[i].id && r.initial.status===starters[i].publicStatus && ['compile_failed','test_failed','passed'].includes(r.originalHoldout)
    : r.initial.status==='test_failed' && r.originalHoldout==='test_failed'));
}else{
 const design=read('design'),pack=read('candidates'),snapshot=transferOnlyStudy?null:await challengeCatalog();
 assert.equal(sha(design),pack.designSha256);if(snapshot)assert.equal(snapshot.holdoutSha256,design.oldHoldoutSha256);
 assert.equal(read('transfer.enc').sha256,design.newHoldoutSha256);
 assert.ok(pack.finishedAt && pack.results.length===design.schedule.length);
 receipt.designSha256=sha(design);receipt.candidatesSha256=sha(pack);
 const hidden=[...newPrivate,...(snapshot?privateChallenge(snapshot,key).cases:[])];
 for(const [index,job] of design.schedule.entries()){
  const row=pack.results[index],t=design.cases.find(c=>c.id===job.caseId),c=[...transfer,...(snapshot?.catalog.cases??[])].find(x=>x.id===job.caseId);
  for(const k of ['caseId','repeat','group'])assert.equal(row[k],job[k]);
  assert.equal(row.requestSha256,t.hashes[job.group]);
  const r={...job,status:row.status};receipt.rows.push(r);
  if(row.status!=='generated'){assert.equal(row.status,'invalid');continue;}
  assert.equal(candidate(row.answer),row.code);assert.equal(sha(row.code),row.codeSha256);
  let pubCode;try{pubCode=formalPublicSource(row.code,c);}catch{r.status='harness_incompatible';continue;}
  const pub=await check(c,pubCode,c.publicTests);
  r.publicId=pub.id;r.publicStatus=pub.status;r.status=pub.status;
  if(pub.status==='passed'){
   const h=hidden.find(x=>x.id===c.id);
   const hreport=await check(c,harnessSource(row.code,h.harness),hiddenTests(h));
   r.holdoutId=hreport.id;r.holdoutStatus=hreport.status;r.status=hreport.status==='passed'?'passed':'holdout_failed';
  }
 }
}
receipt.finishedAt=new Date().toISOString();receipt.reports=reports.length;
dump(out+'/evidence.enc.json',sealEvidence(reports,key));dump(out+'/receipt.json',receipt);
console.log(JSON.stringify({phase,rows:receipt.rows.length,reports:reports.length,accepted:receipt.accepted}));
if(receipt.accepted===false)process.exitCode=1;
