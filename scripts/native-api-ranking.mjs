import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {runNative} from './native-bridge.mjs';
import {validatedResult} from './retrieval.mjs';

export async function nativeRanking(folder,task,query,file,corpus){
  const path=folder+'/'+task.id+'.json';
  await fs.writeFile(path,JSON.stringify({sdkVersion:'1.0.5',query,topK:3}));
  const binary=resolve('target/debug/doctor'+(process.platform==='win32'?'.exe':''));
  const p=await runNative(binary,['retrieve',file,path],{cwd:process.cwd(),timeout:20000});
  assert.ok(p.code===0 && !p.stderr.trim() && !p.reason,'Native retrieval failed for '+task.id);
  return validatedResult(JSON.parse(p.stdout),corpus,query).results;
}
