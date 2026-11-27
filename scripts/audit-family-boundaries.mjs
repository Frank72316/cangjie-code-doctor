import assert from 'node:assert/strict';
import fs from 'node:fs';
import {read,unseal,transferPrivate,familyStudy} from './api-evidence-common.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';
import {harnessSource} from './pilot-holdout.mjs';
import {sha} from './pilot-common.mjs';

assert.ok(familyStudy);
const key=fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim();
const oldEnc=read('first-material-check/transfer.enc'), old=unseal(oldEnc,key), fresh=transferPrivate(key), tasks=read('transfer');
const first=read('first-material-check/materials/receipt');
assert.equal(old.sourceSha256,sha(tasks));
assert.equal(first.transferSha256,sha(tasks));assert.equal(first.holdoutSha256,oldEnc.sha256);
const logs=unseal(read('first-material-check/materials/evidence.enc'),key);
const records=new Map(logs.map(r=>[r.id,r]));
assert.equal(records.size,48);
const changes=[];
for(const [i,problem] of tasks.entries()){
  const row=first.rows[i],before=old.cases[i],after=fresh[i];
  assert.equal(row.caseId,problem.id);assert.equal(before.id,problem.id);assert.equal(after.id,problem.id);
  const {reference:prev,...oldTests}=before, {reference:next,...newTests}=after;
  assert.deepEqual(newTests,oldTests);
  const hidden=[{id:'holdout',stdin:'',expectedStdout:before.expectedStdout}];
  const sources=[problem.source.text,prev,harnessSource(prev,before.harness),harnessSource(problem.source.text,before.harness)];
  const states=[row.initial.status,row.referencePublic,row.referenceHoldout,row.originalHoldout];
  for(const [j,id] of row.reportIds.entries()){
    const r=records.get(id);records.delete(id);
    assert.equal(r.source.sha256,sha(sources[j]));assert.equal(r.source.text,sources[j]);assert.equal(r.status,states[j]);
    assert.equal(r.requestSha256,sha(verificationRequestText({name:problem.source.name,text:sources[j]},j<2?problem.publicTests:hidden)));
    assert.equal(r.image,first.image);assert.equal(r.sdkVersion,'1.0.5');
    assert.ok(r.containers.length && r.containers.every(c=>c.cleanup?.removed));
    if(j===2 && r.status!=='passed'){
      const test=r.tests[0];assert.equal(test.status,'runtime_error');assert.match(test.process.stderr,/NoneValueException/);
      assert.equal(test.process.stdout,'');changes.push(problem.id);
    }
  }
  assert.equal(prev!==next,row.referenceHoldout!=='passed');
}
assert.equal(records.size,0);assert.equal(changes.length,4);
console.log(JSON.stringify({firstMaterialReports:logs.length,samePublicAndHoldoutInputs:true,correctedReferences:changes}));
if(process.argv.includes('--score')){
  const score=read('score/receipt'),raw=unseal(read('score/evidence.enc'),key);
  const byId=new Map(raw.map(r=>[r.id,r])), failures=[];
  for(const row of score.rows){
    if(!row.holdoutId || row.status==='passed')continue;
    const r=byId.get(row.holdoutId);assert.equal(r.status,row.holdoutStatus);
    const t=r.tests[0], lines=t?.process?.stdout?.trim().split(/\r?\n/).filter(Boolean)??[];
    const exception=t?.process?.stderr?.match(/(?:^|\n)(\w+Exception)(?:\n|$)/)?.[1]??null;
    failures.push({caseId:row.caseId,group:row.group,repeat:row.repeat,testStatus:t?.status??r.status,
      completedChecks:lines.length,failedChecks:lines.filter(v=>v==='false').length,exception});
  }
  console.log(JSON.stringify(failures,null,2));
}
