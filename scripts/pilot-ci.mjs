import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyPublic} from './sandbox-verify.mjs';
import {corpusSnapshot,validatedResult} from './retrieval.mjs';
import {runNative} from './native-bridge.mjs';
import {sha,SYSTEM,SETTINGS,SCOPE,verifyPack,summarize} from './pilot-common.mjs';
import {readHoldout,harnessSource} from './pilot-holdout.mjs';
const [phase,image,corePath]=process.argv.slice(2),root=process.cwd(),core=resolve(corePath||'target/debug/doctor');
if(process.platform!=='linux'||!/^sha256:[a-f0-9]{64}$/.test(image||''))throw Error('Linux immutable sandbox image required');
const dir='runs/pilot',save=async(name,value)=>writeFile(`${dir}/${name}.json`,JSON.stringify(value,null,2));
async function verify(source,tests){
 const report=await verifyPublic({source,tests},{root,image,core});
 if(report.status==='tool_error'||!report.containers.length||report.containers.some(c=>c.cleanup?.removed!==true))throw Error('Environment or cleanup failure; stop');
 return report;
}
if(phase==='prepare'){
 await mkdir('runs',{recursive:true});
 await mkdir(dir); // Never overwrite an earlier run.
 const raw=await readFile('data/experiments/pilot-catalog.json','utf8'),catalog=JSON.parse(raw),snapshot=await corpusSnapshot(root),holdout=await readHoldout();
 if(holdout.catalogSha256!==sha(raw))throw Error('Private tests belong to another catalog');
 const freeze={kind:'doctor-pilot-freeze',schemaVersion:1,scope:SCOPE,createdAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,image,sdkVersion:'1.0.5',catalogSha256:sha(raw),corpusSha256:snapshot.sha256,
  settings:SETTINGS,prompt:SYSTEM,maxCostCNY:20,priceCeiling:{inputPerMillion:2,outputPerMillion:8,source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',checkedAt:'2026-11-26'},
  rounds:1,holdoutUsed:true,holdoutSha256:holdout.sha256,humanReviewComplete:false,cases:[]};
 const referenceChecks=[];
 for(const c of catalog.cases){
  const source=c.source;if(sha(source.text)!==c.sourceSha256)throw Error('Source hash mismatch');
  const hidden=holdout.cases.find(h=>h.id===c.id);if(!hidden)throw Error('Private test missing');
  const referencePublic=await verify({name:source.name,text:hidden.reference},c.publicTests);
  const referenceHidden=await verify({name:source.name,text:harnessSource(hidden.reference,hidden.harness)},[{id:'holdout',stdin:'',expectedStdout:hidden.expectedStdout}]);
  if(referencePublic.status!=='passed'||referenceHidden.status!=='passed')throw Error('Reference validation failed: '+c.id+' '+JSON.stringify({public:referencePublic.status,hidden:referenceHidden.status,diagnostics:referenceHidden.compile.normalized?.diagnostics,detail:referenceHidden.detail}));
  referenceChecks.push({caseId:c.id,referenceSha256:sha(hidden.reference),publicStatus:referencePublic.status,holdoutStatus:referenceHidden.status,assertions:hidden.assertions});
  // Before generation publish only attestations, never reference code or hidden inputs.
  await save('reference-checks',referenceChecks);
  const initial=await verify(source,c.publicTests);await save(c.id+'-initial',initial);
  const expected={'compile-error':'compile_failed','fails-public-tests':'test_failed','passes-public-tests':'passed'}[c.initialExpectation];
  if(initial.status!==expected)throw Error('Initial expectation mismatch: '+c.id);
  if(expected==='test_failed' && !initial.tests.every(t=>['failed','passed'].includes(t.status)))throw Error('Unexpected initial runtime failure: '+c.id);
  if(c.category==='logic'){
   const mutant=await verify({name:source.name,text:harnessSource(source.text,hidden.harness)},[{id:'holdout',stdin:'',expectedStdout:hidden.expectedStdout}]);
   if(mutant.status!=='test_failed'||!mutant.tests.every(t=>['failed','passed'].includes(t.status)))throw Error('Holdout did not detect original logic defect: '+c.id);
   referenceChecks.at(-1).originalLogicDefectDetected=true;await save('reference-checks',referenceChecks);
  }
  const feedback={status:initial.status,diagnostics:initial.compile.normalized?.diagnostics??[],tests:initial.tests.map(t=>({id:t.id,status:t.status,stdout:t.process?.stdout??'',stderr:t.process?.stderr??''}))};
  let documents=[],retrieval=null;
  if(c.category!=='correct'){
   const query=(feedback.diagnostics.map(d=>`${d.code} ${d.message} ${d.hint}`).join('\n')||`${c.task}\n${JSON.stringify(feedback.tests)}`).slice(0,2000);
   await writeFile(`${dir}/query.json`,JSON.stringify({sdkVersion:'1.0.5',query,topK:3}));
   const r=await runNative(core,['retrieve','data/docs/cangjie-1.0.5.json',`${dir}/query.json`],{cwd:root,timeout:15000});
   if(r.code!==0||r.reason||r.stderr.trim())throw Error('Native retrieval failed');
   retrieval=validatedResult(JSON.parse(r.stdout),snapshot.corpus,query);documents=retrieval.results.map(({id,title,url,text})=>({id,title,url,text}));
  }
  freeze.cases.push({id:c.id,category:c.category,task:c.task,source,sourceSha256:c.sourceSha256,publicTests:c.publicTests,feedback,documents,retrieval});
 }
 if(freeze.cases.length!==20||freeze.cases.filter(c=>c.category!=='correct').length!==16)throw Error('Case counts changed');
 await save('freeze',freeze);console.log('Prepared all 20 cases; freeze '+sha(freeze));
}else if(phase==='evaluate'){
 const freeze=JSON.parse(await readFile(`${dir}/freeze.json`,'utf8'));if(freeze.image!==image)throw Error('Image changed');
 let pack;
 // Generation stays on the user PC. Poll only the explicitly published public pack.
 for(let attempt=0;attempt<120;attempt++){
  const r=await fetch('https://raw.githubusercontent.com/Frank72316/cangjie-code-doctor/main/data/experiments/pilot-candidates.json?poll='+Date.now(),{signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(r?.ok){const value=await r.json();if(value.freezeSha256===sha(freeze)){pack=value;break;}}
  await new Promise(r=>setTimeout(r,15000));
 }
 if(!pack)throw Error('No matching candidate pack; no execution');verifyPack(pack,freeze);await save('candidates',pack);
 const holdout=await readHoldout();if(holdout.sha256!==freeze.holdoutSha256)throw Error('Private tests changed');
 async function score(c,source,label){
  const r=await verify(source,c.publicTests);await save(label+'-public',r);
  let h={status:'not_run'};
  if(r.status==='passed'){
   const hidden=holdout.cases.find(h=>h.id===c.id);let text;
   try{text=harnessSource(source.text,hidden.harness);}catch{h={status:'harness_incompatible'};}
   if(text){h=await verify({name:source.name,text},[{id:'holdout',stdin:'',expectedStdout:hidden.expectedStdout}]);await save(label+'-holdout',h);}
  }
  return {status:r.status==='passed'?(h.status==='passed'?'passed':'holdout_failed'):r.status,publicStatus:r.status,holdoutStatus:h.status,compile:r.compile.status,tests:r.tests.map(t=>({id:t.id,status:t.status,stdout:t.process?.stdout})),reportId:r.id,holdoutReportId:h.id??null};
 }
 const rows=[];for(const c of freeze.cases){
  const row={caseId:c.id,category:c.category};
  if(c.category==='correct')row.regression=await score(c,c.source,c.id+'-regression');
  else for(const job of pack.results.filter(j=>j.caseId===c.id)){
   if(job.status!=='generated'){row[job.group]={status:job.status};continue;}
   row[job.group]={...await score(c,{name:c.id+'.cj',text:job.code},c.id+'-'+job.group),codeSha256:job.codeSha256};
  }
  rows.push(row);await save('results',{scope:SCOPE,freezeSha256:sha(freeze),rows,complete:false});
 }
 await save('results',{scope:SCOPE,freezeSha256:sha(freeze),finishedAt:new Date().toISOString(),rows,complete:true,summary:summarize(rows)});
 console.log(JSON.stringify(summarize(rows)));
}else throw Error('Unknown phase');
