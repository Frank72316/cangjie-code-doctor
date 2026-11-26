import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createCipheriv,randomBytes} from 'node:crypto';
import {challengeCatalog,privateChallenge} from './challenge-data.mjs';
import {verifyPublic} from './sandbox-verify.mjs';
import {harnessSource} from './pilot-holdout.mjs';
import {sha} from './pilot-common.mjs';
const [image,binary]=process.argv.slice(2),root=process.cwd();
if(process.platform!=='linux'||!/^sha256:[a-f0-9]{64}$/.test(image||''))throw Error('Linux immutable image required');
const snapshot=await challengeCatalog(root),key=process.env.CHALLENGE_TEST_KEY,privateData=privateChallenge(snapshot,key),folder='runs/challenge-materials';
await mkdir('runs',{recursive:true});await mkdir(folder);
const receipt={kind:'doctor-challenge-materials-validation',createdAt:new Date().toISOString(),commit:process.env.GITHUB_SHA,image,catalogSha256:snapshot.catalogSha256,holdoutSha256:snapshot.holdoutSha256,modelCalls:0,modelDifficultyCalibrated:false,results:[]};
const evidence=[],initialFeedback=[];
async function save(){
 await writeFile(folder+'/receipt.json',JSON.stringify(receipt,null,2));await writeFile(folder+'/initial-feedback.json',JSON.stringify(initialFeedback,null,2));
 const raw=JSON.stringify(evidence),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv),data=Buffer.concat([cipher.update(raw),cipher.final()]);
 await writeFile(folder+'/evidence.enc.json',JSON.stringify({algorithm:'AES-256-GCM',sha256:sha(raw),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('base64')}));
}
async function verify(c,label,text,tests){
 const r=await verifyPublic({source:{name:c.source.name,text},tests},{root,image,core:resolve(binary)});evidence.push({caseId:c.id,label,report:r});
 if(r.status==='tool_error'||!r.containers.length||r.containers.some(x=>!x.cleanup?.removed)){await save();throw Error('Environment/cleanup failure at '+c.id+' '+label);}
 return r;
}
for(const c of snapshot.catalog.cases){
 const h=privateData.cases.find(x=>x.id===c.id),hiddenTests=[{id:'holdout',stdin:'',expectedStdout:h.expectedStdout}],r={caseId:c.id,split:c.split,stratum:c.stratum,assertions:h.assertions,referenceSha256:sha(h.reference),mutants:[]};receipt.results.push(r);
 const pub=await verify(c,'reference-public',h.reference,c.publicTests);r.referencePublic=pub.status;
 const hold=await verify(c,'reference-holdout',harnessSource(h.reference,h.harness),hiddenTests);r.referenceHoldout=hold.status;
 const initial=await verify(c,'initial',c.source.text,c.publicTests);r.initial=initial.status;
 initialFeedback.push({caseId:c.id,status:initial.status,diagnostics:initial.compile.normalized?.diagnostics??[],tests:initial.tests.map(t=>({id:t.id,status:t.status,stdout:t.process?.stdout??'',stderr:t.process?.stderr??''}))});
 for(const m of h.mutants){const result=await verify(c,m.id,harnessSource(m.source,h.harness),hiddenTests);r.mutants.push({id:m.id,sourceSha256:sha(m.source),status:result.status,killed:result.status!=='passed'});}
 r.accepted=r.referencePublic==='passed'&&r.referenceHoldout==='passed'&&r.initial!=='passed'&&r.mutants.every(m=>m.killed);
 await save();console.log(JSON.stringify(r));
}
receipt.finishedAt=new Date().toISOString();receipt.accepted=receipt.results.every(r=>r.accepted);await save();
if(!receipt.accepted)process.exitCode=1;
