// Call only after validateRevision. This export describes an acknowledged edit,
// never an execution result. It remains readable without the local service.
import { compileView } from './report.mjs';
import { lineDiff } from './revision.mjs';
import { documentEvidenceHTML } from './document-evidence.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function revisionHTML(revision) {
  const base = revision.baseRecord, diagnosis = compileView(base);
  const diff = lineDiff(base.source.text, revision.source.text).map(row =>
    `${row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '} ${row.text}`).join('\n');
  const diagnostics = diagnosis.diagnostics.map(item => `<li><strong>${escape(item.message)}</strong><p>${escape(item.hint)}</p><p>诊断代码：${escape(item.code || '未提供')}；位置：${escape(item.line ?? '未提供')} 行、${escape(item.column ?? '未提供')} 列。</p></li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Doctor 人工修改与文档依据</title><style>body{max-width:1080px;margin:40px auto;padding:0 22px;font:15px/1.8 system-ui,sans-serif;color:#18352b;background:#f6f8f4}h1{font-size:28px}h2{font-size:21px}section{background:white;border:1px solid #d9e2da;border-radius:12px;padding:22px;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eff3ef;padding:14px;border-radius:6px}code,p,a,li{overflow-wrap:anywhere}a{color:#13795c}.scope{color:#59685f}.status{padding:12px 16px;background:#fff3da;border-left:3px solid #b48b45}summary{cursor:pointer}details{margin-top:14px}@media(max-width:700px){body{margin:20px auto;padding:0 15px}section{padding:17px}h1{font-size:24px}}@media print{body{background:white}section{break-inside:avoid}}</style></head><body>
<p>Doctor · 离线开发记录</p><h1>人工修改与文档依据</h1><p class="status"><strong>保存时状态：未编译 · 未测试</strong>。此报告只记录人工确认的修改与附带的原诊断参考文档。</p>
<section><h2>记录身份</h2><p>修订编号：<code>${escape(revision.revisionId)}</code></p><p>保存时间（UTC）：${escape(revision.createdAt)}</p><p>修改源码：${escape(revision.source.name)}；SHA-256：<code>${escape(revision.source.sha256)}</code></p><p>原诊断记录 SHA-256：<code>${escape(revision.recordSha256)}</code></p><p>原诊断编译器：${escape(base.compiler.version)}</p></section>
<section><h2>修改前的诊断</h2><p>原文件：${escape(base.source.name)}；原诊断采集时间：${escape(base.capturedAt || '未记录')}</p><p>${escape(diagnosis.label)}：${escape(diagnosis.detail)}</p>${diagnostics ? `<ul>${diagnostics}</ul>` : '<p>原记录没有可展示的结构化诊断。</p>'}<details><summary>原诊断完整源码与编译器输出</summary><h3>原源码</h3><pre>${escape(base.source.text)}</pre><h3>stderr</h3><pre>${escape(base.compiler.stderr || '（空）')}</pre><h3>stdout</h3><pre>${escape(base.compiler.stdout || '（空）')}</pre></details></section>
<section><h2>已确认的源码差异</h2><p>− 表示删除；+ 表示新增。空白末行也参与比较。</p><pre>${escape(diff)}</pre><details><summary>修改后的完整源码</summary><pre>${escape(revision.source.text)}</pre></details></section>
${revision.documentEvidence ? `<p class="scope">文档依据 SHA-256：<code>${escape(revision.documentEvidenceSha256)}</code></p>` : ''}${documentEvidenceHTML(revision.documentEvidence)}
<section><h2>结论范围</h2><p>原诊断属于修改前的源码。文档检索只是原诊断的参考，附带引用不证明人工修改正确，也不证明已经编译或测试。后续验证结果须查看对应的独立公开测试报告。</p><p class="scope">此报告没有 AI 修复、保留测试或正式 A/B 成绩。记录没有数字签名，哈希用于一致性核对，不证明外部来源真实性。已保存副本可能与编辑器当前内容不同。</p></section></body></html>`;
}
