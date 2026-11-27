// Diagnostic analysis on already ranked tasks; never changes a scored prompt.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {read,rankingStudy} from './api-evidence-common.mjs';
import {runNative} from './native-bridge.mjs';
import {validatedResult} from './retrieval.mjs';
import {rankApiSections} from './rank-api-sections.mjs';
assert.ok(rankingStudy,'Pass --ranking');
const corpusPath='docs/experiments/2026-11-26-api-evidence/corpus.json';
const corpus=JSON.parse(await fs.readFile(corpusPath,'utf8'));
const old=JSON.parse(await fs.readFile('docs/experiments/2026-11-26-api-evidence/design.json','utf8'));
const current=read('design'), sets={development:old.cases,evaluation:current.cases},result={};
await fs.mkdir('tmp/api-ranking-queries',{recursive:true});
for(const [panel,cases] of Object.entries(sets)){
  const rows=[];
  for(const c of cases){
    const p=JSON.parse((c.requests.B??c.requests.M).messages[1].content);
    const intent=p.task.split(/保留所有公开函数|保留函数签名/)[0];
    const file='tmp/api-ranking-queries/intent-'+c.id+'.json';
    await fs.writeFile(file,JSON.stringify({sdkVersion:'1.0.5',query:intent,topK:3}));
    const binary=resolve('target/debug/doctor'+(process.platform==='win32'?'.exe':''));
    const run=await runNative(binary,['retrieve',corpusPath,file],{cwd:process.cwd(),timeout:20000});
    assert.ok(run.code===0&&!run.reason&&!run.stderr.trim());
    const taskOnlyBM25=validatedResult(JSON.parse(run.stdout),corpus,intent).results.map(r=>r.id);
    const noType=rankApiSections(corpus,p.task,'').slice(0,3).map(r=>r.id);
    const field=rankApiSections(corpus,p.task,p.source.text).slice(0,3).map(r=>r.id);
    const original=panel==='evaluation'?c.ranks.B:c.apiRanks;
    if(panel==='evaluation')assert.deepEqual(field,c.ranks.F);
    rows.push({id:c.id,gold:c.gold,original,taskOnlyBM25,noType,field});
  }
  const scores=Object.fromEntries(['original','taskOnlyBM25','noType','field'].map(m=>[m,{
    top1:rows.filter(c=>c[m][0]===c.gold).length,top3:rows.filter(c=>c[m].includes(c.gold)).length
  }]));
  result[panel]={rows,scores};
}
console.log(JSON.stringify(result,null,2));
