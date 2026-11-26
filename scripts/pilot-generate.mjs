import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadAIConfig} from './ai-service.mjs';
import {corpusSnapshot,validatedResult} from './retrieval.mjs';
import {sha,SYSTEM,SETTINGS,SCOPE,plan,messages,candidate,verifyPack} from './pilot-common.mjs';

// Noncached peak prices; bytes deliberately overestimate input tokens. Unknown
// usage keeps its reservation. This is an accounting ceiling, not a bill receipt.
export function reserveCost(body){return (Buffer.byteLength(JSON.stringify(body))+1024)*2/1e6+SETTINGS.max_tokens*8/1e6;}
export function usageCost(usage){
 if(!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0)return null;
 return (usage.prompt_tokens*2+usage.completion_tokens*8)/1e6;
}
export async function validateFreeze(freeze,root){
 if(freeze?.kind!=='doctor-pilot-freeze'||freeze.scope!==SCOPE||freeze.sdkVersion!=='1.0.5'||freeze.rounds!==1||freeze.holdoutUsed!==true||freeze.humanReviewComplete!==false||freeze.maxCostCNY!==20||sha(freeze.settings)!==sha(SETTINGS)||freeze.prompt!==SYSTEM||!/^sha256:[a-f0-9]{64}$/.test(freeze.image))throw Error('Unexpected experimental settings');
 const raw=await readFile(resolve(root,'data/experiments/pilot-catalog.json'),'utf8'),catalog=JSON.parse(raw),snapshot=await corpusSnapshot(root);
 if(sha(raw)!==freeze.catalogSha256||snapshot.sha256!==freeze.corpusSha256)throw Error('Frozen catalog/corpus changed');
 const cases=catalog.cases;
 const sealed=JSON.parse(await readFile(resolve(root,'data/experiments/pilot-holdout.enc.json'),'utf8'));
 if(sealed.sha256!==freeze.holdoutSha256)throw Error('Private test commitment changed');
 if(freeze.cases.length!==20||plan(freeze.cases).length!==32)throw Error('Unexpected case count');
 for(const [i,c] of cases.entries()){
  const f=freeze.cases[i];
  if(f.id!==c.id||f.category!==c.category||f.task!==c.task||sha(f.source.text)!==c.sourceSha256||f.sourceSha256!==c.sourceSha256||sha(f.publicTests)!==sha(c.publicTests))throw Error('Frozen case changed');
  if(c.category!=='correct'){
   validatedResult(f.retrieval,snapshot.corpus,f.retrieval.query);
   if(sha(f.documents)!==sha(f.retrieval.results.map(({id,title,url,text})=>({id,title,url,text}))))throw Error('Frozen evidence changed');
  }
 }
}
export async function generate(freeze,{key,folder,fetcher=fetch,maxCostCNY=20}){
 if(maxCostCNY>20||maxCostCNY<0)throw Error('Budget invalid');
 await mkdir(folder); // An interrupted batch is never silently rerun.
 const pack={kind:'doctor-pilot-candidates',scope:SCOPE,freezeSha256:sha(freeze),startedAt:new Date().toISOString(),settings:SETTINGS,maxCostCNY,results:[],reservedOrEstimatedCNY:0};
 const save=()=>writeFile(resolve(folder,'candidates.json'),JSON.stringify(pack,null,2));
 let stop=false;
 for(const j of plan(freeze.cases)){
  const c=freeze.cases.find(c=>c.id===j.caseId),body={...SETTINGS,messages:messages(c,j.group)},reservation=reserveCost(body);
  const r={...j,requestSha256:sha(body),status:'budget_stopped',startedAt:new Date().toISOString()};
  if(stop||pack.reservedOrEstimatedCNY+reservation>maxCostCNY){pack.results.push(r);await save();continue;}
  r.status='service_failed';r.reservationCNY=reservation;pack.reservedOrEstimatedCNY+=reservation;pack.results.push(r);await save();
  await writeFile(resolve(folder,`${j.caseId}-${j.group}-request.json`),JSON.stringify(body,null,2),{flag:'wx'});
  try{
   const response=await fetcher('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(body)});
   r.httpStatus=response.status;
   if(!response.ok)throw Error('Service response rejected');
   const data=await response.json();
   // Reject any accidental secret echo before persisting content.
   if(JSON.stringify(data).includes(key))throw Error('Secret echo rejected');
   r.responseModel=data.model;r.responseId=data.id;r.usage=data.usage;
   const cost=usageCost(data.usage);
   if(cost!==null){pack.reservedOrEstimatedCNY+=cost-reservation;r.estimatedPeakCNY=cost;if(cost>reservation)stop=true;}
   else stop=true;
   await writeFile(resolve(folder,`${j.caseId}-${j.group}-response.json`),JSON.stringify(data,null,2),{flag:'wx'});
   r.answer=data.choices?.[0]?.message?.content;r.finishReason=data.choices?.[0]?.finish_reason;r.status='invalid';
   if(r.finishReason==='stop'){
    try{r.code=candidate(r.answer);r.codeSha256=sha(r.code);r.status='generated';}catch{r.invalidReason='Response is not a complete bounded single-code JSON object';}
   }else r.invalidReason='Response did not finish normally';
  }catch{r.failure='Request failed; no automatic retry; possible charge covered by reservation';}
  r.finishedAt=new Date().toISOString();await save();
  console.log(`${pack.results.length}/32 ${j.caseId} ${j.group}: ${r.status}; peak-price estimate/reserve CNY ${pack.reservedOrEstimatedCNY.toFixed(6)}`);
 }
 pack.finishedAt=new Date().toISOString();verifyPack(pack,freeze);await save();return pack;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [flag,path,folder]=process.argv.slice(2);
 if(flag!=='--live'||!path||!folder)throw Error('Explicit --live <freeze.json> <new-output-directory> required');
 const root=process.cwd(),freeze=JSON.parse(await readFile(path,'utf8'));await validateFreeze(freeze,root);
 const config=await loadAIConfig(root);if(!config.ready)throw Error('Local official DeepSeek configuration unavailable');
 await generate(freeze,{key:config.key,folder:resolve(folder)});
}
