import test from 'node:test';import assert from 'node:assert/strict';
import {challengeCatalog} from '../scripts/challenge-data.mjs';
import {challengeSchedule,challengeCorpus,challengeMessages,challengeQuery} from '../scripts/challenge-design.mjs';
test('challenge schedule preserves cases and balances three conditions per replicate',async()=>{
 const {catalog}=await challengeCatalog(),jobs=challengeSchedule(catalog.cases);
 assert.equal(jobs.length,216);assert.equal(new Set(jobs.map(j=>[j.caseId,j.repeat,j.group].join('/'))).size,216);
 for(const group of ['A','B','C'])assert.equal(jobs.filter(j=>j.group===group).length,72);
 assert.equal(challengeSchedule(catalog.cases,'development',1).length,18);assert.ok(jobs.every(j=>!j.caseId.startsWith('dev_')));
});
test('public requests vary only documents and exclude private/curation metadata',async()=>{
 const {catalog}=await challengeCatalog(),{corpus}=await challengeCorpus(),c=catalog.cases[0],f={diagnostics:[]},retrieval={results:corpus.documents.slice(4,7)};
 const requests=['A','B','C'].map(g=>JSON.parse(challengeMessages(c,f,g,retrieval,corpus)[1].content));
 assert.equal(requests[0].documents.length,0);assert.equal(requests[1].documents.length,3);assert.equal(requests[2].documents.length,3);
 for(const r of requests){assert.ok(!Object.hasOwn(r,'plantedFaults'));assert.ok(!Object.hasOwn(r,'docTopics'));assert.ok(!Object.hasOwn(r,'origin'));r.documents=[];}
 assert.deepEqual(requests[0],requests[1]);assert.deepEqual(requests[1],requests[2]);assert.ok(challengeQuery(c,f).length<=2000);
});
