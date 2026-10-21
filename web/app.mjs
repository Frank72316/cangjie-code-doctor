import { readRecord, compileView, sourceIsCurrent, validateSource, lineRange, MAX_REPORT_BYTES, MAX_SOURCE_BYTES } from './report.mjs';
import { validateTask, taskLabel } from './task.mjs';
const $ = id => document.getElementById(id);
let record = null;
let currentName = '';
let loading = 0;
let health = {available:false};
let selectedCase = null;
let compiling = false;
let compileController = null;
let historyTimer = null;
let historyRequest = 0;
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
  $('compile-example').disabled = !health.available || !selectedCase || !current() || compiling || health.busy;
  $('refresh-health').disabled = compiling || health.busy;
  $('compile-example').textContent = compiling ? '正在编译…' : '重新编译此样例';
  $('cancel-compile').hidden = !compiling;
  document.querySelectorAll('[data-case]').forEach(b => b.disabled = compiling);
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
    selectedCase = name; showRecord(r);
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
    selectedCase = null; refreshSource();
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
    selectedCase = null; showRecord(r); document.querySelectorAll('[data-case]').forEach(b => b.classList.remove('active'));
  } catch (e) { if (ticket === loading) feedback(e.message); }
});
$('save-source').addEventListener('click', () => {
  try { validateSource(currentName, $('source').value); download(currentName.replace(/\.cj$/i, '') + '.copy.cj', $('source').value, 'text/plain;charset=utf-8'); }
  catch (e) { feedback(e.message); }
});
$('export-record').addEventListener('click', () => { if (record) download(record.source.name + '.diagnostic.json', JSON.stringify(record, null, 2), 'application/json'); });
async function refreshHealth(recheck = false) {
  $('refresh-health').disabled = true;
  try {
    const response = recheck && health.token ? await fetch('/api/probe', {method:'POST', headers:{'X-Doctor-Token':health.token}}) : await fetch('/api/health');
    if (!response.ok) throw new Error('环境接口不可用。');
    health = await response.json();
    $('runtime-title').textContent = health.available ? '本机编译已就绪' : '本机编译暂不可用';
    $('runtime-detail').textContent = health.detail;
  } catch {
    health = {available:false}; $('runtime-title').textContent = '记录预览模式';
    $('runtime-detail').textContent = '当前服务没有连接仓颉核心，可继续浏览已采集记录。';
  }
  $('refresh-health').disabled = false;
  refreshSource();
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
      const row = element('div','', 'history-row');
      const info = element('div','', 'history-info');
      info.append(element('strong',`${item.caseId}.cj · ${taskLabel(item)}`),element('span',item.startedAt,'small-label'));
      const actions = element('div','', 'actions');
      if (item.record) {
        const load = element('button',item.state === 'completed' ? '载入记录副本' : '查看已保存诊断');
        load.addEventListener('click', () => { ++loading; selectedCase = null; showRecord(item.record);
          document.querySelectorAll('[data-case]').forEach(b => b.classList.remove('active'));
          if (item.state !== 'completed') feedback('已载入当时保存的诊断；任务状态仍为“' + taskLabel(item) + '”，以历史记录为准。'); });
        actions.append(load);
      }
      const save = element('button','导出任务记录');
      save.addEventListener('click',()=>download(`doctor-task-${item.taskId}.json`,JSON.stringify(item,null,2),'application/json'));
      actions.append(save); row.append(info,actions);
      const detail = element('details','', 'task-detail'); detail.dataset.taskDetail = item.taskId; detail.open = expanded.has(item.taskId);
      detail.append(element('summary','任务详情与日志'),element('p',item.detail),element('p',`任务编号：${item.taskId}`,'mono'),
        element('p',`结束时间：${item.finishedAt || '未确认'} · 原因：${item.reason || '正常完成'}`,'small-label'));
      if (item.process) {
        detail.append(element('p',`核心退出码：${item.process.exitCode ?? '未返回'} · 信号：${item.process.signal || '无'}`,'small-label'));
      }
      const logs = {...(item.logs || {})};
      if (item.process) { logs['核心 stdout'] = item.process.stdout; logs['核心 stderr'] = item.process.stderr; }
      for (const [name,log] of Object.entries(logs)) {
        if (!log || typeof log.text !== 'string') continue;
        detail.append(element('h3',name + (log.truncated ? '（仅保留前 16 KiB）' : '')),element('pre',log.text || '（空）'));
      }
      card.append(row,detail); $('history').append(card);
    }
    if (unreadable) $('history').prepend(element('p',`${unreadable} 份任务或诊断文件无法完整读取，原文件已保留；不能将缺失结果计为成功。`,'history-warning'));
    if (!tasks.length) $('history').append(element('p','本机还没有可显示的编译任务。发起任务后，完成、异常、取消和超时都会留在这里。','small-label'));
    if (data.busy) historyTimer = setTimeout(refreshHistory,1000);
  } catch (e) { if (request === historyRequest) $('history').replaceChildren(element('p',e.message,'small-label')); }
}
$('refresh-health').addEventListener('click', async () => { await refreshHealth(true); await refreshHistory(); });
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
  } catch (e) { feedback(e.name === 'AbortError' ? '已请求取消，正在确认最终状态；若任务先完成，会保留实际结果。请查看下方历史。' : e.message); }
  finally { compiling = false; compileController = null; refreshSource(); await refreshHistory(); }
});
loadCase('type_mismatch');
refreshHealth().then(refreshHistory);
