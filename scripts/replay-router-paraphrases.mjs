import assert from 'node:assert/strict';
import {read,directory,dump,setting} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';
assert.equal(setting.generation,'api-router');
const summary=read('summary'), variants=read('scope-paraphrases'), verified=read('verified');
assert.equal(sha(verified),summary.verifiedSha256);
const rows=variants.map(v=>{
  const c=summary.perCase.find(c=>c.id===v.caseId);
  assert.equal(c.policy.J,v.before);
  const chosen=verified.rows.filter(r=>r.caseId===c.id && r.group===v.after);
  assert.equal(chosen.length,3);
  const afterPassed=chosen.filter(r=>r.status==='passed').length;
  assert.equal(afterPassed,c.passes[v.after]);
  return {caseId:c.id,before:v.before,after:v.after,beforePassed:c.passes.J,afterPassed,input:chosen.reduce((n,r)=>n+r.input,0)};
});
assert.equal(new Set(rows.map(r=>r.caseId)).size,24);
const result={variantsSha256:sha(variants),flips:rows.filter(r=>r.before!==r.after).length,
 beforePassed:rows.reduce((n,r)=>n+r.beforePassed,0),afterPassed:rows.reduce((n,r)=>n+r.afterPassed,0),
 input:rows.reduce((n,r)=>n+r.input,0),rows};
if(process.argv.includes('--write')) dump(directory+'/scope-replay.json',result);
if(process.argv.includes('--verify')) assert.deepEqual(result,read('scope-replay'));
console.log(JSON.stringify({...result,rows:undefined}));
