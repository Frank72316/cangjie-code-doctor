import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {challengeCatalog} from './challenge-data.mjs';
import {challengeQuery,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {validatedResult} from './retrieval.mjs';
import {runNative} from './native-bridge.mjs';
import {sha,SYSTEM} from './pilot-common.mjs';
import {directory,read,dump} from './api-evidence-common.mjs';

const oldPath='docs/experiments/2026-11-26-challenge/offline-design.json';
const old=JSON.parse(await readFile(oldPath,'utf8'));
assert.equal(sha(old),'df4fa3ca51f197fcb298321e900fede9eafe2a612d70f48d88b21319712658f9');
const snapshot=await challengeCatalog(),gate=read('materials/receipt');
const newCases=read('transfer');
assert.ok(gate.accepted && gate.transferSha256===sha(newCases) && gate.holdoutSha256===read('transfer.enc').sha256);
const api=read('corpus'),apiPath=directory+'/corpus.json';
assert.equal(sha(await readFile(apiPath,'utf8')),read('sources').corpusSha256);
const originalPath='data/experiments/challenge-v1/corpus.json',original=JSON.parse(await readFile(originalPath,'utf8'));
const labels={
 api_rune_rotate:'structs-3284',api_frequency:'structs-3246',api_stable_unique:'collections-352',
 api_copy_filter:'collections-287',api_matrix_alias:'structs-45',api_parse_skip:'convert-775',
 api_optional_clamp:'enums-226',api_range_slice:'structs-97',new_odd_runes:'structs-3284',
 new_suffix_once:'structs-3121',new_limited_fields:'structs-3193',new_trim_set:'structs-3425'
};
const folder='tmp/api-evidence-queries';await mkdir(folder,{recursive:true});
async function retrieve(query,id,path,corpus){
 const file=folder+'/'+id+'.json';await writeFile(file,JSON.stringify({sdkVersion:'1.0.5',query,topK:3}));
 const result=await runNative(resolve('target/debug/doctor'+(process.platform==='win32'?'.exe':'')),['retrieve',path,file],{cwd:process.cwd(),timeout:20000});
 assert.ok(result.code===0&&!result.stderr.trim()&&!result.reason,'Native retrieval failed: '+id);
 return validatedResult(JSON.parse(result.stdout),corpus,query).results;
}
const present=({id,title,url,text})=>({id,title,url,text});
const prior=snapshot.catalog.cases.filter(c=>c.split==='evaluation'&&c.stratum==='language-api');
const ordered=prior.slice(0,4).flatMap((c,i)=>[c,newCases[i],prior[i+4]]);
const cases=[];
for(const c of ordered){
 const past=old.cases.find(x=>x.caseId===c.id);
 const initial=past?JSON.parse(past.requests.B.messages[1].content).initial:gate.rows.find(x=>x.caseId===c.id).initial;
 const query=challengeQuery(c,initial);
 if(past)assert.equal(query,past.query);
 const guides=await retrieve(query,c.id+'-guide',originalPath,original);
 if(past)assert.deepEqual(guides.map(present),JSON.parse(past.requests.B.messages[1].content).documents);
 assert.equal(guides.length,3);
 const ranks=await retrieve(query,c.id+'-api',apiPath,api);assert.ok(ranks.length);
 const direct=api.documents.find(x=>x.id===labels[c.id]);assert.ok(direct);
 const bytes=x=>Buffer.byteLength(x.text);
 const placebo=api.documents.filter(x=>x.title==='Duration').sort((a,b)=>Math.abs(bytes(a)-bytes(direct))-Math.abs(bytes(b)-bytes(direct))||a.id.localeCompare(b.id,'en'))[0];
 const last={R:guides[2],M:ranks[0],G:direct,P:placebo};
 const requests={},hashes={};
 for(const [group,third] of Object.entries(last)){
  const user={sdkVersion:'1.0.5',task:c.task,source:c.source,publicTests:c.publicTests,initial,documents:[...guides.slice(0,2),third].map(present)};
  requests[group]={...CHALLENGE_SETTINGS,messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(user)}]};
  hashes[group]=sha(requests[group]);
 }
 if(past)assert.equal(hashes.R,past.requestHashes.B);
 cases.push({id:c.id,panel:past?'prior':'transfer',query,gold:direct.id,apiRanks:ranks.map(x=>x.id),third:Object.fromEntries(Object.entries(last).map(([k,v])=>[k,v.id])),hashes,requests});
}
const orders=['RMPG','MGRP','GPMR','PRGM']; // Williams design: each directed adjacency occurs once.
const schedule=[];
for(let rep=0;rep<3;rep++)for(const [i,c] of cases.entries())for(const group of orders[(i+rep)%4])schedule.push({caseId:c.id,repeat:rep+1,group});
assert.equal(schedule.length,144);
const maxCNY=schedule.reduce((sum,j)=>{const body=cases.find(c=>c.id===j.caseId).requests[j.group];return sum+((Buffer.byteLength(JSON.stringify(body))+1024)*2+body.max_tokens*8)/1e6;},0);
assert.ok(maxCNY<8);
dump(directory+'/design.json',{model:CHALLENGE_SETTINGS.model,oldDesignSha256:sha(old),oldHoldoutSha256:snapshot.holdoutSha256,newHoldoutSha256:gate.holdoutSha256,materialReceiptSha256:sha(gate),apiCorpusSha256:read('sources').corpusSha256,priorCNY:1.876442,capCNY:8,maximumReservedCNY:maxCNY,cases,schedule});
console.log(JSON.stringify({tasks:cases.length,calls:schedule.length,maxCNY}));
