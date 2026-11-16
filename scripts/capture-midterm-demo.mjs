// Real public development case, never an AI experiment or a human trial.
// Candidate source is executed only by the existing Linux Docker service.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { NativeBridge } from './native-bridge.mjs';
import { RevisionStore } from './revision-store.mjs';
import { VerificationService } from './verification-service.mjs';
import { makeServer } from './preview.mjs';
import { readRecord, compileView } from '../web/report.mjs';
import { validateRevision } from '../web/revision.mjs';
import { revisionHTML } from '../web/revision-report.mjs';
import { validateVerificationRecord, verificationHTML } from '../web/verification.mjs';
import { readEvidenceReview, reviewHTML, reviewOutcome } from '../web/evidence-review.mjs';

const [binary, compiler, image] = process.argv.slice(2);
if (process.platform !== 'linux' || !binary || !compiler || !/^sha256:[a-f0-9]{64}$/.test(image || '')) {
  throw new Error('Usage on Linux: node scripts/capture-midterm-demo.mjs <doctor> <cjc> <immutable Docker image ID>');
}
const root=process.cwd();
const output=join(root,'runs','midterm-demo',randomUUID());
await mkdir(output,{recursive:true});
const receipt={kind:'doctor-midterm-development-demo',schemaVersion:1,status:'running',startedAt:new Date().toISOString(),
  platform:process.platform,sdkVersion:'1.0.5',commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),image,
  ciRunUrl:process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  provenance:'Actual Linux HTTP and Cangjie/Docker execution; scripted confirmation of a fixed developer-authored correction; not a student trial, AI repair, or A/B result.',
  steps:[],files:[]};
