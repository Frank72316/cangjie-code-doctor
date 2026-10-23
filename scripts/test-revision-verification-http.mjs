// Real Linux HTTP -> saved revision -> Docker -> native verdict -> persisted report.
// All inputs are reviewed public development checks, never evaluation/held-out cases.
import assert from 'node:assert/strict';
import { readFile, appendFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NativeBridge } from './native-bridge.mjs';
import { RevisionStore } from './revision-store.mjs';
import { VerificationService } from './verification-service.mjs';
import { makeServer } from './preview.mjs';
import { validateVerificationRecord, verificationHTML } from '../web/verification.mjs';

const [image, binary] = process.argv.slice(2);
assert.ok(image && binary);
await mkdir('runs',{recursive:true});
const root=resolve(await mkdtemp('runs/http-public-verification-'));
const core=resolve(binary);
const bridge=new NativeBridge({root,executable:core,compiler:null});
const revisionStore=new RevisionStore(root);
const verificationService=new VerificationService({root,core,image,bridge,revisionStore});
assert.equal((await verificationService.probe()).available,true,verificationService.health.detail);
const server=makeServer({bridge,revisionStore,verificationService});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const headers={'Content-Type':'application/json','X-Doctor-Token':bridge.token};
const baseRecord=JSON.parse(await readFile('tests/fixtures/type_mismatch.json','utf8'));
const originalJSON=JSON.stringify(baseRecord);
const checks=[];
const request = (path,body,extra={}) => fetch(base+path,{method:body ? 'POST':'GET',headers,body:body ? JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000),...extra});
try {
  const health=await (await request('/api/health')).json();
  assert.equal(health.verification.available,true); assert.equal(health.token,bridge.token);
  // A native compiler path is not needed in this server: verification has its own
  // checked container compiler, while the existing sample compiler stays unavailable.
  assert.equal(health.available,false);
  const save=await request('/api/revisions',{baseRecord,source:{name:'type_mismatch.cj',text:baseRecord.source.text.replace('"three"','3')},confirmed:true});
  assert.equal(save.status,200);
  const revision=await save.json();
  const savedBefore=JSON.stringify(await revisionStore.get(revision.revisionId));
  const publicTest={id:'count',stdin:'',expectedStdout:'3\n'};
  assert.equal((await request('/api/verifications',{revisionId:revision.revisionId,tests:[publicTest],confirmed:true},{headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await request('/api/verifications',{revisionId:revision.revisionId,tests:[publicTest],confirmed:true,source:{text:'unreviewed'}})).status,400);
  assert.equal((await request('/api/verifications',{revisionId:revision.revisionId,tests:[publicTest],confirmed:true},{headers:{...headers,Origin:'https://example.invalid'}})).status,403);
  for (const [expected,status] of [['3\n','passed'],['4\n','test_failed']]) {
    const response=await request('/api/verifications',{revisionId:revision.revisionId,tests:[{...publicTest,expectedStdout:expected}],confirmed:true});
    const data=await response.json(); assert.equal(response.status,200,JSON.stringify(data));
    await validateVerificationRecord(data);
    assert.equal(data.state,'completed',JSON.stringify(data)); assert.equal(data.report.status,status);
    assert.equal(data.revision.revisionId,revision.revisionId); assert.equal(data.report.source.sha256,revision.source.sha256);
    assert.ok(data.report.containers.every(container=>container.cleanup.removed));
    const restored=await (await request('/api/verifications/'+data.verificationId)).json();
    assert.deepEqual(restored,data);
    assert.match(verificationHTML(data),/修改与公开测试报告/);
    assert.ok(verificationHTML(data).includes(revision.source.sha256));
    checks.push({verificationId:data.verificationId,revisionId:revision.revisionId,sourceSha256:revision.source.sha256,status,containersRemoved:true});
  }
  assert.equal(JSON.stringify(await revisionStore.get(revision.revisionId)),savedBefore,'Verification must not rewrite confirmed revision');
  assert.equal(JSON.stringify(baseRecord),originalJSON);
  const list=await (await request('/api/verifications')).json();
  assert.equal(list.verifications.length,2); assert.equal(list.unreadable,0);
  // A fresh service can read the persisted report without a configured execution image.
  const restarted=new VerificationService({root,revisionStore,core,bridge,platform:'win32'});
  assert.equal(restarted.health.available,false);
  const fromRestart=await restarted.get(checks[0].verificationId);
  assert.equal(fromRestart.report.status,'passed');
  assert.equal((await restarted.list()).verifications.length,2);
  const receipt={developmentOnly:true,scope:'two-public-http-checks-not-ab-or-student-trial',image,checkedAt:new Date().toISOString(),checks,
    snapshotUnchanged:true,restartRead:true,authorizationAndRawSourceRejection:true};
  console.log(JSON.stringify(receipt,null,2));
  if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## Saved revision HTTP verification\n\n```json\n'+JSON.stringify(receipt,null,2)+'\n```\n');
  console.log('PASS saved revision -> real container -> native public verdict -> HTTP report -> restart history; all containers removed');
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
