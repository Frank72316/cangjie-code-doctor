import { readRecord, compileView, sourceIsCurrent, validateSource, lineRange, MAX_REPORT_BYTES, MAX_SOURCE_BYTES } from './report.mjs';
const $ = id => document.getElementById(id);
let record = null;
let currentName = '';
let loading = 0;
function feedback(message = '') { $('feedback').textContent = message; $('feedback').hidden = !message; }
function element(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
function current() { return sourceIsCurrent(record, currentName, $('source').value); }
function refreshSource() {
  const text = $('source').value;
  const lines = text.split('\n').length;
  $('line-numbers').textContent = Array.from({length: lines}, (_, i) => i + 1).join('\n');
  $('line-count').textContent = `${lines} 行 / 200 行`;
  $('filename').textContent = currentName;
  $('source-state').textContent = current() ? '记录原文' : '未编译副本';
  $('source-state').classList.toggle('changed', !current());
  $('stale-notice').hidden = !record || current();
  for (const b of document.querySelectorAll('[data-location]')) b.disabled = !current();
}
function showRecord(r) {
  record = r; currentName = r.source.name; $('source').value = r.source.text;
  const view = compileView(r);
  $('compile-status').textContent = view.label; $('compile-status').className = `status ${view.status}`;
  $('compile-detail').textContent = view.detail; $('exit-code').textContent = `exit ${r.compiler.exitCode}`;
  $('sdk').textContent = r.compiler.version; $('captured').textContent = r.capturedAt ?? '未记录';
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
    const empty = element('div', '', 'empty');
    empty.append(element('strong', view.status === 'compile_passed' ? '编译器没有报告错误' : '没有可定位的结构化诊断'),
      element('p', view.status === 'compile_passed' ? '这只说明编译成功。程序行为需要通过独立测试进一步验证。' : '请保留并检查下面的原始日志，不将工具异常计为源码正确。'));
    $('diagnostics').append(empty);
  }
  refreshSource(); feedback();
}
async function loadCase(name) {
  const ticket = ++loading;
  try {
    const response = await fetch(`/fixtures/${name}.json`);
    if (!response.ok) throw new Error('未能读取样例记录，请先运行采集脚本。');
    const r = await readRecord(await response.text());
    if (ticket !== loading) return;
    showRecord(r);
    document.querySelectorAll('[data-case]').forEach(b => b.classList.toggle('active', b.dataset.case === name));
  } catch (e) { if (ticket === loading) feedback(e.message); }
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
document.querySelectorAll('[data-case]').forEach(b => b.addEventListener('click', () => loadCase(b.dataset.case)));
$('source').addEventListener('input', refreshSource);
$('source').addEventListener('scroll', () => { $('line-numbers').scrollTop = $('source').scrollTop; });
$('restore').addEventListener('click', () => { if (record) { currentName = record.source.name; $('source').value = record.source.text; refreshSource(); feedback(); } });
$('import-source').addEventListener('click', () => $('source-file').click());
$('import-record').addEventListener('click', () => $('record-file').click());
$('source-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const ticket = ++loading;
  try {
    const text = validateSource(file.name, await fileText(file, MAX_SOURCE_BYTES));
    if (ticket !== loading) return;
    currentName = file.name; $('source').value = text; refreshSource();
    document.querySelectorAll('[data-case]').forEach(b => b.classList.remove('active'));
    feedback('已导入本地副本。本预览不会编译或执行导入的源码。');
  } catch (e) { if (ticket === loading) feedback(e.message); }
});
$('record-file').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const ticket = ++loading;
  try {
    const r = await readRecord(await fileText(file, MAX_REPORT_BYTES));
    if (ticket !== loading) return;
    showRecord(r); document.querySelectorAll('[data-case]').forEach(b => b.classList.remove('active'));
  } catch (e) { if (ticket === loading) feedback(e.message); }
});
$('save-source').addEventListener('click', () => {
  try { validateSource(currentName, $('source').value); download(currentName.replace(/\.cj$/i, '') + '.copy.cj', $('source').value, 'text/plain;charset=utf-8'); }
  catch (e) { feedback(e.message); }
});
$('export-record').addEventListener('click', () => { if (record) download(record.source.name + '.diagnostic.json', JSON.stringify(record, null, 2), 'application/json'); });
loadCase('type_mismatch');
