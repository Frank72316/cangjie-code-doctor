import {readFile} from 'node:fs/promises';
import {createDecipheriv} from 'node:crypto';
import {sha} from './pilot-common.mjs';
import {validateVerification} from './sandbox-verify.mjs';
export async function challengeCatalog(root=process.cwd()){
 const path=root+'/data/experiments/challenge-v1/',raw=await readFile(path+'catalog.json','utf8'),catalog=JSON.parse(raw),sealed=JSON.parse(await readFile(path+'holdout.enc.json','utf8'));
 if(catalog.kind!=='doctor-challenge-catalog'||catalog.sdkVersion!=='1.0.5'||catalog.cases.length!==30)throw Error('Challenge identity/count mismatch');
 const ids=new Set(),families=new Map();
 for(const c of catalog.cases){
  if(!/^[a-z][a-z0-9_]+$/.test(c.id)||ids.has(c.id)||!['development','evaluation'].includes(c.split)||!['stateful','algorithm','language-api'].includes(c.stratum))throw Error('Case identity invalid');ids.add(c.id);
  if(families.has(c.familyId)&&families.get(c.familyId)!==c.split)throw Error('Cross-split family leakage');families.set(c.familyId,c.split);
  validateVerification({source:c.source,tests:c.publicTests});if(sha(c.source.text)!==c.sourceSha256||c.plantedFaults!==2||!c.task||!c.origin)throw Error('Case content invalid');
 }
 for(const stratum of ['stateful','algorithm','language-api'])for(const [split,count] of [['development',2],['evaluation',8]])if(catalog.cases.filter(c=>c.split===split&&c.stratum===stratum).length!==count)throw Error('Unbalanced split');
 return {catalog,catalogSha256:sha(raw),holdoutSha256:sealed.sha256,sealed};
}
export function privateChallenge(snapshot,key){
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('Private test key absent');
 const e=snapshot.sealed,d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(e.iv,'hex'));d.setAuthTag(Buffer.from(e.tag,'hex'));
 const raw=Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString('utf8'),data=JSON.parse(raw);
 if(sha(raw)!==snapshot.holdoutSha256||data.catalogSha256!==snapshot.catalogSha256||data.cases.length!==snapshot.catalog.cases.length)throw Error('Private evidence mismatch');
 for(const c of snapshot.catalog.cases){const h=data.cases.find(h=>h.id===c.id);if(!h||h.mutants.length!==c.plantedFaults||!h.expectedStdout)throw Error('Private case missing');}
 return data;
}
