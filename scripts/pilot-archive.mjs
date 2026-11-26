import {readFile,writeFile} from 'node:fs/promises';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
const [mode,input,output]=process.argv.slice(2);
if(!['seal','open'].includes(mode)||!input||!output)throw Error('Usage: node scripts/pilot-archive.mjs seal|open <input> <new-output>; key stays in data/holdout/pilot-v1/key.txt');
const keyText=(await readFile('data/holdout/pilot-v1/key.txt','utf8')).trim();
if(!/^[a-f0-9]{64}$/.test(keyText))throw Error('Private archive key invalid');
const key=Buffer.from(keyText,'hex'),hash=buffer=>createHash('sha256').update(buffer).digest('hex');
if(mode==='seal'){
 const raw=await readFile(input),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),data=Buffer.concat([cipher.update(raw),cipher.final()]);
 const envelope={kind:'doctor-pilot-encrypted-evidence',algorithm:'AES-256-GCM',plaintextSha256:hash(raw),bytes:raw.length,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('base64')};
 await writeFile(output,JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});console.log('Evidence archived, plaintext SHA-256: '+envelope.plaintextSha256);
}else{
 const envelope=JSON.parse(await readFile(input,'utf8'));if(envelope.kind!=='doctor-pilot-encrypted-evidence'||envelope.algorithm!=='AES-256-GCM')throw Error('Archive envelope invalid');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'hex'));decipher.setAuthTag(Buffer.from(envelope.tag,'hex'));
 const raw=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]);
 if(hash(raw)!==envelope.plaintextSha256||raw.length!==envelope.bytes)throw Error('Evidence hash mismatch');
 await writeFile(output,raw,{flag:'wx'});console.log('Evidence restored and hash verified.');
}
