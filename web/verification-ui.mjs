import { validateRevision, validRevisionId } from './revision.mjs';
import { validatePublicTests, validateVerificationRecord, verificationView, verificationHTML } from './verification.mjs';
import { officialDocumentURL } from './document-evidence.mjs';

const $ = id => document.getElementById(id);
const node = (tag, text = '', className = '') => {
  const item = document.createElement(tag); item.textContent = text;
  if (className) item.className = className;
  return item;
};
const time = value => value ? new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value)) : '未确认';
const statusNames = {passed:'通过', failed:'输出不符', runtime_error:'运行异常', timeout:'超时', output_limit:'输出超限', oom:'内存超限', tool_error:'工具异常', cancelled:'已取消', launch_error:'启动失败', not_run:'未运行'};
const unfinishedDetail = '这条记录没有完整结束结果。即使重新检查环境时清理了已登记的残留资源，也不能补出原来的编译与测试结论；记录仍为“状态待确认”，不会自动重跑。';

function appendDocumentEvidence(destination, revision) {
  const evidence = revision.documentEvidence;
  const details = node('details', '', 'verification-report-detail');
  details.append(node('summary', evidence ? `原诊断文档依据 · ${evidence.results.length} 条摘录` : '原诊断文档依据 · 未附带'));
  if (!evidence) {
    details.append(node('p', '这份修改未附带文档依据，不能据此判断是否曾查阅文档或修改是否正确。'));
  } else {
    details.append(node('p', '以下文档对应修改前的原诊断，保留的是保存修改时确认附带的检索结果，不是对修改后代码的验证。'),
      node('p', `SDK ${evidence.sdkVersion} · 文档快照：${evidence.snapshotId}`),
      node('p', `检索编号：${evidence.retrievalId} · ${time(evidence.createdAt)}（北京时间）`),
      node('p', `检索内容：${evidence.query || '（空）'}`),
      node('p', `文档依据 SHA-256：${revision.documentEvidenceSha256}`, 'mono'));
    if (!evidence.results.length) details.append(node('p', '本次检索没有命中。没有匹配不说明代码正确，也不说明官方文档没有相关说明。'));
    for (const match of evidence.results) {
      const excerpt = node('details', '', 'verification-test-result');
      const link = node('a', '查看官方完整原文 ↗');
      link.href = officialDocumentURL(match.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
      excerpt.append(node('summary', `${match.title} · ${match.section}`), node('pre', match.text), link);
      details.append(excerpt);
    }
    details.append(node('p', '仓颉官方文档贡献者 · CC BY 4.0。原文逐字摘录，仅裁去首尾空白、统一换行；引用不代表上游作者认可本工具。'));
  }
  destination.append(details);
}

// This panel always works on immutable saved revisions, never on the editor.
export function initVerificationUI({getHealth, refreshHealth, download, onActivityChange = () => {}}) {
  let selected = null, loading = false, submitting = false, remoteBusy = false;
  let selectionRequest = 0, historyRequest = 0, testSequence = 0, timer = null;
  let shownResult = null, statusOrigin = '';
  const fields = [];
  const selectedEvidence = node('div');
  $('verification-source').append(selectedEvidence);
  const api = async (path, options = {}) => {
    const token = getHealth().token;
    if (!token) throw new Error('尚未连接本机服务。已有编辑内容不会受影响。');
    const response = await fetch(path, {...options, headers:{'X-Doctor-Token':token, ...options.headers}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '验证服务暂不可用。');
    return data;
  };
  const setStatus = (text, state = '', origin = '') => {
    statusOrigin = origin;
    $('verification-status').textContent = text;
    $('verification-status').dataset.state = state;
    $('verification-status').hidden = !text;
  };
  const tests = () => fields.map(field => ({id:field.id, stdin:field.stdin.value, expectedStdout:field.expected.value + (field.newline.checked ? '\n' : '')}));
  const invalidateResult = () => {
    if (shownResult) {
      shownResult = null; $('verification-result').replaceChildren(); $('verification-result').hidden = true;
      setStatus('验证对象或测试已变化。先前结果仍保存在下方“验证记录与报告”中。');
    }
  };
  const refreshControls = () => {
    const health = getHealth(), environment = health.verification;
    const busy = submitting || remoteBusy || Boolean(environment?.busy) || Boolean(health.busy);
    $('verification-revision').disabled = loading || submitting;
    for (const field of fields) for (const input of [field.stdin, field.expected, field.newline, field.remove].filter(Boolean)) input.disabled = submitting;
    $('verification-add-test').disabled = submitting || fields.length >= 8;
    $('verification-run').disabled = !selected || loading || busy || !health.token || !environment?.available;
    $('verification-run').textContent = submitting ? '正在编译并验证…' : '编译并验证这份修改';
    $('verification-environment').dataset.state = environment?.available ? 'ready' : 'unavailable';
    let environmentMessage = submitting ? '正在验证选中的已保存副本。可切换页面；请保持本页面打开，完成后结果会存到本机。' : busy ? '本机正在处理其他任务，完成后可继续验证。' : environment?.available ? '容器验证已就绪。点击下方按钮即确认编译并运行这份已保存修改。' : environment?.detail || '当前未启用 Linux 容器验证。此电脑需配置本地 Linux Docker 环境；可继续编辑、保存修改和查看已有报告。';
    const recovery = environment?.recovery;
    if (Number.isSafeInteger(recovery?.recoveredContainers) && recovery.recoveredContainers >= 0 && typeof recovery.detail === 'string') {
      environmentMessage += ` 恢复检查：已清理 ${recovery.recoveredContainers} 个已登记的残留容器。${recovery.detail.trim().slice(0, 500)} 缺失的旧任务结果仍待确认，清理不代表验证通过。`;
    }
    $('verification-environment').textContent = environmentMessage;
    $('verification-target').textContent = loading ? '正在核对已保存副本…' : selected ? `${selected.source.name} · 保存于 ${time(selected.createdAt)}（北京时间）` : '先在编译诊断页编辑源码，查看差异并确认保存，再回到这里选择。';
    $('verification-source').hidden = !selected;
    $('verification-test-count').textContent = `${fields.length} / 8 条`;
  };
  const addTest = () => {
    if (fields.length >= 8) return;
    const index = ++testSequence, field = {id:`public_${index}`};
    const group = node('fieldset', '', 'verification-test'), legend = node('legend', '', 'verification-test-heading');
    legend.append(node('span', `公开测试 ${index}`)); group.append(legend);
    const grid = node('div', '', 'verification-test-grid');
    const inputColumn = node('div'), outputColumn = node('div');
    const inputLabel = node('label', '程序输入（stdin）'); inputLabel.htmlFor = `verification-input-${index}`;
    field.stdin = node('textarea'); field.stdin.id = inputLabel.htmlFor; field.stdin.rows = 3; field.stdin.spellcheck = false;
    field.stdin.placeholder = '程序不读取输入时留空'; field.stdin.maxLength = 4096;
    const outputLabel = node('label', '期望输出（stdout）'); outputLabel.htmlFor = `verification-output-${index}`;
    field.expected = node('textarea'); field.expected.id = outputLabel.htmlFor; field.expected.rows = 3; field.expected.spellcheck = false;
    field.expected.placeholder = '填入你认为正确的输出；无输出则留空'; field.expected.maxLength = 16384;
    const checkboxLabel = node('label', '', 'verification-newline');
    field.newline = node('input'); field.newline.type = 'checkbox';
    checkboxLabel.append(field.newline, node('span', '在期望输出末尾补一个换行（LF）'));
    const preview = node('code', '""', 'verification-exact-output');
    const previewLabel = node('p', '实际比较文本：', 'verification-output-preview'); previewLabel.append(preview);
    const update = () => {
      const value = field.expected.value + (field.newline.checked ? '\n' : '');
      preview.textContent = JSON.stringify(value); invalidateResult();
    };
    for (const input of [field.stdin, field.expected, field.newline]) input.addEventListener('input', update);
    inputColumn.append(inputLabel, field.stdin, node('small', '输入按原文传入；需要换行时按 Enter。'));
    outputColumn.append(outputLabel, field.expected, checkboxLabel, previewLabel);
    grid.append(inputColumn, outputColumn); group.append(grid);
    if (index > 1) {
      field.remove = node('button', '移除此测试', 'text-button'); field.remove.type = 'button';
      field.remove.addEventListener('click', () => { fields.splice(fields.indexOf(field), 1); group.remove(); invalidateResult(); refreshControls(); });
      group.append(field.remove);
    }
    fields.push(field); (index === 1 ? $('verification-first-test') : $('verification-extra-tests')).append(group);
    invalidateResult(); refreshControls();
  };
  const readVerification = async id => {
    if (!validRevisionId(id)) throw new Error('验证记录编号无效。');
    const data = await validateVerificationRecord(await api(`/api/verifications/${id}`));
    if (data.verificationId !== id) throw new Error('返回的验证记录编号不一致。');
    return data;
  };
  const appendDownloads = (destination, data) => {
    const actions = node('div', '', 'verification-downloads');
    const json = node('button', '下载 JSON'); json.type = 'button';
    json.addEventListener('click', () => download(`doctor-verification-${data.verificationId}.json`, JSON.stringify(data, null, 2), 'application/json'));
    const html = node('button', '下载可读报告'); html.type = 'button';
    html.addEventListener('click', () => download(`doctor-verification-${data.verificationId}.html`, verificationHTML(data), 'text/html;charset=utf-8'));
    actions.append(json, html); destination.append(actions);
  };
  const renderResult = (data, destination, includeDownloads = true) => {
    const view = verificationView(data), report = data.report;
    destination.replaceChildren(); destination.dataset.tone = view.tone;
    destination.append(node('h3', view.label), node('p', `${view.compileLabel} · ${view.testLabel}`, 'verification-verdict'),
      node('p', data.state === 'unknown' ? unfinishedDetail : view.detail), node('p', `仅对应 ${data.revision.source.name} 的已保存版本 ${data.revision.revisionId.slice(0, 8)}。公开测试通过仅说明这些测试的输出符合期望。`, 'verification-result-scope'));
    if (data.detail && data.detail !== view.detail) destination.append(node('p', data.detail, 'verification-result-scope'));
    const details = node('details', '', 'verification-report-detail'); details.append(node('summary', '查看源码、测试与原始日志'));
    details.append(node('p', `修改编号：${data.revision.revisionId}`, 'mono'), node('p', `源码 SHA-256：${data.revision.source.sha256}`, 'mono'),
      node('p', `验证编号：${data.verificationId}`, 'mono'), node('p', `创建：${time(data.createdAt)} · 结束：${time(data.finishedAt)}（北京时间）`),
      node('h4', '这次验证的已保存源码'), node('pre', data.revision.source.text));
    appendDocumentEvidence(details, data.revision);
    if (report?.compile?.process) {
      details.append(node('h4', '编译器 stderr'), node('pre', report.compile.process.stderr || '（空）'), node('h4', '编译器 stdout'), node('pre', report.compile.process.stdout || '（空）'));
    }
    for (const [index, test] of data.tests.entries()) {
      const result = report?.tests?.[index];
      const testDetail = node('details', '', 'verification-test-result');
      testDetail.append(node('summary', `公开测试 ${index + 1} · ${data.state === 'unknown' ? '未取得结果' : statusNames[result?.status] || '未运行'}`),
        node('p', `输入：${JSON.stringify(test.stdin)}`, 'mono'), node('p', `期望 stdout：${JSON.stringify(test.expectedStdout)}`, 'mono'));
      if (result?.process) testDetail.append(node('p', `实际 stdout：${JSON.stringify(result.process.stdout)}`, 'mono'),
        node('p', `退出码：${result.process.exitCode ?? '未返回'} · 原因：${result.process.reason || '正常结束'}`),
        node('h4', '运行 stderr'), node('pre', result.process.stderr || '（空）'));
      details.append(testDetail);
    }
    destination.append(details);
    if (includeDownloads) appendDownloads(destination, data);
  };
  const refresh = async ({userInitiated = false} = {}) => {
    const request = ++historyRequest; clearTimeout(timer); $('verification-refresh').disabled = true;
    try {
      const data = await api('/api/verifications');
      if (!Array.isArray(data.verifications) || data.verifications.length > 20) throw new Error('验证记录索引无效。');
      if (request !== historyRequest) return;
      const wasBusy = remoteBusy; remoteBusy = Boolean(data.busy);
      // Another tab may have started this task. Refresh global health once it
      // finishes so stale busy flags do not leave either workflow disabled.
      if (remoteBusy) onActivityChange(true);
      else if (wasBusy && !submitting) { await refreshHealth(); if (request !== historyRequest) return; }
      const expanded = new Set([...$('verification-history').querySelectorAll('[data-verification][open]')].map(item => item.dataset.verification));
      const unknown = data.verifications.filter(item => item.state === 'unknown' || item.state === 'running' && !item.active).length;
      $('verification-history').replaceChildren(); $('verification-history-count').textContent = `${data.verifications.length} 份${unknown ? ` · ${unknown} 份待确认` : ''}`;
      if (unknown) $('verification-history').append(node('p', unfinishedDetail, 'history-warning'));
      for (const item of data.verifications) {
        if (!validRevisionId(item.verificationId) || !validRevisionId(item.revisionId) || typeof item.sourceName !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('验证记录索引含无效条目。');
        const entry = node('details', '', 'verification-history-entry'); entry.dataset.verification = item.verificationId;
        const label = item.state === 'running' ? (item.active ? '正在验证' : '状态待确认') : item.state === 'unknown' ? '状态待确认' : item.state === 'failed' ? '验证异常' : ({passed:'公开测试通过', compile_failed:'编译未通过', test_failed:'公开测试未通过', tool_error:'工具异常'}[item.status] || '结果待核对');
        const summary = node('summary'); summary.append(node('strong', `${item.sourceName} · ${label}`), node('span', `${time(item.createdAt)} · 修改 ${item.revisionId.slice(0, 8)}`));
        const body = node('div', '', 'verification-history-body'); let fetched = false;
        entry.append(summary, body); entry.addEventListener('toggle', async () => {
          if (!entry.open || fetched) return; fetched = true; body.replaceChildren(node('p', '正在核对完整记录…'));
          try { renderResult(await readVerification(item.verificationId), body); }
          catch (error) { fetched = false; body.replaceChildren(node('p', `${error.message} 可点击上方“刷新验证状态”重试，或收起后再次展开。`)); }
        });
        $('verification-history').append(entry); entry.open = expanded.has(item.verificationId);
      }
      if (!data.verifications.length) $('verification-history').append(node('p', '还没有验证记录。环境就绪后，选择已保存修改并提交公开测试。', 'small-label'));
      if (data.unreadable) $('verification-history').prepend(node('p', `${data.unreadable} 份记录无法完整读取，原文件已保留；缺失结果不能计为通过。`, 'history-warning'));
      if (statusOrigin === 'history') setStatus('验证记录已刷新，当前填写的测试草稿保持不变。');
      if (data.busy) timer = setTimeout(refresh, 2000);
    } catch (error) {
      if (request === historyRequest) {
        $('verification-history-count').textContent = '未能读取';
        $('verification-history').replaceChildren(node('p', `${error.message} 请点击“刷新验证状态”重试；当前测试草稿保持不变。`, 'small-label'));
        if (userInitiated || submitting) {
          $('verification-history').closest('.verification-history-disclosure').open = true;
          setStatus('验证记录暂时未能读取。已展开下方记录区域，请点击“刷新验证状态”重试；当前测试草稿保持不变。', 'error', 'history');
        }
      }
    } finally { if (request === historyRequest) { $('verification-refresh').disabled = false; refreshControls(); } }
  };
  const selectRevision = async () => {
    const id = $('verification-revision').value, request = ++selectionRequest;
    selected = null; invalidateResult(); loading = Boolean(id); refreshControls();
    if (!id) return;
    try {
      const revision = await validateRevision(await api(`/api/revisions/${id}`));
      if (request !== selectionRequest) return;
      if (revision.revisionId !== id) throw new Error('修改记录编号不匹配，未选择。');
      selected = revision; $('verification-source-text').textContent = revision.source.text;
      $('verification-source-hash').textContent = revision.source.sha256;
      selectedEvidence.replaceChildren(); appendDocumentEvidence(selectedEvidence, revision);
      if (!shownResult) setStatus('此处验证已保存的副本，不会载入或替换编译诊断页中的编辑内容。');
    } catch (error) { if (request === selectionRequest) setStatus(error.message, 'error'); }
    finally { if (request === selectionRequest) { loading = false; refreshControls(); } }
  };
  const setRevisions = items => {
    const select = $('verification-revision'), old = select.value;
    const options = items.filter(item => validRevisionId(item.revisionId) && typeof item.sourceName === 'string' && Number.isFinite(Date.parse(item.createdAt)));
    if (selected && !options.some(item => item.revisionId === selected.revisionId)) options.push({revisionId:selected.revisionId, sourceName:selected.source.name, createdAt:selected.createdAt});
    select.replaceChildren(); const empty = node('option', options.length ? '选择一份已保存修改' : '还没有已保存修改'); empty.value = ''; select.append(empty);
    for (const item of options) { const option = node('option', `${item.sourceName} · ${time(item.createdAt)} · ${item.revisionId.slice(0, 8)}`); option.value = item.revisionId; select.append(option); }
    select.value = options.some(item => item.revisionId === old) ? old : options[0]?.revisionId || '';
    if (select.value !== old || !selected && !loading) void selectRevision();
    else refreshControls();
  };
  $('verification-revision').addEventListener('change', selectRevision);
  $('verification-add-test').addEventListener('click', addTest);
  $('verification-refresh').addEventListener('click', async () => { await refreshHealth(); await refresh({userInitiated:true}); });
  $('verification-form').addEventListener('submit', async event => {
    event.preventDefault(); const environment = getHealth().verification;
    if (!selected || loading || submitting || remoteBusy || getHealth().busy || environment?.busy || !environment?.available) return;
    let requestTests;
    try { requestTests = validatePublicTests(tests()); } catch (error) { setStatus(error.message, 'error'); return; }
    const target = selected;
    invalidateResult(); submitting = true; onActivityChange(true); refreshControls(); setStatus('正在编译已保存修改，并按你填写的公开测试逐条验证。');
    timer = setTimeout(refresh, 1000);
    try {
      const data = await validateVerificationRecord(await api('/api/verifications', {method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({revisionId:target.revisionId, tests:requestTests, confirmed:true})}));
      if (data.revision.revisionId !== target.revisionId || data.revision.source.sha256 !== target.source.sha256 || JSON.stringify(data.tests) !== JSON.stringify(requestTests)) throw new Error('返回记录与提交的已保存副本或测试不一致，未展示为本次结果。');
      shownResult = data; renderResult(data, $('verification-result')); $('verification-result').hidden = false;
      setStatus('验证记录已保存。下方结果只对应本次选择的已保存副本和公开测试。');
    } catch (error) { setStatus(`${error.message} 未确认本次验证完成；请展开验证记录核对，不能据此判断修改通过。`, 'error'); }
    finally { submitting = false; await refreshHealth(); onActivityChange(false); await refresh({userInitiated:true}); refreshControls(); }
  });
  addTest(); refreshControls();
  return {setRevisions, refreshControls, refresh};
}
