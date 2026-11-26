// Opt-in development acceptance: one paid call, no generated code execution.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {readRecord,compileView,sha256} from '../web/report.mjs';
import {validateDocumentEvidence} from '../web/document-evidence.mjs';

export async function checkAIWorkflow({live=false,fetcher=fetch,save=async()=>{}}={}){
  if(!live)throw Error('此检查会调用一次收费模型；须显式传入 --live-ai。');
  const summary={schemaVersion:1,kind:'doctor-ai-development-check',id:randomBytes(16).toString('hex'),startedAt:new Date().toISOString(),
    state:'started',modelRequests:0,caseId:'type_mismatch',executed:false,formalExperiment:false};
  await save(summary);
  let token;
  async function request(path,body){
    const r=await fetcher(`http://127.0.0.1:8765${path}`,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(90000),
      headers:{...(token?{'X-Doctor-Token':token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok)throw Error(`本地接口 ${path.split('/').slice(0,4).join('/')} 返回 HTTP ${r.status}，未自动重试。`);
    return r.json();
  }
  try{
    const health=await request('/api/health');assert.equal(health.available,true,'仓颉核心未就绪');assert.ok(health.token);token=health.token;
    const status=await request('/api/ai/status');assert.equal(status.configured,true,'AI 未配置');assert.equal(status.busy,false,'AI 正忙');assert.ok(status.used<status.limit,'调用次数已达上限');
    const record=await readRecord(JSON.stringify(await request('/api/compile-example',{caseId:summary.caseId})));
    assert.equal(record.producer,'cangjie-core');assert.equal(record.source.name,'type_mismatch.cj');
    assert.equal(record.compiler.exitCode,1);assert.ok(compileView(record).diagnostics.some(d=>d.code==='sema_mismatched_types'));
    summary.taskId=record.taskId;summary.sourceSha256=record.source.sha256;
    const evidence=await request('/api/retrieve',{record,query:''});await validateDocumentEvidence(evidence,record);
    assert.ok(evidence.results.length>0,'没有文档命中，不发出收费请求');summary.retrievalId=evidence.retrievalId;
    summary.documentIds=evidence.results.map(d=>d.id);summary.state='requesting';summary.modelRequests=1;await save(summary);
    const advice=await request('/api/ai/explain',{record,retrievalId:evidence.retrievalId,confirmed:true});
    summary.adviceId=advice.id;summary.usage=advice.usage;summary.returnedModel=advice.returnedModel;summary.truncated=advice.truncated;await save(summary);
    const archive=await request(`/api/ai/history/${advice.id}`);
    assert.equal(archive.state,'completed');assert.deepEqual(archive.result,advice);assert.deepEqual(archive.context.source,record.source);
    assert.deepEqual(archive.context.diagnostics,compileView(record).diagnostics);
    assert.deepEqual(archive.context.documents,evidence.results.map(({id,title,url,text})=>({id,title,url,text})));
    assert.equal(advice.requestSha256,await sha256(JSON.stringify(archive.request)));
    assert.equal(advice.retrievalId,evidence.retrievalId);assert.equal(advice.compiled,false);assert.equal(advice.executed,false);assert.equal(advice.formalExperiment,false);
    assert.ok(typeof advice.answer==='string'&&advice.answer.trim());
    summary.state='passed';summary.note='已核对接口与归档关联；未判定建议正确性、未执行候选、不是 A/B 成绩。';
  }catch(e){summary.state='failed';summary.note='验收未完成；若已进入模型请求阶段，可能计费。请检查本机记录，不要自动重跑。';throw e;}
  finally{summary.finishedAt=new Date().toISOString();await save(summary);}
  return summary;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.slice(2).join(' ')!=='--live-ai'){console.error('用法：node scripts/check-ai-workflow.mjs --live-ai（最多一次收费请求，无重试）');process.exitCode=2;}
  else{
    await mkdir('tmp',{recursive:true});
    try{console.log(JSON.stringify(await checkAIWorkflow({live:true,save:s=>writeFile(`tmp/ai-workflow-${s.id}.json`,JSON.stringify(s,null,2))})));}
    catch{console.error('真实链路验收未完成；请查看 tmp/ai-workflow-*.json 及工作台归档。没有自动重试。');process.exitCode=1;}
  }
}
