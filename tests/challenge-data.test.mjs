import test from 'node:test';
import assert from 'node:assert/strict';
import {challengeCatalog,privateChallenge} from '../scripts/challenge-data.mjs';
test('challenge public manifest has independent balanced development and evaluation families',async()=>{
 const s=await challengeCatalog();assert.equal(s.catalog.cases.length,30);assert.equal(s.catalog.cases.filter(c=>c.split==='evaluation').length,24);assert.equal(new Set(s.catalog.cases.map(c=>c.familyId)).size,30);
 assert.ok(s.catalog.cases.every(c=>c.plantedFaults===2));assert.throws(()=>privateChallenge(s,''));assert.throws(()=>privateChallenge(s,'0'.repeat(64)));
});
