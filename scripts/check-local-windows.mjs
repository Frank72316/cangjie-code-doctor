import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {RevisionStore} from '../scripts/revision-store.mjs';
import {LocalCheckService} from '../scripts/local-check-service.mjs';
import {NativeBridge} from './native-bridge.mjs';
import {outputText} from '../web/local-check.mjs';
assert.equal(process.platform,'win32','This opt-in check requires Windows and SDK 1.0.5.');
assert.ok(process.env.CANGJIE_HOME,'Load the SDK envsetup.ps1 first.');
const root=resolve('.'),store=new RevisionStore(root),original=JSON.parse(await readFile('tests/fixtures/type_mismatch.json','utf8'));
const bridge=new NativeBridge({root,compiler:join(process.env.CANGJIE_HOME,'bin/cjc.exe'),executable:join(root,'target/debug/doctor.exe')});
await bridge.probe();assert.equal(bridge.health.available,true,bridge.health.detail);
const service=new LocalCheckService({root,revisionStore:store,bridge});await service.loadExamples();
const results=[];
for(const [value,expected]of[['3','passed'],['4','output_mismatch'],['"four"','compile_failed']]){
 const revision=await store.save({baseRecord:original,source:{name:'type_mismatch.cj',text:original.source.text.replace('"three"',value)},confirmed:true});
 const r=await service.check({revisionId:revision.revisionId,confirmed:true,test:null});
 const summary={value,expected,status:r.status,checkId:r.checkId,compile:r.compile.exitCode,output:r.run?outputText(r.run.stdout):null,reason:r.run?.reason||r.compile.reason,stderr:outputText(r.compile.stderr)};
 results.push(summary);console.log(JSON.stringify(summary));assert.equal(r.status,expected);
}
await mkdir('tmp',{recursive:true});await writeFile('tmp/local-native-results.json',JSON.stringify(results,null,2));
