// Read-only local-file review. Validation proves consistency, not provenance.
import { validateEvidenceBundle, MAX_EVIDENCE_BUNDLE_BYTES } from './evidence-bundle.mjs';
import { validateRevision } from './revision.mjs';
import { validateVerificationRecord, verificationView, verificationHTML } from './verification.mjs';
import { compileView, sha256 } from './report.mjs';
import { revisionHTML } from './revision-report.mjs';

export const MAX_REVIEW_BYTES = MAX_EVIDENCE_BUNDLE_BYTES;
export async function readEvidenceReview(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_REVIEW_BYTES)
    throw new Error('文件超过 32 MiB，无法打开。');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('不是有效的 JSON 文件。'); }
  let revisions = [], verifications = [];
  if (data?.kind === 'doctor-evidence-bundle') {
    await validateEvidenceBundle(data); ({revisions, verifications} = data);
  } else if (data?.kind === 'doctor-manual-revision') revisions = [await validateRevision(data)];
  else if (data?.kind === 'doctor-revision-verification') verifications = [await validateVerificationRecord(data)];
  else throw new Error('请选择修改报告、独立验证报告或修改与验证材料包 JSON。诊断 JSON 请使用“打开诊断记录”。');
  // Even when a bundle contains no standalone revision, same-ID embedded
  // revisions must agree. Never silently choose one of two conflicting copies.
  const identities = new Map();
  for (const revision of [...revisions, ...verifications.map(v => v.revision)]) {
    const serialized = JSON.stringify(revision);
    if (identities.has(revision.revisionId) && identities.get(revision.revisionId) !== serialized)
      throw new Error('材料中同编号修改的内容不一致，无法回看。');
    identities.set(revision.revisionId, serialized);
  }
  const tested = new Set(verifications.map(v => v.revision.revisionId));
  const entries = [
    ...verifications.map(verification => ({revision:verification.revision, verification})),
    ...revisions.filter(r => !tested.has(r.revisionId)).map(revision => ({revision, verification:null}))
  ].sort((a,b) => (b.verification?.createdAt || b.revision.createdAt).localeCompare(a.verification?.createdAt || a.revision.createdAt));
  return {entries, fileSha256:await sha256(text), exportedAt:data.kind === 'doctor-evidence-bundle' ? data.exportedAt : null};
}

export function reviewOutcome(entry) {
  return entry.verification ? verificationView(entry.verification) : {
    label:'仅保存修改 · 未附验证记录', tone:'warning', compileLabel:'未提供后续编译记录', testLabel:'未提供后续测试记录',
    detail:'保存时未编译、未测试；此文件没有附带后续独立验证，不能据此判断修改是否正确。'
  };
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reviewHTML(entry) {
  const banner = '<p class="status"><strong>已有报告回看 · 本次没有执行程序</strong></p><p class="scope">文件中的时间、源码和结论按原记录展示。内容一致性校验不是数字签名，不能证明来源真实；不是 AI 修复、学生试用或正式 A/B 结果。</p>';
  if (!entry.verification) return revisionHTML(entry.revision).replace('<body>',`<body>${banner}`);
  const original = compileView(entry.revision.baseRecord);
  const diagnosis = `<section><h2>修改前的诊断</h2><p>${escape(original.label)} · ${escape(entry.revision.baseRecord.capturedAt || '采集时间未记录')}</p>${original.diagnostics.map(d => `<p>第 ${escape(d.line ?? '未知')} 行：${escape(d.message)}</p>`).join('')}<details><summary>修改前源码</summary><pre>${escape(entry.revision.baseRecord.source.text)}</pre></details></section>`;
  return verificationHTML(entry.verification).replace('<body>',`<body>${banner}${diagnosis}`);
}
