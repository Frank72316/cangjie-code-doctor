import { readRecord, compileView, sourceIsCurrent, validateSource, lineRange, MAX_REPORT_BYTES, MAX_SOURCE_BYTES } from './report.mjs';
import { validateTask, taskLabel } from './task.mjs';
import { initNavigation } from './navigation.mjs';
import { lineDiff, validateRevision } from './revision.mjs';
import { initVerificationUI } from './verification-ui.mjs';
import { validateDocumentEvidence, officialDocumentURL } from './document-evidence.mjs';
import { revisionHTML } from './revision-report.mjs';
const $ = id => document.getElementById(id);
let record = null;
let currentName = '';
let loading = 0;
let health = {available:false};
let selectedCase = null;
let loadingSample = false;
let compiling = false;
let compileController = null;
let historyTimer = null;
let historyRequest = 0;
let documentRequest = 0;
let documentController = null;
let retrievingDocuments = false;
let documentEvidence = null;
let documentEvidenceJSON = '';
// Retained only as an explicitly selectable reference for the original diagnosis.
// Editing still invalidates live document results and error locations.
let revisionReference = null;
let revisionSnapshot = null;
let savedRevision = null;
let savingRevision = false;
let revisionListRequest = 0;
let verificationUI = null;
function feedback(message = '') { $('feedback').textContent = message; $('feedback').hidden = !message; }
function element(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
function displayTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date) : '未记录';
}
function selectSample(name) {
  $('sample-select').value = name || '';
}
function current() { return sourceIsCurrent(record, currentName, $('source').value); }
function matchesEditor(snapshot) {
  return snapshot && snapshot.baseRecord === record && snapshot.source.name === currentName && snapshot.source.text === $('source').value;
}
function chosenReference() {
  return $('attach-document-evidence').checked && revisionReference?.baseRecord === record ? revisionReference.evidence : null;
}
function savedCurrent() { return matchesEditor(savedRevision) && (savedRevision.retrievalId || null) === (chosenReference()?.retrievalId || null); }
function allowSourceReplacement() {
  return !record || current() || savedCurrent() || window.confirm('当前修改尚未保存。继续会替换编辑框中的副本。要放弃这些未保存的修改吗？');
}
function revisionStatus(message = '') {
  $('revision-status').textContent = message; $('revision-status').hidden = !message;
}
function refreshRevisionControls() {
  const changed = record && !current();
  if (revisionSnapshot && (!matchesEditor(revisionSnapshot) || loadingSample)) {
    revisionSnapshot = null; $('revision-review').open = false;
    $('revision-diff').replaceChildren(); $('revision-count').textContent = '';
    revisionStatus('副本已变化，请重新展开差异，再确认保存。');
  }
  $('revision-review').hidden = !changed;
  $('revision-hint').textContent = savedCurrent() ? '当前修改已存到本机，可在“记录依据”中重新载入。' : '编辑后可查看差异，确认保存到本机。';
  $('save-revision').disabled = !health.token || !revisionSnapshot || !changed || savingRevision || loadingSample || savedCurrent();
  $('save-revision').textContent = savingRevision ? '正在保存…' : savedCurrent() ? '这份修改已保存' : '确认保存这份修改';
  const reference = revisionReference?.baseRecord === record ? revisionReference.evidence : null;
  $('revision-reference-option').hidden = !reference;
  $('revision-reference-empty').hidden = Boolean(reference);
  $('attach-document-evidence').disabled = savingRevision;
  $('revision-reference-summary').textContent = reference ? `附带原诊断的文档检索记录（${reference.results.length} 条摘录）` : '';
  $('revision-reference-detail').replaceChildren();
  if (reference) {
    $('revision-reference-detail').append(element('p', `SDK ${reference.sdkVersion} · ${reference.snapshotId}`),
      element('p', `查询：${reference.query || '（空）'}`), element('p', `检索编号：${reference.retrievalId}`, 'mono'));
    for (const hit of reference.results) {
      const item = element('details'); item.append(element('summary', hit.title), element('p', hit.text, 'reference-excerpt'));
      const link = element('a', '查看官方原文 ↗', 'context-link'); link.href = officialDocumentURL(hit.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
      item.append(link); $('revision-reference-detail').append(item);
    }
    if (!reference.results.length) $('revision-reference-detail').append(element('p', '该次检索没有命中；附带记录仅保存这次查询，不表示代码正确。'));
  }
  if (!changed) { $('revision-review').open = false; revisionSnapshot = null; revisionStatus(); }
}
function renderRevisionReview() {
  if (!record || current() || loadingSample) return;
  try {
    validateSource(currentName, $('source').value);
    revisionSnapshot = {baseRecord:record,source:{name:currentName,text:$('source').value}};
    const rows = lineDiff(record.source.text.replace(/\r\n?/g, '\n'), revisionSnapshot.source.text);
    const added = rows.filter(row => row.kind === 'add').length;
    const removed = rows.filter(row => row.kind === 'remove').length;
    $('revision-count').textContent = `+${added} / −${removed}`;
    $('revision-summary').textContent = `${record.source.name} → ${currentName} · 新增 ${added} 行，删除 ${removed} 行。空白末行也计入比较；原记录的换行格式仍完整保留。`;
    $('revision-diff').replaceChildren();
    for (const row of rows) {
      const line = element('div', '', `diff-line diff-${row.kind}`);
      line.append(element('span', String(row.beforeLine ?? ''), 'diff-number'), element('span', String(row.afterLine ?? ''), 'diff-number'),
        element('span', row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' ', 'diff-marker'), element('code', row.text || ' ', 'diff-code'));
      $('revision-diff').append(line);
    }
    revisionStatus(health.token ? '' : '未连接本机保存服务。可先在“源码操作”中下载副本，或检查环境后重试。');
  } catch (error) { revisionSnapshot = null; $('revision-diff').replaceChildren(); revisionStatus(error.message); }
  refreshRevisionControls();
}
async function readSavedRevision(id) {
  const response = await fetch(`/api/revisions/${id}`, {headers:{'X-Doctor-Token':health.token}});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '无法读取修改记录。');
  const revision = await validateRevision(data);
  if (revision.revisionId !== id) throw new Error('修改记录编号不匹配，未载入。');
  return revision;
}
async function refreshRevisions() {
  const request = ++revisionListRequest;
  $('refresh-revisions').disabled = true;
  try {
    if (!health.token) throw new Error('尚未连接本机修改记录服务。请在编译诊断页检查环境后重试。');
    const response = await fetch('/api/revisions', {headers:{'X-Doctor-Token':health.token}});
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.revisions)) throw new Error(data.error || '无法读取已保存修改。');
    if (request !== revisionListRequest) return;
    verificationUI?.setRevisions(data.revisions);
    $('revision-list').replaceChildren();
    for (const item of data.revisions) {
      if (!/^[a-f0-9]{32}$/.test(item.revisionId) || typeof item.sourceName !== 'string') throw new Error('修改记录索引无效。');
      const card = element('article', '', 'revision-card');
      const row = element('div', '', 'history-row'), info = element('div', '', 'history-info');
      info.append(element('strong', item.sourceName), element('span', `${displayTime(item.createdAt)} · 人工确认副本`, 'small-label'));
      const load = element('button', '载入这份修改');
      load.addEventListener('click', async () => {
        if (!allowSourceReplacement()) return;
        const ticket = ++loading, beforeRecord = record, beforeText = $('source').value, beforeName = currentName;
        loadingSample = true; refreshSource(); load.disabled = true;
        try {
          const revision = await readSavedRevision(item.revisionId);
          if (ticket !== loading || record !== beforeRecord || currentName !== beforeName || $('source').value !== beforeText) {
            feedback('读取期间编辑内容已变化，保留当前副本；可再次点击载入。'); return;
          }
          selectedCase = null; showRecord(revision.baseRecord); selectSample(null);
          currentName = revision.source.name; $('source').value = revision.source.text;
          revisionReference = revision.documentEvidence ? {baseRecord:record,evidence:structuredClone(revision.documentEvidence)} : null;
          $('attach-document-evidence').checked = Boolean(revisionReference);
          savedRevision = {baseRecord:record,source:revision.source,retrievalId:revision.documentEvidence?.retrievalId};
          refreshSource(); navigation.navigate('/diagnostics');
          $('revision-review').open = true; renderRevisionReview();
          feedback('已载入人工修改，右侧仍是原诊断。这份修改的独立验证结果请到“记录依据”查看；也可恢复记录原文。');
        } catch (error) { if (ticket === loading) feedback(error.message); }
        finally { load.disabled = false; if (ticket === loading) { loadingSample = false; refreshSource(); } }
      });
      row.append(info, load); card.append(row);
      const detail = element('details', '', 'task-detail');
      detail.append(element('summary', '记录信息与导出'), element('p', `原诊断源码：${item.baseName}`),
        element('p', `修改编号：${item.revisionId}`, 'mono'), element('p', `修改后 SHA-256：${item.sourceSha256}`, 'mono'));
      const save = element('button', '下载修改记录 JSON');
      save.addEventListener('click', async () => {
        save.disabled = true;
        try { const revision = await readSavedRevision(item.revisionId); download(`doctor-revision-${revision.revisionId}.json`, JSON.stringify(revision, null, 2), 'application/json'); }
        catch (error) { feedback(error.message); }
        finally { save.disabled = false; }
      });
      detail.append(save); card.append(detail); $('revision-list').append(card);
      const readable = element('button', '下载可读修改报告 HTML');
      readable.addEventListener('click', async () => {
        readable.disabled = true;
        try { const revision = await readSavedRevision(item.revisionId); download(`doctor-revision-${revision.revisionId}.html`, revisionHTML(revision), 'text/html;charset=utf-8'); }
        catch (error) { feedback(error.message); }
        finally { readable.disabled = false; }
      });
      detail.append(readable, element('p', item.documentEvidenceCount === undefined ? '旧版记录未附带文档依据。' :
        item.documentEvidenceCount === null ? '此修改未附带文档依据。' : `附带原诊断检索记录：${item.documentEvidenceCount} 条摘录。可读报告包含原文与来源。`));
    }
    if (!data.revisions.length) $('revision-list').append(element('p', '还没有保存的修改。先在编译诊断页编辑副本，展开差异并确认保存。', 'small-label'));
    if (data.unreadable) $('revision-list').prepend(element('p', `${data.unreadable} 份修改记录无法完整读取，原文件已保留。`, 'history-warning'));
  } catch (error) { if (request === revisionListRequest) $('revision-list').replaceChildren(element('p', error.message, 'small-label')); }
  finally { if (request === revisionListRequest) $('refresh-revisions').disabled = false; }
}
function documentStatus(message, state = 'idle') {
  $('document-status').textContent = message;
  $('document-status').dataset.state = state;
}
function resetDocumentEvidence(clearQuery = false) {
  ++documentRequest; documentController?.abort(); documentController = null;
  retrievingDocuments = false; documentEvidence = null; documentEvidenceJSON = '';
  $('document-results').replaceChildren(); $('document-metadata-list').replaceChildren();
  $('document-evidence-footer').hidden = true; $('document-export-note').hidden = true;
  $('document-metadata').open = false;
  if (clearQuery) { $('document-query').value = ''; revisionReference = null; $('attach-document-evidence').checked = false; }
  refreshQueryHint();
  documentStatus('当前记录尚未检索。');
}
function refreshDocumentControls() {
  const sameSource = current();
  if (!sameSource && (retrievingDocuments || documentEvidence)) resetDocumentEvidence();
  const ready = health.available && health.token && record && sameSource && !compiling && !health.busy && !loadingSample;
  $('compile-example').disabled = !health.available || !selectedCase || !sameSource || compiling || health.busy || retrievingDocuments || loadingSample;
  $('refresh-health').disabled = compiling || health.busy || retrievingDocuments;
  $('retrieve-documents').disabled = !ready || retrievingDocuments;
  $('retrieve-documents').textContent = retrievingDocuments ? '正在检索…' : '检索文档';
  $('document-query').disabled = !record || !sameSource || retrievingDocuments;
  $('export-document-evidence').disabled = !documentEvidence || !sameSource || retrievingDocuments;
  $('document-results').setAttribute('aria-busy', String(retrievingDocuments));
  if (!record) documentStatus('载入诊断记录后可检索。');
  else if (!sameSource) documentStatus('副本已修改，当前文档结果已清除。先前检索可在“查看修改并保存”中作为原诊断参考附带保存，不作为新代码的诊断。', 'changed');
  else if (!retrievingDocuments && !documentEvidence && $('document-status').dataset.state !== 'error') {
    if (!health.available || !health.token) documentStatus('仓颉核心暂未就绪。请到编译诊断页展开环境详情，点击“检查环境”重试。');
    else if (compiling || health.busy) documentStatus('本机任务进行中，完成后可检索文档。');
    else documentStatus('留空即可按当前诊断检索；也可输入关键词。检索范围为本机文档快照。');
  }
}
function refreshQueryHint() {
  const custom = Boolean($('document-query').value.trim());
  $('query-indicator').hidden = !custom;
  document.querySelector('.primary-search p').textContent = custom ? '将使用你填写的自定义关键词。清空后可按当前报错检索。' : '直接使用当前诊断，无需填写关键词。';
}
function renderDocumentEvidence(data) {
  const usedQuery = element('details', '', 'document-used-query');
  usedQuery.append(element('summary', data.queryOrigin === 'manual' ? '查看本次使用的关键词' : '查看本次使用的报错'),
    element('p', data.query || '（当前诊断没有可用于检索的文字）'));
  $('document-results').replaceChildren(usedQuery);
  for (const [index, result] of data.results.entries()) {
    const card = element('article', '', 'document-card');
    const reading = element('details', '', 'document-reading'); reading.open = index === 0;
    const heading = element('summary', '', 'document-card-heading');
    const title = element('h3', result.title);
    const link = element('a', '查看官方完整原文 ↗', 'document-source-link');
    link.href = officialDocumentURL(result.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
    heading.append(element('span', String(index + 1).padStart(2, '0'), 'document-number'), title, element('span', '原文摘录', 'document-toggle'));
    const details = element('details', '', 'document-score');
    details.append(element('summary', '来源、许可与匹配信息'), element('p', `BM25 匹配分数：${result.score.toFixed(4)}。分数用于当前查询内的排序，不是正确率或置信度。`),
      element('p', `条目：${result.id}`));
    const attribution = element('div', '', 'document-attribution');
    const license = element('a', 'CC BY 4.0');
    license.href = 'https://creativecommons.org/licenses/by/4.0/'; license.target = '_blank'; license.rel = 'noopener noreferrer';
    attribution.append(element('span', '仓颉官方文档贡献者 · '), license,
      element('p', 'Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.'),
      element('p', '原文逐字摘录，仅裁去首尾空白、统一换行；未翻译或改写。引用不代表上游作者认可或担保本工具。'));
    details.append(attribution);
    const excerpt = element('p', result.text, 'document-excerpt');
    excerpt.tabIndex = 0; excerpt.setAttribute('aria-label', '官方文档摘录，可滚动查看全文');
    reading.append(heading, element('p', result.section + ' · 长摘录可滚动阅读', 'document-section'), excerpt, link, details);
    card.append(reading);
    $('document-results').append(card);
  }
  const meta = [
    ['文档版本', `仓颉 ${data.sdkVersion}`], ['编译器版本', data.compilerVersion],
    ['生成时间 · 北京时间', displayTime(data.createdAt)], ['文档快照', data.snapshotId],
    ['官方文档修订', data.sourceRevision || '未提供'], ['检索算法', `BM25 · k1=${data.parameters.k1} · b=${data.parameters.b}`],
    ['实际检索查询', typeof data.effectiveQuery === 'string' ? data.effectiveQuery || '（空）' : '未提供'],
    ['查询扩展规则', typeof data.queryExpansion === 'string' ? data.queryExpansion : '未提供'],
    ['扩展方式', data.queryExpansion === 'compiler-glossary-v1' ? '固定双语词表将英文编译术语对应为中文检索词，追加到原查询后；保留原查询，不调用模型。' : '当前证据未提供已知扩展规则。'],
    ['分词器', typeof data.tokenizer === 'string' ? data.tokenizer : '未提供'],
    ['分词方式', data.tokenizer === 'ascii-lower-identifier+cjk-unigram-bigram-v1' ? 'ASCII 标识符转为小写；连续中文生成单字与相邻双字词元，标点和空白断开双字词元。' : '当前证据未提供已知分词规则。'],
    ['检索编号', data.retrievalId], ['源码 SHA-256', data.sourceSha256],
    ['原诊断 SHA-256', data.recordSha256], ['语料 SHA-256', data.corpusSha256],
  ];
  $('document-metadata-list').replaceChildren();
  for (const [name, value] of meta) $('document-metadata-list').append(element('dt', name), element('dd', value));
  $('document-evidence-footer').hidden = false; $('document-export-note').hidden = false;
  documentStatus(data.results.length ? `找到 ${data.results.length} 条文档摘录。请结合原文与当前源码核对；相关性排序不保证能够解释或修复错误。` :
    '本次查询在文档快照中没有命中。无匹配不表示源码正确，也不表示官方文档没有相关说明；可换用更具体的关键词。', 'ready');
}
function refreshSource() {
  const text = $('source').value;
  const lines = text.split('\n').length;
  $('line-numbers').textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n');
  $('line-count').textContent = `${lines} 行 / 200 行`;
  $('filename').textContent = currentName;
  $('source-state').textContent = current() ? '记录原文' : '已修改副本';
  $('source-state').classList.toggle('changed', !current());
  document.querySelectorAll('[data-current-source]').forEach(node => { node.textContent = record?.source.name || '尚未载入诊断'; });
  document.querySelectorAll('[data-current-state]').forEach(node => {
    node.textContent = record ? `${compileView(record).label} · ${current() ? '副本与记录一致' : '副本已修改，当前展示原诊断记录'}` : '请先在编译诊断页选择样例或打开记录。';
  });
  $('stale-notice').hidden = !record || current();
  for (const b of document.querySelectorAll('[data-location]')) b.disabled = !current();
  $('compile-example').disabled = !health.available || !selectedCase || !current() || compiling || health.busy;
  $('refresh-health').disabled = compiling || health.busy;
  $('compile-example').textContent = compiling ? '正在编译…' : '编译所选样例';
  $('cancel-compile').hidden = !compiling;
  $('sample-select').disabled = compiling || loadingSample;
  $('restore').hidden = !record || current();
  $('compile-guidance').textContent = loadingSample ? '正在载入样例…' :
    !record ? '尚未载入诊断，请从上方选择一个样例重试。' :
    !current() ? '副本已修改。请在源码下方查看差异并保存，再到“记录依据”验证已保存版本；此处仅编译审核样例。' :
    !selectedCase ? '当前为导入或历史记录。要发起新编译，请从上方选择审核样例。' :
    compiling || health.busy ? '本机任务进行中，请等待完成。' :
    retrievingDocuments ? '文档正在检索，完成后可编译。' :
    !health.available ? '编译环境暂不可用，请展开下方环境详情。已有记录仍可浏览。' :
    '当前展示已采集记录；点击编译，获取本次结果。';
  refreshDocumentControls();
  refreshRevisionControls();
  verificationUI?.refreshControls();
}
function showRecord(r) {
  loadingSample = false;
  revisionSnapshot = null; savedRevision = null; $('revision-review').open = false; revisionStatus();
  $('revision-count').textContent = ''; $('revision-diff').replaceChildren();
  resetDocumentEvidence(true);
  record = r; currentName = r.source.name; $('source').value = r.source.text;
  const view = compileView(r);
  $('diag-count').textContent = view.diagnostics.length;
  $('diag-count').setAttribute('aria-label',`${view.diagnostics.length} 条诊断`);
  $('compile-status').textContent = view.label; $('compile-status').className = `status ${view.status}`;
  $('compile-detail').textContent = view.detail; $('exit-code').textContent = `exit ${r.compiler.exitCode}`;
  $('sdk').textContent = r.compiler.version; $('captured').textContent = displayTime(r.capturedAt); $('captured').title = r.capturedAt ?? '';
  $('source-hash').textContent = r.source.sha256;
  $('stdout').textContent = r.compiler.stdout || '（空）'; $('stderr').textContent = r.compiler.stderr || '（空）';
  $('diagnostics').replaceChildren();
  for (const d of view.diagnostics) {
    const card = element('article', '', `diagnostic ${d.severity === 'warning' ? 'warning' : ''}`);
    const top = element('div', '', 'diagnostic-top'); top.append(element('span', d.severity.toUpperCase(), 'diag-severity'));
    if (d.canLocate) {
      const locate = element('button', `第 ${d.line} 行${d.column ? ` · ${d.column} 列` : ''} ↗`);
      locate.dataset.location = d.line;
      locate.addEventListener('click', () => {
        if (!current()) return;
        const range = lineRange($('source').value, d.line);
        if (!range) return;
        $('source').focus(); $('source').setSelectionRange(range.start, range.end);
        $('source').scrollTop = Math.max(0, (d.line - 3) * 25);
        $('line-numbers').scrollTop = $('source').scrollTop;
      });
      top.append(locate);
    } else { top.append(element('span', '位置不可用', 'small-label')); }
    card.append(top, element('h3', d.message));
    if (d.hint) card.append(element('p', d.hint));
    card.append(element('small', d.code || '未提供诊断代码')); $('diagnostics').append(card);
  }
  if (!view.diagnostics.length) {
    const empty = element('div', '', view.status === 'compile_passed' ? 'empty' : 'empty tool-empty');
    empty.append(element('strong', view.status === 'compile_passed' ? '编译器没有报告错误' : '没有可定位的结构化诊断'),
      element('p', view.status === 'compile_passed' ? '这只说明编译成功。程序行为需要通过独立测试进一步验证。' : '请保留并检查下面的原始日志，不将工具异常计为源码正确。'));
    $('diagnostics').append(empty);
  }
  refreshSource(); feedback();
}
async function loadCase(name) {
  if (!allowSourceReplacement()) { selectSample(selectedCase); return; }
  loadingSample = true;
  resetDocumentEvidence(true); refreshDocumentControls();
  const ticket = ++loading;
  refreshSource();
  try {
    const response = await fetch(`/fixtures/${name}.json`);
    if (!response.ok) throw new Error('未能读取样例记录，请先运行采集脚本。');
    const r = await readRecord(await response.text());
    if (ticket !== loading) return;
    selectedCase = name; showRecord(r);
    selectSample(name);
  } catch (e) { if (ticket === loading) { selectSample(selectedCase); feedback(e.message); } }
  finally { if (ticket === loading) { loadingSample = false; refreshSource(); } }
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function fileText(file, limit) {
  if (file.size > limit) throw new Error('文件过大，未载入。');
  return new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer());
}
$('sample-select').addEventListener('change', event => loadCase(event.target.value));
$('document-query').addEventListener('input', refreshQueryHint);
document.querySelectorAll('.action-menu button').forEach(button => button.addEventListener('click', () => {
  const menu = button.closest('details'); menu.open = false; menu.querySelector('summary').focus();
}));
document.querySelectorAll('.action-menu').forEach(menu => menu.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
}));
$('source').addEventListener('input', () => {
  // Typing supersedes pending file/sample/revision reads, even if the user later
  // restores the same text. An older async response must not replace new input.
  ++loading; loadingSample = false; selectSample(selectedCase); refreshSource();
});
$('source').addEventListener('scroll', () => { $('line-numbers').scrollTop = $('source').scrollTop; });
$('restore').addEventListener('click', () => { if (record && allowSourceReplacement()) { ++loading; loadingSample = false; selectSample(selectedCase); currentName = record.source.name; $('source').value = record.source.text; savedRevision = null; refreshSource(); feedback('已恢复原诊断对应的源码副本；已保存修改仍保留在记录依据页。'); } });
$('import-source').addEventListener('click', () => $('source-file').click());
$('import-record').addEventListener('click', () => $('record-file').click());
$('source-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (!allowSourceReplacement()) return;
  resetDocumentEvidence(true); refreshDocumentControls();
  const ticket = ++loading;
  loadingSample = false;
  selectSample(selectedCase); refreshSource();
  try {
    const text = validateSource(file.name, await fileText(file, MAX_SOURCE_BYTES));
    if (ticket !== loading) return;
    resetDocumentEvidence(true);
    currentName = file.name; $('source').value = text; refreshSource();
    selectedCase = null; refreshSource();
    selectSample(null);
    feedback('已导入编辑副本。核对差异并保存后，可在“记录依据”中查看容器验证是否就绪。');
  } catch (e) { if (ticket === loading) feedback(e.message); }
});
$('record-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  if (!allowSourceReplacement()) return;
  resetDocumentEvidence(true); refreshDocumentControls();
  const ticket = ++loading;
  loadingSample = false;
  selectSample(selectedCase); refreshSource();
  try {
    const r = await readRecord(await fileText(file, MAX_REPORT_BYTES));
    if (ticket !== loading) return;
    selectedCase = null; showRecord(r); selectSample(null);
  } catch (e) { if (ticket === loading) feedback(e.message); }
});
$('save-source').addEventListener('click', () => {
  try { validateSource(currentName, $('source').value); download(currentName.replace(/\.cj$/i, '') + '.copy.cj', $('source').value, 'text/plain;charset=utf-8'); }
  catch (e) { feedback(e.message); }
});
$('export-record').addEventListener('click', () => { if (record) download(record.source.name + '.diagnostic.json', JSON.stringify(record, null, 2), 'application/json'); });
$('revision-review').addEventListener('toggle', () => {
  if ($('revision-review').open) renderRevisionReview();
  else { revisionSnapshot = null; $('revision-count').textContent = ''; $('revision-diff').replaceChildren(); refreshRevisionControls(); }
});
$('attach-document-evidence').addEventListener('change', refreshRevisionControls);
$('save-revision').addEventListener('click', async () => {
  if (!matchesEditor(revisionSnapshot) || !health.token || savingRevision || savedCurrent() || loadingSample) return;
  const snapshot = revisionSnapshot, originalJSON = JSON.stringify(snapshot.baseRecord);
  const reference = chosenReference();
  const referenceJSON = reference ? JSON.stringify(reference) : null;
  savingRevision = true; refreshRevisionControls(); revisionStatus('正在保存已确认的修改…');
  try {
    const response = await fetch('/api/revisions', {method:'POST', headers:{'Content-Type':'application/json','X-Doctor-Token':health.token},
      body:JSON.stringify({...snapshot,confirmed:true,...(reference ? {retrievalId:reference.retrievalId} : {})})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '保存失败。');
    const revision = await validateRevision(data);
    if (JSON.stringify(revision.baseRecord) !== originalJSON || revision.source.name !== snapshot.source.name || revision.source.text !== snapshot.source.text)
      throw new Error('返回的修改记录与确认内容不符，未标记为已保存。');
    if ((revision.documentEvidence ? JSON.stringify(revision.documentEvidence) : null) !== referenceJSON)
      throw new Error('返回的文档依据与本次确认不一致，未标记为已保存。');
    if (matchesEditor(snapshot) && (chosenReference()?.retrievalId || null) === (reference?.retrievalId || null)) {
      savedRevision = {...snapshot,retrievalId:reference?.retrievalId};
      revisionStatus(`已保存到本机${reference ? '，并附带原诊断文档依据' : ''}。可到“记录依据”下载可读修改报告，或填写公开测试并查看验证环境。当前保存操作未执行编译或测试。`);
    } else feedback('刚才确认的版本已保存到“记录依据”。当前编辑内容另有变化，请重新审阅后保存。');
    await refreshRevisions();
  } catch (error) {
    const message = `${error.message} 未确认保存成功。请先刷新“记录依据”中的修改记录核对，再决定是否重试；当前副本仍保留。`;
    if (matchesEditor(snapshot)) revisionStatus(message); else feedback(message);
  } finally { savingRevision = false; refreshRevisionControls(); }
});
$('refresh-revisions').addEventListener('click', refreshRevisions);
window.addEventListener('beforeunload', event => {
  if (record && !current() && !savedCurrent()) { event.preventDefault(); event.returnValue = ''; }
});
$('document-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!health.available || !health.token || !record || !current() || compiling || health.busy || retrievingDocuments) return;
  const query = $('document-query').value.trim();
  if (query.length > 2000) { documentStatus('检索关键词不能超过 2000 个字符。', 'error'); return; }
  resetDocumentEvidence();
  revisionReference = null; $('attach-document-evidence').checked = false;
  const ticket = ++documentRequest, originalRecord = record;
  const controller = new AbortController(); documentController = controller; retrievingDocuments = true;
  documentStatus('正在由仓颉核心检索本机文档快照…', 'loading'); refreshDocumentControls();
  try {
    const response = await fetch('/api/retrieve', {method:'POST', headers:{'Content-Type':'application/json','X-Doctor-Token':health.token},
      body:JSON.stringify({record:originalRecord, query}), signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '文档检索失败，请稍后重试。');
    await validateDocumentEvidence(data, originalRecord);
    if (ticket !== documentRequest || record !== originalRecord || !current()) return;
    documentEvidence = data; documentEvidenceJSON = JSON.stringify(data, null, 2);
    revisionReference = {baseRecord:originalRecord,evidence:structuredClone(data)};
    $('attach-document-evidence').checked = true;
    renderDocumentEvidence(data);
  } catch (error) {
    if (ticket === documentRequest && record === originalRecord && current())
      documentStatus(error.name === 'AbortError' ? '本次检索已取消，可重新检索。' : error.message, 'error');
  } finally {
    if (ticket === documentRequest) { retrievingDocuments = false; documentController = null; refreshDocumentControls(); }
  }
});
$('export-document-evidence').addEventListener('click', () => {
  if (!documentEvidence || !current() || retrievingDocuments) return;
  download(`${record.source.name}.document-evidence.json`, documentEvidenceJSON, 'application/json');
});
async function refreshHealth(recheck = false) {
  $('refresh-health').disabled = true;
  try {
    let response = await fetch('/api/health');
    if (!response.ok) throw new Error('环境接口不可用。');
    health = await response.json();
    if (recheck && health.token && !health.busy) {
      response = await fetch('/api/probe', {method:'POST',headers:{'X-Doctor-Token':health.token}});
      if (!response.ok) throw new Error('环境接口不可用。');
      health = await response.json();
    }
    $('runtime-title').textContent = health.available ? '本机编译已就绪' : '本机编译暂不可用';
    $('runtime-detail').textContent = health.detail;
  } catch {
    health = {available:false}; $('runtime-title').textContent = '记录预览模式';
    $('runtime-detail').textContent = '当前服务没有连接仓颉核心，可继续浏览已采集记录。';
  }
  $('refresh-health').disabled = false;
  document.body.dataset.runtime = health.available ? 'ready' : 'unavailable';
  $('runtime-summary').textContent = health.available ? '环境详情' : '查看原因';
  if (!health.available) $('environment').open = true;
  refreshSource();
  verificationUI?.refreshControls();
}
async function refreshHistory() {
  const request = ++historyRequest;
  clearTimeout(historyTimer);
  try {
    if (!health.token) { $('history').replaceChildren(element('p','当前服务未启用本机任务历史。','small-label')); return; }
    const response = await fetch('/api/history', {headers:{'X-Doctor-Token':health.token}});
    if (!response.ok) throw new Error('无法读取本机任务历史。');
    const data = await response.json();
    const tasks = []; let unreadable = data.unreadable || 0;
    for (const item of data.tasks) {
      try {
        validateTask(item);
        if (item.record) item.record = await readRecord(JSON.stringify(item.record));
        tasks.push(item);
      } catch { unreadable++; }
    }
    if (request !== historyRequest) return;
    health.busy = data.busy; refreshSource();
    const expanded = new Set([...document.querySelectorAll('[data-task-detail][open]')].map(e=>e.dataset.taskDetail));
    $('history').replaceChildren();
    for (const item of tasks) {
      const card = element('article','', 'history-card');
      card.dataset.state = item.state === 'completed' && item.record ? item.record.normalized.status : item.state;
      const row = element('div','', 'history-row');
      const info = element('div','', 'history-info');
      const time = element('span',displayTime(item.startedAt) + ' · 北京时间','small-label'); time.title = item.startedAt;
      info.append(element('strong',`${item.caseId}.cj · ${taskLabel(item)}`),time);
      const actions = element('div','', 'actions');
      if (item.record) {
        const load = element('button',item.state === 'completed' ? '载入记录副本' : '查看已保存诊断');
        load.addEventListener('click', () => { if (!allowSourceReplacement()) return; ++loading; selectedCase = null; showRecord(item.record);
          selectSample(null);
          navigation.navigate('/diagnostics');
          if (item.state !== 'completed') feedback('已载入当时保存的诊断；任务状态仍为“' + taskLabel(item) + '”，以历史记录为准。'); });
        actions.append(load);
      }
      const save = element('button','导出任务记录');
      save.addEventListener('click',()=>download(`doctor-task-${item.taskId}.json`,JSON.stringify(item,null,2),'application/json'));
      row.append(info,actions);
      const detail = element('details','', 'task-detail'); detail.dataset.taskDetail = item.taskId; detail.open = expanded.has(item.taskId);
      detail.append(element('summary','任务详情与日志'),element('p',item.detail),element('p',`任务编号：${item.taskId}`,'mono'),
        element('p',`结束时间：${item.finishedAt || '未确认'} · 原因：${item.reason || '正常完成'}`,'small-label'));
      if (item.process) {
        detail.append(element('p',`核心退出码：${item.process.exitCode ?? '未返回'} · 信号：${item.process.signal || '无'}`,'small-label'));
      }
      detail.append(save);
      const logs = {...(item.logs || {})};
      if (item.process) { logs['核心 stdout'] = item.process.stdout; logs['核心 stderr'] = item.process.stderr; }
      for (const [name,log] of Object.entries(logs)) {
        if (!log || typeof log.text !== 'string') continue;
        detail.append(element('h3',name + (log.truncated ? '（仅保留前 16 KiB）' : '')),element('pre',log.text || '（空）'));
      }
      card.append(row,detail); $('history').append(card);
    }
    if (unreadable) $('history').prepend(element('p',`${unreadable} 份任务或诊断文件无法完整读取，原文件已保留；不能将缺失结果计为成功。`,'history-warning'));
    if (!tasks.length) {
      const empty = element('div','','history-empty'), icon = element('span','↺','history-empty-icon'); icon.setAttribute('aria-hidden','true');
      const copy = element('div',''); copy.append(element('strong','还没有本机编译任务'),element('p','发起任务后，结果与过程记录会保存在这里。'));
      empty.append(icon,copy); $('history').append(empty);
    }
    if (data.busy) historyTimer = setTimeout(refreshHistory,1000);
  } catch (e) {
    if (request === historyRequest) {
      $('history').replaceChildren(element('p',e.message + ' 请到编译诊断页展开环境详情，点击“检查环境”重新连接服务。','small-label'));
      health.busy = false; refreshSource();
    }
  }
}
$('refresh-health').addEventListener('click', async () => { await refreshHealth(true); await Promise.all([refreshHistory(), refreshRevisions(), verificationUI.refresh()]); });
$('refresh-history').addEventListener('click', refreshHistory);
$('cancel-compile').addEventListener('click', () => compileController?.abort());
$('compile-example').addEventListener('click', async () => {
  if (!selectedCase || !current() || !health.available || compiling) return;
  const sourceAtStart = $('source').value, nameAtStart = currentName, caseAtStart = selectedCase;
  const ticket = ++loading;
  compiling = true; health.busy = true; compileController = new AbortController(); refreshSource(); feedback('正在由仓颉核心编译审核样例，不会运行生成的程序。');
  historyTimer = setTimeout(refreshHistory,500);
  try {
    const response = await fetch('/api/compile-example', {method:'POST', headers:{'Content-Type':'application/json','X-Doctor-Token':health.token},
      body:JSON.stringify({caseId:caseAtStart}), signal:compileController.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '编译任务失败。');
    const result = await readRecord(JSON.stringify(data));
    if (ticket === loading && currentName === nameAtStart && $('source').value === sourceAtStart) {
      selectedCase = caseAtStart; showRecord(result); feedback('已完成本次编译，诊断及源码快照已写入本机历史。');
    } else { feedback('本次编译已保存到历史。当前副本已有变化，因此保留你的编辑。'); }
  } catch (e) { feedback(e.name === 'AbortError' ? '已请求取消，正在确认最终状态；若任务先完成，会保留实际结果。请到任务历史页查看。' : e.message); }
  finally { compiling = false; compileController = null; refreshSource(); await refreshHistory(); }
});
const navigation = initNavigation();
verificationUI = initVerificationUI({getHealth:() => health, refreshHealth:() => refreshHealth(), download,
  onActivityChange:active => { if (active) health.busy = true; refreshSource(); }});
loadCase('type_mismatch');
refreshHealth().then(() => Promise.all([refreshHistory(), refreshRevisions(), verificationUI.refresh()]));
