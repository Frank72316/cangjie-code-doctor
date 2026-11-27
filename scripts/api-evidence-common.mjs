import fs from 'node:fs';
import {createDecipheriv,createCipheriv,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {sha} from './pilot-common.mjs';
export const rankingStudy=process.argv.includes('--ranking');
export const familyStudy=process.argv.includes('--families');
export const operationStudy=process.argv.includes('--operation');
export const transferOnlyStudy=rankingStudy || familyStudy || operationStudy;
export const directory=operationStudy?'docs/experiments/2026-11-27-operation':familyStudy?'docs/experiments/2026-11-27-api-families':rankingStudy?'docs/experiments/2026-11-27-api-ranking':'docs/experiments/2026-11-26-api-evidence';
export const conditionCount=operationStudy?72:familyStudy?48:rankingStudy?72:144;
export const read=name=>JSON.parse(fs.readFileSync(directory+'/'+name+'.json','utf8'));
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
