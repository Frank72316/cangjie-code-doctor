// A bounded collection of saved evidence, not a backup or an execution result.
import { sha256 } from './report.mjs';
import { validateRevision } from './revision.mjs';
import { validateVerificationRecord } from './verification.mjs';

export const MAX_EVIDENCE_BUNDLE_BYTES = 32 * 1024 * 1024;
export const MAX_EVIDENCE_BUNDLE_RECORDS = 200;
const encoder = new TextEncoder();
const requireThat = (valid, message) => { if (!valid) throw new Error(message); };
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));

export async function validateEvidenceBundle(bundle) {
  requireThat(exact(bundle,['schemaVersion','kind','exportedAt','scope','revisions','verifications','manifest','counts','limitations'])
    && bundle.schemaVersion === 1 && bundle.kind === 'doctor-evidence-bundle'
    && bundle.scope === 'saved-revisions-and-verifications'
    && typeof bundle.exportedAt === 'string' && Number.isFinite(Date.parse(bundle.exportedAt))
    && new Date(bundle.exportedAt).toISOString() === bundle.exportedAt
    && Array.isArray(bundle.revisions) && Array.isArray(bundle.verifications) && Array.isArray(bundle.manifest)
    && exact(bundle.counts,['revisions','verifications'])
    && bundle.counts.revisions === bundle.revisions.length && bundle.counts.verifications === bundle.verifications.length
    && Array.isArray(bundle.limitations) && bundle.limitations.length > 0 && bundle.limitations.length <= 20
    && bundle.limitations.every(item => typeof item === 'string' && item.length > 0 && item.length <= 2000),
    '材料包结构、数量或范围无效，未下载。');
  const total = bundle.revisions.length + bundle.verifications.length;
  requireThat(total <= MAX_EVIDENCE_BUNDLE_RECORDS && bundle.manifest.length === total,
    '材料包条目超过 200 条，或清单与记录数量不一致，未下载。');
  requireThat(encoder.encode(JSON.stringify(bundle)).length <= MAX_EVIDENCE_BUNDLE_BYTES,
    '材料包超过 32 MiB，未下载。');
  const entries = new Map();
  for (const entry of bundle.manifest) {
    requireThat(exact(entry,['type','id','sha256']) && ['revision','verification'].includes(entry.type)
      && typeof entry.id === 'string' && /^[a-f0-9]{32}$/.test(entry.id)
      && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)
      && !entries.has(`${entry.type}:${entry.id}`), '材料清单含无效或重复条目，未下载。');
    entries.set(`${entry.type}:${entry.id}`,entry.sha256);
  }
  const savedRevisions = new Map();
  for (const [type, records] of [['revision',bundle.revisions],['verification',bundle.verifications]]) {
    for (const record of records) {
      if (type === 'revision') await validateRevision(record);
      else {
        await validateVerificationRecord(record);
        requireThat(record.state !== 'running', '仍有验证正在进行，请结束后再导出材料。');
      }
      const id = type === 'revision' ? record.revisionId : record.verificationId;
      const text = JSON.stringify(record), key = `${type}:${id}`;
      requireThat(entries.has(key) && entries.get(key) === await sha256(text), '材料清单与记录身份或哈希不一致，未下载。');
      entries.delete(key); // A duplicate record cannot reuse the same manifest entry.
      if (type === 'revision') savedRevisions.set(id,text);
      else if (savedRevisions.has(record.revision.revisionId)) {
        requireThat(savedRevisions.get(record.revision.revisionId) === JSON.stringify(record.revision),
          '验证中的修订与材料包内同编号修订不一致，未下载。');
      }
    }
  }
  requireThat(entries.size === 0, '材料清单含未对应的记录，未下载。');
  return bundle;
}
