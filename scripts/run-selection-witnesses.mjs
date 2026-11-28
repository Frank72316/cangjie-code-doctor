import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {read,setting,transferPrivate,sealEvidence,unseal,dump} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
import {probeRequest,observation} from './feedback-probe.mjs';
import {contractResult} from './select-contract-examples.mjs';
import {decodePool,differs} from './selection-observations.mjs';
import {verifyPublic} from './sandbox-verify.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';

assert.equal(setting.generation,'api-selection');
const verify=process.argv.includes('--verify');
const key=verify?fs.readFileSync('data/holdout/challenge-v1/key.txt','utf8').trim():process.env.CHALLENGE_TEST_KEY;
delete process.env.CHALLENGE_TEST_KEY;
const supplement=read('supplement'), tasks=read('transfer'), privateCases=transferPrivate(key), folder='runs/api-evidence-score';
const score=verify?read('score/receipt'):JSON.parse(fs.readFileSync(folder+'/receipt.json','utf8'));
const record=verify?read('score/supplement'):{image:process.argv[2],commit:score.commit,supplementSha256:sha(supplement),rows:[]};
assert.equal(record.image,score.image);assert.equal(record.commit,score.commit);assert.equal(record.supplementSha256,sha(supplement));
const reports=verify?unseal(read('score/supplement-evidence.enc'),key):[];
let cursor=0;
const rows=[];
for(const [i,s] of supplement.rows.entries()){
  if(!s.changed)continue;
  const task=tasks[i], oracle=s.examples.map(x=>contractResult(s.id,x.array,x.t));
  const flat=oracle.flatMap(o=>[o.returned,...o.after]);
  const harness=['println(0)','println('+flat.length+')',...s.examples.flatMap((p,j)=>[
    'let q'+j+': Array<Int64> = ['+p.array.join(',')+']',
    'let r'+j+'=repair(q'+j+', '+p.t+')','println(r'+j+')','for (value in q'+j+') { println(value) }'])].join('\n');
  const row={id:s.id};
  for(const [tag,body] of [['reference',privateCases[i].reference],['starter',task.source.text]]){
    const req=probeRequest(body,{harness,expected:{returned:0,after:flat}});
    const source={name:task.source.name,text:req.source};
    const r=verify?reports[cursor]:await verifyPublic({source,tests:req.tests},{root:process.cwd(),image:record.image,core:resolve('target/debug/doctor')});
    assert.equal(r.sdkVersion,'1.0.5');assert.equal(r.image,record.image);
    assert.ok(r.containers.length&&r.containers.every(c=>c.cleanup?.removed));
    assert.equal(r.source.text,source.text);assert.equal(r.source.sha256,sha(source.text));
    assert.equal(r.requestSha256,sha(verificationRequestText(source,req.tests)));
    const actual=decodePool(observation(r),s.examples);
    const failed=oracle.map((value,j)=>differs(value,actual[j]));
    assert.equal(r.status,failed.some(Boolean)?'test_failed':'passed');
    if(tag==='reference')assert.deepEqual(actual,oracle);
    row[tag]={reportId:r.id,actual,failed};
    if(!verify)reports.push(r);
    cursor++;
  }
  rows.push(row);
}
assert.equal(cursor,reports.length);
if(verify){assert.deepEqual(record.rows,rows);}
else{
 record.rows=rows;
 dump(folder+'/supplement.json',record);dump(folder+'/supplement-evidence.enc.json',sealEvidence(reports,key));
}
console.log('Verified '+cursor+' supplementary SDK executions across '+rows.length+' changed input pairs.');