const save=async(name,value)=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';await writeFile(join(output,name),text,{flag:'wx'});receipt.files.push({name,sha256:createHash('sha256').update(text).digest('hex')});};
let server;
try {
  const bridge=new NativeBridge({root,executable:resolve(binary),compiler:resolve(compiler)});
  assert.equal((await bridge.probe()).available,true,bridge.health.detail);
  const revisionStore=new RevisionStore(root);
  const verificationService=new VerificationService({root,core:resolve(binary),image,bridge,revisionStore});
  assert.equal((await verificationService.probe()).available,true,verificationService.health.detail);
  server=makeServer({bridge,revisionStore,verificationService,workbenchTheme:'voxel'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,body)=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Doctor-Token':bridge.token,Origin:base},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});
    const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
  };
  const record=await readRecord(JSON.stringify(await request('/api/compile-example',{caseId:'type_mismatch'})));
  assert.equal(record.producer,'cangjie-core');
  assert.equal(compileView(record).status,'compile_failed');
  assert.equal(record.normalized.diagnostics[0].line,2);
  await save('01-diagnosis.json',record);
  receipt.steps.push({step:'compile-original',taskId:record.taskId,status:'compile_failed',line:2});
  const evidence=await request('/api/retrieve',{record});
  assert.ok(evidence.results.length>0);
  assert.equal(evidence.sourceSha256,record.source.sha256);
  await save('02-document-evidence.json',evidence);
  receipt.steps.push({step:'retrieve-official-documents',retrievalId:evidence.retrievalId,documentIds:evidence.results.map(hit=>hit.id)});
  assert.ok(record.source.text.includes('"three"'));
  const source={name:record.source.name,text:record.source.text.replace('"three"','3')};
  const revision=await validateRevision(await request('/api/revisions',{baseRecord:record,source,retrievalId:evidence.retrievalId,confirmed:true}));
  assert.equal(revision.compileStatus,'not_run');assert.equal(revision.testStatus,'not_run');
  assert.deepEqual(revision.documentEvidence,evidence);
  await save('03-revision.json',revision);
  await save('03-revision.html',revisionHTML(revision));
  receipt.steps.push({step:'save-scripted-developer-correction',revisionId:revision.revisionId,sourceSha256:revision.source.sha256});
  const verification=await request('/api/verifications',{revisionId:revision.revisionId,tests:[{id:'count',stdin:'',expectedStdout:'3\n'}],confirmed:true});
  await validateVerificationRecord(verification);
  assert.equal(verification.state,'completed');assert.equal(verification.report.status,'passed');
  assert.equal(verification.report.source.sha256,revision.source.sha256);
  assert.ok(verification.report.containers.every(c=>c.cleanup.removed));
  await save('04-verification.json',verification);
  await save('04-verification.html',verificationHTML(verification));
  const review=await readEvidenceReview(JSON.stringify(verification));
  assert.equal(review.entries.length,1);
  assert.equal(reviewOutcome(review.entries[0]).label,'公开测试通过');
  assert.deepEqual(review.entries[0].revision,revision);
  await save('05-workflow-review.html',reviewHTML(review.entries[0]));
  receipt.steps.push({step:'linux-container-public-test',verificationId:verification.verificationId,status:verification.report.status,containersRemoved:true});
  assert.deepEqual(await request('/api/revisions/'+revision.revisionId),revision);
  assert.deepEqual(await new RevisionStore(root).get(revision.revisionId),revision);
  assert.deepEqual(await request('/api/verifications/'+verification.verificationId),verification);
  const history=await request('/api/history');
  assert.ok(history.tasks.some(t=>t.taskId===record.taskId && t.state==='completed'));
  assert.equal(JSON.parse(await readFile(join(root,'runs/native',record.taskId,'record.json'),'utf8')).source.text,record.source.text);
  receipt.steps.push({step:'reread-records-and-original',status:'passed'});
  receipt.status='passed';
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  await save('index.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Doctor 中期演示 · 真实开发案例</title><style>body{font:16px/1.8 "Microsoft YaHei",sans-serif;background:#f5f3e9;color:#303b32;margin:0;padding:40px}main{max-width:1000px;margin:auto}h1{font-size:34px}small{color:#65735f}section{background:white;border:1px solid #ccd1c4;padding:24px;margin:20px 0;border-radius:8px}code{overflow-wrap:anywhere}a{color:#416b35}strong{color:#416b35}li{margin:12px 0}</style><main><small>DOCTOR · 中期答辩材料 / 历史运行回看</small><h1>一条类型错误，从诊断到验证</h1><p>本页展示真实 Linux 开发运行的记录，可在本机离线查看。它不是本机 Windows 的即时编译，也不是 AI 修复或正式 A/B 实验。</p><section><strong>真实流程已通过</strong><ol><li>编译原程序：第 2 行把字符串赋给整数，真实编译失败。</li><li>检索 SDK 1.0.5 官方文档，保留来源与摘要。</li><li>按固定开发示例将 <code>"three"</code> 改为 <code>3</code>，由脚本调用确认保存接口。</li><li>在受限 Linux 容器重新编译并运行公开测试，输出 <code>3\\n</code>，通过。</li><li>重新读取修订、验证与任务历史，确认原诊断未被改写。</li></ol></section><section><h2>查看证据</h2><p><a href="05-workflow-review.html">完整流程回看报告 →</a></p><p><a href="03-revision.html">修改差异与文档依据报告 →</a></p><p><a href="04-verification.html">公开测试与容器验证报告 →</a></p><p><a href="manifest.json">运行时间、提交版本与文件哈希 →</a></p><p>初始诊断 JSON、检索依据 JSON、修订 JSON 和验证 JSON 均在同一目录。</p></section><small>开始时间（UTC）：${esc(receipt.startedAt)}<br>提交：<code>${esc(receipt.commit)}</code><br>${receipt.ciRunUrl?`平台记录：<a href="${esc(receipt.ciRunUrl)}">本次 GitHub Actions</a>`:''}<br>本例是公开开发案例，不计入正式评估集；一个通过的测试不证明所有输入都正确。</small></main></html>`);
} catch(error) {
  receipt.status='failed';receipt.error=error.message;throw error;
} finally {
  receipt.finishedAt=new Date().toISOString();
  await writeFile(join(output,'manifest.json'),JSON.stringify(receipt,null,2)+'\n');
  if(server?.listening) await new Promise(r=>server.close(r));
  console.log(`Midterm development evidence: ${output} (${receipt.status})`);
}
