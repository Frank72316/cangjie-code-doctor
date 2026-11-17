// Dataset construction acceptance, not model evaluation. Never reads reference/holdout material.
import {writeFile,mkdir,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {checkCaseCatalog,readBounded} from './case-catalog.mjs';
import {verifyPublic} from './sandbox-verify.mjs';
const [image,binary,...extra]=process.argv.slice(2);
if (!image || !binary || extra.length) throw new Error('Usage: node scripts/verify-case-initials.mjs <image-id> <doctor-binary>');
const root=process.cwd(), core=resolve(binary);
const snapshot=await checkCaseCatalog({root});
const catalog=JSON.parse(await readBounded(root,'data/cases/catalog.json',2*1024*1024));
const sha=s=>createHash('sha256').update(s).digest('hex');
const directory='runs/case-initials';
await mkdir(directory); // Refuse replacing evidence from an earlier run.
const receipt={kind:'doctor-case-construction-acceptance',schemaVersion:1,startedAt:new Date().toISOString(),
  commit:process.env.GITHUB_SHA??null,datasetSha256:snapshot.datasetSha256,image,
  scope:'Initial public behavior only; no reference validation, held-out tests, model calls or A/B results.',results:[]};
for(const item of catalog.cases){
  const bytes=await readBounded(root,item.sourcePath,65536);
  if(sha(bytes)!==item.sourceSha256) throw new Error(`${item.id}: source changed after checking`);
  const report=await verifyPublic({source:{name:item.id+'.cj',text:bytes.toString('utf8')},tests:item.publicTests},{root,image,core});
  const expected={'compile-error':'compile_failed','fails-public-tests':'test_failed','passes-public-tests':'passed'}[item.initialExpectation];
  // A runtime crash/timeout is not evidence of the intended logical output error.
  const meaningful=expected!=='test_failed'||(report.compile.status==='compile_passed' && report.tests.some(t=>t.status==='failed') && report.tests.every(t=>['passed','failed'].includes(t.status)));
  const cleaned=report.containers.length>0 && report.containers.every(c=>c.cleanup?.removed===true);
  const text=JSON.stringify(report,null,2)+'\n';
  await writeFile(`${directory}/${item.id}.json`,text,{flag:'wx'});
  const result={id:item.id,split:item.split,category:item.category,sourceSha256:item.sourceSha256,
    expected,actual:report.status,accepted:report.status===expected&&meaningful&&cleaned,reportSha256:sha(text)};
  receipt.results.push(result);
  await writeFile(`${directory}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(result));
  if(!cleaned||report.status==='tool_error') throw new Error('Tool/cleanup failure; stopped without starting another case.');
}
receipt.finishedAt=new Date().toISOString();
receipt.accepted=receipt.results.every(r=>r.accepted);
await writeFile(`${directory}/receipt.json`,JSON.stringify(receipt,null,2)+'\n');
if(process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  '\n## Case construction: initial public behavior\n\n'+receipt.results.filter(r=>r.accepted).length+'/'+receipt.results.length+' matched their registered initial expectation. This is not repair accuracy or A/B evidence.\n');
if(!receipt.accepted) process.exitCode=1;
