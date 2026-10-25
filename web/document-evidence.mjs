// Shared validation and presentation for archived references to the ORIGINAL diagnosis.
// The server checks excerpts against its pinned corpus before attaching them to a revision.
import { readRecord, compileView, sha256 } from './report.mjs';

export const MAX_DOCUMENT_EVIDENCE_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const hashPattern = /^[a-f0-9]{64}$/;
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.length > 0) && !value.includes('\0');
const requireThat = (valid, message) => { if (!valid) throw new Error(message); };
export function officialDocumentURL(value) {
  requireThat(text(value,2048), '检索依据含无效的官方文档链接。');
  const url = new URL(value);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (url.hostname === 'docs.cangjie-lang.cn' ||
      (url.hostname === 'github.com' && url.pathname.startsWith('/cangjielanguage/cangjie_docs/'))),
    '检索依据含无效的官方文档链接。');
  return url.href;
}

export async function validateDocumentEvidence(evidence, baseRecord) {
  requireThat(exact(evidence,['schemaVersion','sdkVersion','snapshotId','sourceRevision','algorithm','parameters',
    'query','effectiveQuery','queryExpansion','tokenizer','topK','results','kind','retrievalId','createdAt',
    'sourceName','sourceSha256','recordSha256','compilerVersion','corpusSha256','queryOrigin']),
    '不支持的文档依据字段。');
  requireThat(encoder.encode(JSON.stringify(evidence)).length <= MAX_DOCUMENT_EVIDENCE_BYTES, '文档依据超过 64 KiB。');
  requireThat(evidence.schemaVersion === 1 && evidence.kind === 'doctor-document-evidence'
    && /^[a-f0-9]{32}$/.test(evidence.retrievalId) && typeof evidence.retrievalId === 'string'
    && typeof evidence.createdAt === 'string' && Number.isFinite(Date.parse(evidence.createdAt))
    && new Date(evidence.createdAt).toISOString() === evidence.createdAt
    && evidence.sdkVersion === '1.0.5' && text(evidence.snapshotId,128) && text(evidence.sourceRevision,128)
    && evidence.algorithm === 'bm25' && exact(evidence.parameters,['k1','b'])
    && evidence.parameters.k1 === 1.2 && evidence.parameters.b === 0.75 && evidence.topK === 3
    && evidence.queryExpansion === 'compiler-glossary-v1'
    && evidence.tokenizer === 'ascii-lower-identifier+cjk-unigram-bigram-v1'
    && text(evidence.query,2000,true) && text(evidence.effectiveQuery,4000,true)
    && ['manual','diagnostics'].includes(evidence.queryOrigin)
    && typeof evidence.corpusSha256 === 'string' && hashPattern.test(evidence.corpusSha256)
    && Array.isArray(evidence.results) && evidence.results.length <= 3,
    '文档依据的版本、查询或检索参数无效。');
  await readRecord(JSON.stringify(baseRecord));
  requireThat(/^Cangjie Compiler: 1\.0\.5(?:\s|$)/.test(baseRecord.compiler.version)
    && compileView(baseRecord).status !== 'tool_error' && evidence.sourceName === baseRecord.source.name
    && evidence.sourceSha256 === baseRecord.source.sha256 && evidence.compilerVersion === baseRecord.compiler.version
    && evidence.recordSha256 === await sha256(JSON.stringify(baseRecord)), '文档依据与原诊断记录不一致。');
  if (evidence.queryOrigin === 'diagnostics') {
    const expected = compileView(baseRecord).diagnostics.map(d => `${d.code} ${d.message} ${d.hint}`).join('\n').slice(0,2000).trim();
    requireThat(evidence.query === expected, '文档依据的查询与原诊断不一致。');
  } else requireThat(evidence.query === evidence.query.trim() && evidence.query.length > 0, '手动检索查询无效。');
  const ids = new Set(); let previous = Infinity;
  for (const result of evidence.results) {
    requireThat(exact(result,['id','title','url','section','text','score']) && text(result.id,80)
      && /^[a-zA-Z0-9_-]+$/.test(result.id) && !ids.has(result.id)
      && text(result.title,512) && text(result.section,512) && text(result.text,2500)
      && Number.isFinite(result.score) && result.score > 0 && result.score <= previous,
      '文档摘录、条目或匹配分数无效。');
    officialDocumentURL(result.url); ids.add(result.id); previous = result.score;
  }
  return evidence;
}

const escape = value => String(value).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function documentEvidenceHTML(evidence) {
  if (evidence == null) return '<section class="document-evidence-report"><h2>原诊断文档依据</h2><p>本次修改未附带文档检索依据；不能据此推断未参考文档。</p></section>';
  const citations = evidence.results.map((result,index) => `<article><h3>${index + 1}. ${escape(result.title)} · ${escape(result.section)}</h3>
<p>条目：${escape(result.id)}；BM25 分数：${escape(result.score)}（排序分数，不是正确率）</p>
<pre>${escape(result.text)}</pre><p><a href="${escape(officialDocumentURL(result.url))}" target="_blank" rel="noopener noreferrer">查看官方完整原文</a></p></article>`).join('');
  return `<section class="document-evidence-report"><h2>原诊断文档依据</h2>
<p>以下是人工保存时附带的原诊断检索结果，不是修改后源码的新诊断，也不证明修改正确或已通过测试。</p>
<p>检索编号：<code>${escape(evidence.retrievalId)}</code>；检索时间：${escape(evidence.createdAt)}</p>
<p>SDK：${escape(evidence.sdkVersion)}；文档快照：${escape(evidence.snapshotId)}；官方文档修订：<code>${escape(evidence.sourceRevision)}</code></p>
<p>原源码：${escape(evidence.sourceName)}；源码 SHA-256：<code>${escape(evidence.sourceSha256)}</code>；编译器：${escape(evidence.compilerVersion)}</p>
<p>原诊断 SHA-256：<code>${escape(evidence.recordSha256)}</code>；语料 SHA-256：<code>${escape(evidence.corpusSha256)}</code></p>
<details><summary>查询与检索参数</summary><p>来源：${evidence.queryOrigin === 'manual' ? '自定义关键词' : '原诊断报错'}</p>
<pre>${escape(evidence.query || '（空查询）')}</pre><p>实际查询：</p><pre>${escape(evidence.effectiveQuery || '（空查询）')}</pre>
<p>BM25：k1=${escape(evidence.parameters.k1)}，b=${escape(evidence.parameters.b)}；topK=${escape(evidence.topK)}；扩展规则：${escape(evidence.queryExpansion)}；分词器：${escape(evidence.tokenizer)}</p></details>
${citations || '<p>该次查询没有命中；无匹配不表示源码正确或官方文档没有相关说明。</p>'}
<p>文档贡献者：仓颉官方文档贡献者。Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.
<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>。原文逐字摘录，仅裁去首尾空白、统一换行；未翻译或改写。引用不代表上游作者认可或担保本工具。</p></section>`;
}
