import {createDecipheriv} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sha} from './pilot-common.mjs';
export async function readHoldout(){
 const encrypted=JSON.parse(await readFile('data/experiments/pilot-holdout.enc.json','utf8'));
 const key=process.env.PILOT_HOLDOUT_KEY;
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('Private test key unavailable');
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(encrypted.iv,'hex'));
 decipher.setAuthTag(Buffer.from(encrypted.tag,'hex'));
 const raw=Buffer.concat([decipher.update(Buffer.from(encrypted.data,'base64')),decipher.final()]).toString('utf8');
 if(sha(raw)!==encrypted.sha256)throw Error('Private test commitment mismatch');
 return {sha256:encrypted.sha256,...JSON.parse(raw)};
}
// Locate only a top-level entry token. Do not use a regex on raw code that could
// accidentally edit a comment, quoted literal, helper function, or test body.
export function harnessSource(source,harness){
 let depth=0,entry=-1;
 for(let i=0;i<source.length;){
  if(source.startsWith('//',i)){const n=source.indexOf('\n',i);i=n<0?source.length:n+1;continue;}
  if(source.startsWith('/*',i)){let nest=1;i+=2;while(i<source.length&&nest){if(source.startsWith('/*',i)){nest++;i+=2;}else if(source.startsWith('*/',i)){nest--;i+=2;}else i++;}if(nest)throw Error('Unclosed comment');continue;}
  if(source[i]==='"'||source[i]==="'"){const quote=source[i++];let closed=false;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]===quote){closed=true;break;}}if(!closed)throw Error('Unclosed string');continue;}
  if(source[i]==='{')depth++;if(source[i]==='}')depth--;
  if(depth<0)throw Error('Invalid braces');
  if(/[A-Za-z_]/.test(source[i])){const start=i++;while(i<source.length&&/[A-Za-z0-9_]/.test(source[i]))i++;const token=source.slice(start,i);
   if(token.startsWith('__doctor_'))throw Error('Reserved harness name');
   if(token==='main'&&depth===0){if(entry>=0)throw Error('Multiple entries');entry=start;}
  }else i++;
 }
 if(depth!==0||entry<0)throw Error('No complete top-level entry');
 return source.slice(0,entry)+'func __doctor_original_main'+source.slice(entry+4)+'\nmain() {\n'+harness+'\n}\n';
}
