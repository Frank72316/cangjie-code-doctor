import fs from 'node:fs';
import assert from 'node:assert/strict';
import {read,dump,directory,operationStudy} from './api-evidence-common.mjs';
import {sha} from './pilot-common.mjs';

assert.ok(operationStudy);
const corpus=JSON.parse(fs.readFileSync('docs/experiments/2026-11-27-api-families/corpus.json','utf8'));
const docs=new Map(corpus.documents.map(d=>[d.id,d]));
const design=read('design'),pack=read('candidates');
assert.equal(pack.designSha256,sha(design));
const verified=process.argv.includes('--outcomes')?read('verified'):null;
const rows=[];
for(const [i,candidate] of pack.results.entries()){
  const c=design.cases.find(c=>c.id===candidate.caseId), doc=docs.get(c.gold);
  const match=/^prop (first|last)$/.exec(doc.section);
  if(!match) continue;
  const member=match[1];
  // Only literal use on this task's q parameter. Never count examples in main.
  const implementation=(candidate.code??'').split(/\nmain\s*\(/)[0].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,' ');
  const uses=[...implementation.matchAll(new RegExp('\\bq\\s*\\.\\s*'+member+'\\b(\\s*\\()?','g'))];
  const forms=new Set(uses.map(m=>m[1]?'call':'property'));
  const form=forms.size>1?'mixed':forms.size===1?[...forms][0]:'other';
  const row={caseId:c.id,group:candidate.group,repeat:candidate.repeat,member,form};
  if(verified){
    const result=verified.rows[i];
    assert.equal(result.caseId,row.caseId);assert.equal(result.group,row.group);assert.equal(result.repeat,row.repeat);
    row.outcome=result.status;
  }
  rows.push(row);
}
assert.equal(rows.length,24);
const counts={};
for(const g of ['G','T','I']){
  const arm=rows.filter(r=>r.group===g);assert.equal(arm.length,8);
  counts[g]=Object.fromEntries(['property','call','other','mixed'].map(f=>[f,arm.filter(r=>r.form===f).length]));
}
const result={scope:'secondary reading of locked candidate code, four tasks with a first/last property as preferred document',counts,rows};
if(process.argv.includes('--write')){
  assert.ok(verified);dump(directory+'/property-use.json',result);
}
if(process.argv.includes('--verify'))assert.deepEqual(result,read('property-use'));
console.log(JSON.stringify(result,null,2));
