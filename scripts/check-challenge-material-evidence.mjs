import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDecipheriv} from 'node:crypto';
import {challengeCatalog,privateChallenge} from './challenge-data.mjs';
import {harnessSource} from './pilot-holdout.mjs';
import {sha} from './pilot-common.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';
const folder=process.argv[2];if(!folder)throw Error('Pass a material artifact directory; private key must remain in data/holdout/challenge-v1/key.txt');
const snapshot=await challengeCatalog(),key=(await readFile('data/holdout/challenge-v1/key.txt','utf8')).trim(),privateData=privateChallenge(snapshot,key);
const receipt=JSON.parse(await readFile(folder+'/receipt.json','utf8')),e=JSON.parse(await readFile(folder+'/evidence.enc.json','utf8'));
assert.equal(receipt.catalogSha256,snapshot.catalogSha256);assert.equal(receipt.holdoutSha256,snapshot.holdoutSha256);assert.equal(receipt.accepted,true);
assert.equal(receipt.results.length,30);assert.equal(new Set(receipt.results.map(r=>r.caseId)).size,30);
const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(e.iv,'hex'));d.setAuthTag(Buffer.from(e.tag,'hex'));
const raw=Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString('utf8');assert.equal(sha(raw),e.sha256);
const reports=JSON.parse(raw);assert.equal(reports.length,150);const verdicts={};
for(const c of snapshot.catalog.cases){
 const h=privateData.cases.find(x=>x.id===c.id),tests=[{id:'holdout',stdin:'',expectedStdout:h.expectedStdout}],row=receipt.results.find(r=>r.caseId===c.id);
 assert.equal(row.accepted,true);assert.equal(row.referencePublic,'passed');assert.equal(row.referenceHoldout,'passed');assert.notEqual(row.initial,'passed');assert.equal(row.mutants.length,2);assert.ok(row.mutants.every(m=>m.killed&&m.status!=='passed'));
 const jobs=[['reference-public',h.reference,c.publicTests,row.referencePublic],['reference-holdout',harnessSource(h.reference,h.harness),tests,row.referenceHoldout],['initial',c.source.text,c.publicTests,row.initial],...h.mutants.map(m=>[m.id,harnessSource(m.source,h.harness),tests,row.mutants.find(x=>x.id===m.id).status])];
 for(const [label,text,checks,status] of jobs){
  const found=reports.filter(x=>x.caseId===c.id&&x.label===label);assert.equal(found.length,1);
  const r=found[0].report;assert.equal(r.source.text,text);assert.equal(r.source.sha256,sha(text));assert.equal(r.requestSha256,sha(verificationRequestText({name:c.source.name,text},checks)));
  assert.equal(r.status,status);assert.equal(r.image,receipt.image);assert.equal(r.sdkVersion,'1.0.5');assert.notEqual(r.status,'tool_error');assert.ok(r.containers.length>0&&r.containers.every(c=>c.cleanup.removed));
  verdicts[r.status]=(verdicts[r.status]||0)+1;
 }
}
const result={kind:'doctor-challenge-evidence-crosscheck',createdAt:new Date().toISOString(),reports:reports.length,catalogSha256:snapshot.catalogSha256,holdoutSha256:snapshot.holdoutSha256,evidenceSha256:e.sha256,verdicts,sourceAndTestRequestHashesMatched:true,containerCleanupConfirmed:true,modelCalls:0};
await writeFile(folder+'/crosscheck.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
