import fs from 'node:fs';
import {createDecipheriv,createCipheriv,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {sha} from './pilot-common.mjs';
const studies = {
  mechanism:{folder:'2026-11-26-api-evidence', count:144, cap:8, generation:'api-evidence'},
  ranking:{folder:'2026-11-27-api-ranking', count:72, cap:5, generation:'api-ranking'},
  families:{folder:'2026-11-27-api-families', count:48, cap:4, generation:'api-families'},
  operation:{folder:'2026-11-27-operation', count:72, cap:5, generation:'api-operation'},
  review:{folder:'2026-11-28-review', count:96, cap:5, generation:'api-review'},
  router:{folder:'2026-11-28-router', count:192, cap:10, generation:'api-router'},
  node:{folder:'2026-11-28-node', count:64, cap:4, generation:'api-node'},
  wording:{folder:'2026-11-27-wording', count:144, cap:8, generation:'api-wording', materials:'2026-11-27-operation'},
};
const flags=Object.keys(studies).filter(s=>process.argv.includes('--'+s));
assert.ok(flags.length<=1,'Choose one experiment');
const study=flags[0]??'mechanism';
export const setting=studies[study],rankingStudy=study==='ranking',familyStudy=study==='families',
  operationStudy=study==='operation',wordingStudy=study==='wording',transferOnlyStudy=study!=='mechanism';
export const directory='docs/experiments/'+setting.folder;
export const conditionCount=setting.count;
export const read=name=>{
  const material=name==='transfer'||name==='transfer.enc'||name.startsWith('materials/');
  const location=setting.materials&&material?'docs/experiments/'+setting.materials:directory;
  return JSON.parse(fs.readFileSync(location+'/'+name+'.json','utf8'));
};
export const dump=(path,obj)=>fs.writeFileSync(path,JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
export function unseal(e,key){
 const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(e.iv,'hex'));
 cipher.setAuthTag(Buffer.from(e.tag,'hex'));
 const bytes=Buffer.concat([cipher.update(Buffer.from(e.data,'base64')),cipher.final()]);
 const raw=(e.encoding==='gzip'?gunzipSync(bytes):bytes).toString('utf8');
 assert.equal(sha(raw),e.sha256);return JSON.parse(raw);
}
export function sealEvidence(data,key){
 const raw=JSON.stringify(data),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 const bytes=Buffer.concat([c.update(gzipSync(raw)),c.final()]);
 return {encoding:'gzip',sha256:sha(raw),iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),data:bytes.toString('base64')};
}
export function transferPrivate(key){
 const x=unseal(read('transfer.enc'),key);assert.equal(x.sourceSha256,sha(read('transfer')));return x.cases;
}
