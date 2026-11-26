import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {plan,messages,candidate,verifyPack,summarize,SCOPE} from '../scripts/pilot-common.mjs';
import {generate,reserveCost,usageCost} from '../scripts/pilot-generate.mjs';
import {harnessSource} from '../scripts/pilot-holdout.mjs';
const cases=[{id:'one',category:'syntax',source:{name:'one.cj',text:'main() {}'},task:'repair',publicTests:[],feedback:{status:'compile_failed'},documents:[{id:'doc',text:'rule'}]},{id:'two',category:'type',source:{name:'two.cj',text:'main() {}'},task:'repair',publicTests:[],feedback:{status:'compile_failed'},documents:[]},{id:'control',category:'correct'}];
test('paired prompts differ only by documents; alternate order; controls excluded',()=>{
 assert.deepEqual(plan(cases).map(j=>j.group),['A','B','B','A']);
 const a=messages(cases[0],'A'),b=messages(cases[0],'B');assert.equal(a[0].content,b[0].content);
 const av=JSON.parse(a[1].content),bv=JSON.parse(b[1].content);assert.equal(av.documents.length,0);assert.equal(bv.documents.length,1);bv.documents=[];assert.deepEqual(av,bv);
 assert.throws(()=>candidate('{"code":"main() {}","explanation":"x"}'));assert.throws(()=>candidate('```json {}'));assert.throws(()=>candidate(JSON.stringify({code:'x\n'.repeat(201)})));
});
test('generation budget, no retry, failed rows retained, tampering refused',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'doctor-pilot-'));const freeze={cases,scope:SCOPE};let calls=0;
 try{
  const pack=await generate(freeze,{key:'test-secret-abcdefgh',folder:join(dir,'run'),fetcher:async()=>{calls++;return calls===1?{ok:false,status:500}:{ok:true,status:200,json:async()=>({model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:'{"code":"main() {}"}'}}]})};}});
  assert.equal(calls,4);assert.equal(pack.results[0].status,'service_failed');assert.equal(pack.results[1].status,'generated');verifyPack(pack,freeze);
  assert.ok(!(await readFile(join(dir,'run/candidates.json'),'utf8')).includes('test-secret'));
  pack.results[1].code+=' ';assert.throws(()=>verifyPack(pack,freeze));
  const stopped=await generate(freeze,{key:'abc',folder:join(dir,'zero'),maxCostCNY:0,fetcher:()=>{throw Error('must not call');}});assert.ok(stopped.results.every(r=>r.status==='budget_stopped'));
  await assert.rejects(generate(freeze,{key:'abc',folder:join(dir,'zero')}));
  assert.ok(reserveCost({messages:[]})>usageCost({prompt_tokens:100,completion_tokens:10}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('paired summary counts case outcomes rather than calls',()=>{
 const rows=[{category:'syntax',A:{status:'passed'},B:{status:'passed'}},{category:'type',A:{status:'compile_failed'},B:{status:'passed'}},{category:'logic',A:{status:'passed'},B:{status:'invalid'}},{category:'scope',A:{status:'service_failed'},B:{status:'test_failed'}},{category:'correct',regression:{status:'passed'}}];
 const s=summarize(rows);assert.equal(s.denominator,4);assert.equal(s.A,2);assert.equal(s.B,2);assert.deepEqual(s.paired,{both:1,onlyA:1,onlyB:1,neither:1});assert.equal(s.regression.total,1);
});
test('hidden harness preserves helpers and skips comments and string main tokens',()=>{
 const source='// main() {}\nfunc f(): String { "main { }" }\n/* main() */\nmain() { println(f()) }';
 const wrapped=harnessSource(source,'println(f())');assert.ok(wrapped.includes('func f(): String { "main { }" }'));assert.ok(wrapped.includes('func __doctor_original_main()'));assert.ok(wrapped.endsWith('main() {\nprintln(f())\n}\n'));
 assert.throws(()=>harnessSource('main() {} main() {}',''));assert.throws(()=>harnessSource('main() {',''));assert.throws(()=>harnessSource('func __doctor_x() {} main() {}',''));
});
