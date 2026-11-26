import {mkdir,writeFile,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {read,directory,dump} from './api-evidence-common.mjs';
import {loadAIConfig} from './ai-service.mjs';
import {usageCost} from './pilot-generate.mjs';
import {sha,candidate} from './pilot-common.mjs';

const design=read('design');
const locked=JSON.parse(execFileSync('git',['show','HEAD:'+directory+'/design.json'],{encoding:'utf8',maxBuffer:4*1024*1024}));
assert.equal(sha(locked),sha(design));assert.equal(design.schedule.length,144);
assert.ok(design.priorCNY+design.capCNY+1<=20 && design.capCNY<=8);
const jobs=design.schedule.map(job=>{
 const c=design.cases.find(c=>c.id===job.caseId),body=c.requests[job.group];
 assert.equal(sha(body),c.hashes[job.group]);assert.equal(body.model,'deepseek-flash');
 const reserve=((Buffer.byteLength(JSON.stringify(body))+1024)*2+body.max_tokens*8)/1e6;
 return {job,body,reserve};
});
const max=jobs.reduce((s,j)=>s+j.reserve,0);assert.equal(max,design.maximumReservedCNY);assert.ok(max<=design.capCNY);
console.log(JSON.stringify({requests:jobs.length,reservedCNY:max}));
if(!process.argv.includes('--live'))process.exit(0);
const {key,ready}=await loadAIConfig(process.cwd());assert.ok(ready);
const folder='runs/api-evidence-generation';
await mkdir(folder); // Do not accidentally replay paid conditions after an interruption.
const pack={designSha256:sha(design),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),results:[]};
async function checkpoint(){await writeFile(folder+'/pending.json',JSON.stringify(pack));await rename(folder+'/pending.json',folder+'/checkpoint.json');}
for(const {job,body,reserve} of jobs){
 const row={...job,requestSha256:sha(body),startedAt:new Date().toISOString(),status:'pending',costCNY:reserve};
 pack.results.push(row);await checkpoint();
 try{
  const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(body)});
  row.httpStatus=r.status;assert.ok(r.ok);
  const data=await r.json();assert.ok(!JSON.stringify(data).includes(key));assert.equal(data.model,body.model);
  const cost=usageCost(data.usage);assert.ok(cost!==null && cost<=reserve);
  Object.assign(row,{costCNY:cost,status:'invalid',model:data.model,responseId:data.id,usage:data.usage,finishReason:data.choices[0].finish_reason,answer:data.choices[0].message.content});
  if(row.finishReason==='stop'){
   try{row.code=candidate(row.answer);row.codeSha256=sha(row.code);row.status='generated';}catch{}
  }
 }catch{row.status='service_failed';}
 row.finishedAt=new Date().toISOString();await checkpoint();
 if(row.status==='service_failed')throw Error('Stopped on service/metering failure; reservation retained');
 if(pack.results.length%12===0)console.log('Completed',pack.results.length,'of',jobs.length);
}
pack.finishedAt=new Date().toISOString();await checkpoint();
dump(directory+'/candidates.json',pack);
console.log(JSON.stringify({valid:pack.results.filter(r=>r.status==='generated').length,costCNY:pack.results.reduce((s,r)=>s+r.costCNY,0)}));
