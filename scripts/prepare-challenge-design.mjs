// Offline only: compile feedback + Cangjie BM25 + deterministic request schedule.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {challengeCatalog} from './challenge-data.mjs';
import {challengeCorpus,challengeSchedule,challengeQuery,challengeMessages,CHALLENGE_SETTINGS} from './challenge-design.mjs';
import {validatedResult} from './retrieval.mjs';
import {runNative} from './native-bridge.mjs';
import {sha} from './pilot-common.mjs';
const [feedbackPath,receiptPath,output]=process.argv.slice(2);if(!feedbackPath||!receiptPath||!output)throw Error('Pass public initial-feedback.json, validated receipt.json and new output directory');
const snapshot=await challengeCatalog(),docs=await challengeCorpus(),receipt=JSON.parse(await readFile(receiptPath,'utf8')),feedback=JSON.parse(await readFile(feedbackPath,'utf8'));
if(!receipt.accepted||receipt.catalogSha256!==snapshot.catalogSha256||receipt.holdoutSha256!==snapshot.holdoutSha256||receipt.results.length!==30||receipt.results.some(r=>!r.accepted))throw Error('Material validation gate not passed');
await mkdir(output);const core=resolve(process.env.DOCTOR_CORE||('target/debug/doctor'+(process.platform==='win32'?'.exe':''))),prepared=[];
for(const c of snapshot.catalog.cases){
 const f=feedback.find(f=>f.caseId===c.id);if(!f)throw Error('Initial feedback missing');
 const query=challengeQuery(c,f),queryPath=resolve(output,c.id+'-query.json');await writeFile(queryPath,JSON.stringify({sdkVersion:'1.0.5',query,topK:3}));
 const p=await runNative(core,['retrieve','data/experiments/challenge-v1/corpus.json',queryPath],{cwd:process.cwd(),timeout:15000});if(p.code!==0||p.reason||p.stderr.trim())throw Error('Native BM25 unavailable');
 const retrieval=validatedResult(JSON.parse(p.stdout),docs.corpus,query),requests={};for(const group of ['A','B','C'])requests[group]={...CHALLENGE_SETTINGS,messages:challengeMessages(c,f,group,retrieval,docs.corpus)};
 const chapters=retrieval.results.map(d=>docs.manifest.excerpts.find(e=>e.id===d.id).sourcePath);
 prepared.push({caseId:c.id,split:c.split,stratum:c.stratum,query,retrieval,topicChapterHit:chapters.some(p=>c.docTopics.some(t=>p.includes(t))),requests,requestHashes:Object.fromEntries(Object.entries(requests).map(([g,r])=>[g,sha(r)]))});
}
const design={kind:'doctor-challenge-offline-design',createdAt:new Date().toISOString(),catalogSha256:snapshot.catalogSha256,holdoutSha256:snapshot.holdoutSha256,corpusSha256:docs.sha256,materialReceiptSha256:sha(receipt),modelCalls:0,difficultyCalibrated:false,readyForFormalModelRun:false,settings:CHALLENGE_SETTINGS,development:challengeSchedule(snapshot.catalog.cases,'development',1),evaluation:challengeSchedule(snapshot.catalog.cases),cases:prepared};
await writeFile(resolve(output,'design.json'),JSON.stringify(design,null,2));
console.log(JSON.stringify({cases:prepared.length,developmentConditions:design.development.length,evaluationConditions:design.evaluation.length,maxEvaluationCalls:design.evaluation.length*2,topicChapterHits:prepared.filter(c=>c.topicChapterHit).length,modelCalls:0,readyForFormalModelRun:false}));
