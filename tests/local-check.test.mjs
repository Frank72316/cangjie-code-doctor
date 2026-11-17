import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RevisionStore} from '../scripts/revision-store.mjs';
import {LocalCheckService} from '../scripts/local-check-service.mjs';
import {runLocalProcess,localEnvironment} from '../scripts/local-process.mjs';
import {validateLocalCheck,outputText} from '../web/local-check.mjs';
import {makeServer} from '../scripts/preview.mjs';
const original=JSON.parse(await readFile(new URL('./fixtures/type_mismatch.json',import.meta.url),'utf8'));
const catalog=JSON.parse(await readFile(new URL('../data/cases/catalog.json',import.meta.url),'utf8'));
const result=(exitCode=0,stdout='',reason='')=>({exitCode,signal:null,reason,stdout:Buffer.from(stdout).toString('base64'),stderr:''});
async function setup(t,runner){
 const root=await mkdtemp(join(tmpdir(),'doctor-local-check-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const store=new RevisionStore(root),revision=await store.save({baseRecord:original,source:{name:original.source.name,text:original.source.text.replace('"three"','3')},confirmed:true});
 const bridge={health:{available:true},compiler:'cjc',busy:false,token:'test-local-token'};
 const service=new LocalCheckService({root,bridge,revisionStore:store,platform:'win32',runner});
 service.examples=catalog.cases.filter(x=>x.id==='type_mismatch').map(x=>({sourceSha256:x.sourceSha256,task:x.task,test:x.publicTests[0]}));
 return {root,store,revision,bridge,service,input:{revisionId:revision.revisionId,confirmed:true,test:null}};
}
test('local check executes the saved source, uses public expectation, and preserves separate evidence',async t=>{
 let calls=0;const s=await setup(t,async(exe,args,options)=>{
  calls++;if(calls===1){assert.equal(await readFile(join(options.cwd,'input.cj'),'utf8'),s.revision.source.text);assert.equal(args.at(-1),'program.exe');await writeFile(join(options.cwd,'program.exe'),'test artifact');return result();}
  assert.equal(options.stdin,'');assert.equal(options.timeout,5000);return result(0,'3\n');
 });
 const r=await s.service.check(s.input);assert.equal(calls,2);assert.equal(r.status,'passed');assert.equal(outputText(r.run.stdout),'3\n');assert.deepEqual(await s.service.get(r.checkId),r);
 assert.deepEqual(await s.store.get(s.revision.revisionId),s.revision);assert.equal((await s.service.list()).checks.length,1);
 const tampered=structuredClone(r);tampered.run.stdout=Buffer.from('4\n').toString('base64');await assert.rejects(validateLocalCheck(tampered));
 await writeFile(join(s.root,'runs/local-checks',r.checkId,'request.json'),'{}');await assert.rejects(s.service.get(r.checkId),/不匹配/);assert.equal((await s.service.list()).unreadable,1);
});
test('compile errors never run; wrong output, runtime errors, incomplete runs and no expectation are distinct',async t=>{
 for(const [compile,run,custom,status]of[
  [result(1),null,null,'compile_failed'],[result(0),result(0,'4\n'),null,'output_mismatch'],
  [result(0),result(2),null,'runtime_failed'],[result(0),result(null,'','timeout'),null,'tool_error'],
  [result(0),result(0,'3\r\n'),null,'passed'],[result(0),result(0,'3'),null,'output_mismatch'],[result(0),result(0,'\uFEFF3\n'),null,'output_mismatch'],[result(0),result(0,'3\n'),{stdin:'abc',expectedStdout:null},'ran'],
  [result(0),result(0,'ok'),{stdin:'abc',expectedStdout:'ok'},'passed']]){
  let calls=0;const s=await setup(t,async(exe,args,o)=>{if(++calls===1){await writeFile(join(o.cwd,'program.exe'),'test');return compile;}assert.equal(o.stdin,custom?.stdin||'');return run;});
  const r=await s.service.check({...s.input,test:custom});assert.equal(r.status,status);assert.equal(calls,run?2:1);assert.equal(s.bridge.busy,false);
 }
});
test('local check rejects arbitrary commands, missing confirmation, unready environments and overlapping runs',async t=>{
 let calls=0;const s=await setup(t,async()=>{calls++;return result(1);});
 for(const input of [{...s.input,confirmed:false},{...s.input,revisionId:'../x'},{...s.input,command:'x'},{...s.input,test:{stdin:'x'.repeat(4097),expectedStdout:''}}])await assert.rejects(s.service.check(input));
 s.bridge.busy=true;await assert.rejects(s.service.check(s.input),{status:409});s.bridge.busy=false;s.service.enabled=false;await assert.rejects(s.service.check(s.input),{status:503});assert.equal(calls,0);
});
test('HTTP local execution requires loopback token, same origin and JSON; static modules are served',async t=>{
 const s=await setup(t,async()=>result(1));const server=makeServer({bridge:s.bridge,revisionStore:s.store,localCheckService:s.service});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`,headers={'Content-Type':'application/json','X-Doctor-Token':s.bridge.token};
 const post=h=>fetch(base+'/api/local-checks',{method:'POST',headers:h,body:JSON.stringify(s.input)});
 assert.equal((await post({'Content-Type':'application/json'})).status,403);assert.equal((await post({...headers,Origin:'https://other.example'})).status,403);
 assert.equal((await post({...headers,'Content-Type':'text/plain'})).status,415);
 const response=await post(headers);assert.equal(response.status,200);assert.equal((await response.json()).status,'compile_failed');
 for(const path of ['/local-check.mjs','/local-check-ui.mjs'])assert.equal((await fetch(base+path)).status,200);
 assert.equal((await(await fetch(base+'/api/health')).json()).localCheck.available,true);
});
test('imported filenames do not silently inherit sample expected output; missing artifact cannot pass',async t=>{
 let calls=0;const s=await setup(t,async(exe,args,o)=>{if(++calls===1){await writeFile(join(o.cwd,'program.exe'),'test');return result();}return result(0,'different\n');});
 const imported=await s.store.save({baseRecord:original,source:{name:'my-program.cj',text:'main() { println("different") }\n'},confirmed:true});
 const report=await s.service.check({...s.input,revisionId:imported.revisionId});assert.equal(report.status,'ran');assert.equal(report.test.expectedStdout,null);
 s.service.runner=async()=>result();const missing=await s.service.check(s.input);assert.equal(missing.status,'tool_error');assert.equal(missing.compile.reason,'missing_artifact');assert.equal(missing.run,null);
});
test('cancelled run persists incomplete status and releases busy state; second execution is rejected while active',async t=>{
 let resolveRun,started;const running=new Promise(r=>started=r);let calls=0;
 const s=await setup(t,async(exe,args,o)=>{if(++calls===1){await writeFile(join(o.cwd,'program.exe'),'test');return result();}started();return new Promise(r=>resolveRun=r);});
 const pending=s.service.check(s.input);await running;await assert.rejects(s.service.check(s.input),{status:409});resolveRun(result(null,'3\n','cancelled'));
 const report=await pending;assert.equal(report.status,'tool_error');assert.equal(s.bridge.busy,false);assert.equal((await s.service.get(report.checkId)).run.reason,'cancelled');
});
test('real process helper sends stdin, retains failure output, limits time/output and strips secret env',async()=>{
 assert.equal(Object.hasOwn(localEnvironment(),'OPENAI_API_KEY'),false);
 const echo=await runLocalProcess(process.execPath,['-e','process.stdin.pipe(process.stdout)'],{stdin:'你好\n'});assert.equal(echo.exitCode,0);assert.equal(outputText(echo.stdout),'你好\n');
 const bad=await runLocalProcess(process.execPath,['-e','process.stderr.write("bad");process.exitCode=7']);assert.equal(bad.exitCode,7);assert.equal(outputText(bad.stderr),'bad');
 const timed=await runLocalProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:300});assert.equal(timed.reason,'timeout');
 const full=await runLocalProcess(process.execPath,['-e','setInterval(()=>process.stdout.write("x".repeat(4096)),1)'],{maxOutput:1000});assert.equal(full.reason,'output_limit');assert.equal(outputText(full.stdout).length,1000);
 const controller=new AbortController();controller.abort();assert.equal((await runLocalProcess(process.execPath,[],{signal:controller.signal})).reason,'cancelled');
});
