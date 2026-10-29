// Synthetic archive contract checks, not execution or formal experiment results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha256 } from '../web/report.mjs';
import { validateEvidenceBundle, MAX_EVIDENCE_BUNDLE_BYTES } from '../web/evidence-bundle.mjs';

const baseRecord = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
async function fixture() {
  const source = {name:'bundle.cj',text:baseRecord.source.text.replace('"three"','3')};
  const revision = {schemaVersion:1,kind:'doctor-manual-revision',revisionId:'b'.repeat(32),createdAt:'2026-10-30T00:00:00.000Z',
    baseRecord:structuredClone(baseRecord),recordSha256:await sha256(JSON.stringify(baseRecord)),source:{...source,sha256:await sha256(source.text)},
    origin:'manual',compileStatus:'not_run',testStatus:'not_run',execution:{attempted:false}};
  const verification = {schemaVersion:1,kind:'doctor-revision-verification',verificationId:'c'.repeat(32),
    createdAt:'2026-10-30T00:00:01.000Z',finishedAt:null,state:'unknown',revision:structuredClone(revision),
    tests:[{id:'public_1',stdin:'',expectedStdout:'3\n'}],report:null,detail:'Synthetic unfinished request; no execution performed.'};
  return seal({schemaVersion:1,kind:'doctor-evidence-bundle',exportedAt:'2026-10-30T00:00:02.000Z',
    scope:'saved-revisions-and-verifications',revisions:[revision],verifications:[verification],manifest:[],counts:{},limitations:['Not a workspace backup.']});
}
async function seal(bundle) {
  bundle.counts = {revisions:bundle.revisions.length,verifications:bundle.verifications.length};
  bundle.manifest = [];
  for (const [type,records] of [['revision',bundle.revisions],['verification',bundle.verifications]]) {
    for (const record of records) bundle.manifest.push({type,id:type === 'revision' ? record.revisionId : record.verificationId,sha256:await sha256(JSON.stringify(record))});
  }
  return bundle;
}

test('v1, v2 and unfinished evidence keep their original states and exact records',async () => {
  const bundle = await fixture(), original = structuredClone(bundle);
  assert.equal(await validateEvidenceBundle(bundle),bundle);
  assert.deepEqual(bundle,original);
  assert.equal(bundle.verifications[0].state,'unknown');
  assert.equal(bundle.revisions[0].compileStatus,'not_run');
  bundle.revisions[0].schemaVersion = 2;
  bundle.revisions[0].documentEvidence = null; bundle.revisions[0].documentEvidenceSha256 = null;
  bundle.verifications[0].revision = structuredClone(bundle.revisions[0]);
  await validateEvidenceBundle(await seal(bundle));
  bundle.revisions = []; // A self-contained verification can outlive its source revision folder.
  await validateEvidenceBundle(await seal(bundle));
  bundle.verifications = [];
  await validateEvidenceBundle(await seal(bundle));
});

test('manifest rejects tampered bytes, mismatched identity, duplicates and missing entries',async () => {
  const seed = await fixture();
  for (const mutate of [
    b => b.manifest[0].sha256 = '0'.repeat(64),
    b => b.manifest[0].id = 'a'.repeat(32),
    b => b.manifest[0].type = 'verification',
    b => b.manifest[1] = structuredClone(b.manifest[0]),
    b => b.manifest.pop(),
    b => b.counts.revisions++,
    b => b.revisions[0].source.text += '// changed',
    b => b.extra = 'not permitted',
  ]) {
    const altered = structuredClone(seed); mutate(altered);
    await assert.rejects(validateEvidenceBundle(altered));
  }
  const duplicated = structuredClone(seed);
  duplicated.revisions.push(structuredClone(duplicated.revisions[0]));
  await assert.rejects(validateEvidenceBundle(await seal(duplicated)),/重复/);
});

test('recalculated manifest cannot authorize invalid outcomes or divergent same-ID revisions',async () => {
  const seed = await fixture();
  for (const mutate of [
    b => b.verifications[0].state = 'running',
    b => b.verifications[0].state = 'completed',
    b => b.revisions[0].compileStatus = 'compile_passed',
    b => b.verifications[0].revision.createdAt = '2026-10-30T00:00:00.001Z',
  ]) {
    const altered = structuredClone(seed); mutate(altered);
    await assert.rejects(validateEvidenceBundle(await seal(altered)));
  }
});

test('record and UTF-8 byte limits reject oversized bundles instead of truncating',async () => {
  const bundle = await fixture();
  bundle.revisions = Array(201).fill(bundle.revisions[0]); bundle.verifications = [];
  await assert.rejects(validateEvidenceBundle(await seal(bundle)),/200/);
  const large = await fixture();
  large.revisions[0].baseRecord.padding = 'x'.repeat(MAX_EVIDENCE_BUNDLE_BYTES);
  await assert.rejects(validateEvidenceBundle(large),/32 MiB/);
});
