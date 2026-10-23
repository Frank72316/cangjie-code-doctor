// Public development acceptance; no held-out data, model calls or A/B measurements.
import assert from 'node:assert/strict';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyPublic } from './sandbox-verify.mjs';
const [image, binary] = process.argv.slice(2);
assert.ok(image && binary, 'Pass exact image ID and trusted Doctor binary.');
const core = resolve(binary), root = process.cwd();
const hello = await readFile('examples/hello.cj','utf8');
const typeError = await readFile('examples/type_mismatch.cj','utf8');
// Expected text is reviewed with the fixture; never obtained by running a candidate.
assert.match(hello, /println\("Hello, Cangjie Code Doctor!"\)/);
const cases = [
  {id:'hello-public-pass', source:hello, expected:'Hello, Cangjie Code Doctor!\n', status:'passed'},
  {id:'wrong-expected-public-fail', source:hello, expected:'deliberately wrong expectation\n', status:'test_failed'},
  {id:'compile-error-not-run', source:typeError, expected:'', status:'compile_failed'}
];
const results=[];
for (const entry of cases) {
  const report = await verifyPublic({source:{name:entry.id+'.cj',text:entry.source},tests:[{id:'public',stdin:'',expectedStdout:entry.expected}]},{root,image,core});
  console.log(JSON.stringify({caseId:entry.id,id:report.id,status:report.status,compile:report.compile.status,tests:report.tests,detail:report.detail}));
  assert.equal(report.status,entry.status,JSON.stringify(report));
  assert.ok(report.containers.every(container=>container.cleanup?.removed));
  if (entry.status==='compile_failed') {
    assert.equal(report.tests[0].status,'not_run'); assert.equal(report.containers.length,1);
  } else {
    assert.equal(report.containers.length,2); assert.equal(report.compile.status,'compile_passed');
    assert.ok(report.tests[0].verdict); assert.equal(report.tests[0].verdict.comparison,'exact_bytes');
  }
  results.push({caseId:entry.id,reportId:report.id,status:report.status,sourceSha256:report.source.sha256,artifactSha256:report.artifact?.sha256,
    compilerVersion:report.compilerVersion,testStatus:report.testStatus,containersRemoved:true});
}
const receipt={developmentOnly:true,scope:'three-public-development-checks-not-an-experiment',image,checkedAt:new Date().toISOString(),results};
await writeFile(join(root,'runs','sandbox-verification-acceptance.json'),JSON.stringify(receipt,null,2)+'\n');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,'\n## Container compilation and native public verdicts\n\n```json\n'+JSON.stringify(receipt,null,2)+'\n```\n');
console.log('PASS three actual Cangjie container verification paths; all containers removed.');
