import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkAIWorkflow} from '../scripts/check-ai-workflow.mjs';
import {compileView,sha256} from '../web/report.mjs';
const original=JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const corpus=JSON.parse(await readFile(new URL('../data/docs/cangjie-1.0.5.json',import.meta.url),'utf8'));
test('live acceptance needs explicit opt-in and an available core before any model request',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json({available:false});};
 await assert.rejects(checkAIWorkflow({fetcher}),/live-ai/);assert.equal(calls,0);
 const logs=[];await assert.rejects(checkAIWorkflow({live:true,fetcher,save:async s=>logs.push(structuredClone(s))}));
 assert.equal(calls,1);assert.equal(logs.at(-1).modelRequests,0);assert.equal(logs.at(-1).state,'failed');
});
test('live acceptance checks binding with synthetic HTTP and makes at most one model call on failure',async()=>{
 for(const mode of ['passed','provider-failure','changed-context']){
  const record=structuredClone(original),view=compileView(record);
  record.producer='cangjie-core';record.taskId='a'.repeat(32);
  record.normalized={status:view.status,parseState:view.parseState,detail:view.detail,exitCode:1,rawDiagnostics:record.compiler.stderr+record.compiler.stdout,testStatus:'not_run',diagnostics:view.diagnostics.map(({canLocate,...d})=>d)};
  const evidence={schemaVersion:1,sdkVersion:'1.0.5',snapshotId:corpus.snapshotId,sourceRevision:corpus.sourceRevision,algorithm:'bm25',parameters:{k1:1.2,b:0.75},query:'类型',effectiveQuery:'类型',queryExpansion:'compiler-glossary-v1',tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,results:[{...corpus.documents[0],score:1}],kind:'doctor-document-evidence',retrievalId:'b'.repeat(32),createdAt:new Date().toISOString(),sourceName:record.source.name,sourceSha256:record.source.sha256,recordSha256:await sha256(JSON.stringify(record)),compilerVersion:record.compiler.version,corpusSha256:'c'.repeat(64),queryOrigin:'manual'};
  const request={synthetic:true};
  const advice={id:'d'.repeat(32),usage:{total_tokens:10},returnedModel:'synthetic',truncated:false,requestSha256:await sha256(JSON.stringify(request)),retrievalId:evidence.retrievalId,compiled:false,executed:false,formalExperiment:false,answer:'合成检查回答'};
  let calls=0;const logs=[];
  const fetcher=async(url,options)=>{
   const path=new URL(url).pathname;
   assert.equal(new URL(url).origin,'http://127.0.0.1:8765');assert.equal(options.redirect,'error');
   if(path==='/api/health')return Response.json({available:true,token:'synthetic-token'});
   assert.equal(options.headers['X-Doctor-Token'],'synthetic-token');
   if(path==='/api/ai/status')return Response.json({configured:true,busy:false,used:0,limit:10});
   if(path==='/api/compile-example')return Response.json(record);
   if(path==='/api/retrieve')return Response.json(evidence);
   if(path==='/api/ai/explain'){calls++;assert.equal(JSON.parse(options.body).retrievalId,evidence.retrievalId);return mode==='provider-failure'?new Response('private-provider-error',{status:502}):Response.json(advice);}
   return Response.json({state:'completed',request,result:advice,context:{source:record.source,diagnostics:compileView(record).diagnostics,documents:mode==='changed-context'?[]:evidence.results.map(({id,title,url,text})=>({id,title,url,text}))}});
  };
  const operation=checkAIWorkflow({live:true,fetcher,save:async s=>logs.push(structuredClone(s))});
  if(mode==='passed')assert.equal((await operation).state,'passed');else await assert.rejects(operation);
  assert.equal(calls,1);assert.equal(logs.at(-1).state,mode==='passed'?'passed':'failed');
  assert.ok(!JSON.stringify(logs).includes('synthetic-token'));assert.equal(logs.at(-1).executed,false);
 }
});
