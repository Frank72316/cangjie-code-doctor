// Shared persisted-report contract. This validates consistency, not a signature.
import { validateRevision, lineDiff } from './revision.mjs';
import { sha256 } from './report.mjs';
import { documentEvidenceHTML } from './document-evidence.mjs';
const encoder = new TextEncoder();
export const MAX_VERIFICATION_BYTES = 16 * 1024 * 1024;
export const validVerificationId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value, max) => typeof value === 'string' && value.isWellFormed() && encoder.encode(value).length <= max;
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
function requireThat(condition, detail) { if (!condition) throw new Error(detail); }
export function validatePublicTests(tests, {allowEmpty=false}={}) {
  requireThat(Array.isArray(tests) && tests.length <= 8 && (allowEmpty || tests.length > 0), '请填写 1 至 8 个公开测试。');
  const ids = new Set();
  for (const test of tests) {
    requireThat(exact(test, ['id','stdin','expectedStdout']) && typeof test.id === 'string'
      && /^[a-zA-Z0-9_-]{1,40}$/.test(test.id) && !ids.has(test.id)
      && text(test.stdin,4096) && text(test.expectedStdout,16384), '测试编号须唯一；输入最多 4 KiB，期望输出最多 16 KiB，只接受公开标准输入输出。');
    ids.add(test.id);
  }
  return structuredClone(tests);
}
function validateProcess(value, maximum) {
  requireThat(value && (value.exitCode === null || Number.isInteger(value.exitCode)) && text(value.reason,1024)
    && text(value.stdout,maximum*3) && text(value.stderr,maximum*3)
    && Number.isInteger(value.stdoutBytes) && value.stdoutBytes >= 0
    && Number.isInteger(value.stderrBytes) && value.stderrBytes >= 0
    && value.stdoutBytes + value.stderrBytes <= maximum
    && digest(value.stdoutSha256) && digest(value.stderrSha256), '验证进程输出或字节边界无效。');
}
async function validateSandboxReport(report, revision, tests) {
  requireThat(report && report.schemaVersion === 1 && report.kind === 'doctor-sandbox-verification'
    && validVerificationId(report.id) && report.developmentOnly === true && report.scope === 'public-tests-only'
    && report.sdkVersion === '1.0.5' && /^sha256:[a-f0-9]{64}$/.test(report.image)
    && iso(report.startedAt) && iso(report.finishedAt) && report.finishedAt >= report.startedAt
    && text(report.detail,8192), '不支持的容器验证报告或身份。');
  requireThat(report.source && report.source.name === revision.source.name && report.source.text === revision.source.text
    && report.source.sha256 === revision.source.sha256 && report.source.sha256 === await sha256(report.source.text), '验证结果与已保存的修改不一致。');
  requireThat(['passed','test_failed','compile_failed','tool_error','not_run'].includes(report.status)
    && ['passed','failed','not_run','incomplete'].includes(report.testStatus)
    && report.compile && ['not_run','compile_passed','compile_failed','tool_error'].includes(report.compile.status)
    && Array.isArray(report.tests) && report.tests.length === tests.length
    && Array.isArray(report.containers) && report.containers.length <= tests.length + 1, '验证状态或测试数量无效。');
  if (report.compile.process) validateProcess(report.compile.process,1024*1024);
  for (const [index,test] of report.tests.entries()) {
    requireThat(test.id === tests[index].id && ['not_run','passed','failed','runtime_error','timeout','output_limit','cancelled','oom','tool_error','launch_error'].includes(test.status), '测试结果与请求的顺序或编号不一致。');
    if (test.process) validateProcess(test.process,65536);
    if (['passed','failed','runtime_error'].includes(test.status)) {
      const verdict = test.verdict;
      requireThat(test.process && !test.process.reason && Number.isInteger(test.process.exitCode)
        && verdict && verdict.status === test.status && verdict.comparison === 'exact_bytes'
        && verdict.exitCode === test.process.exitCode && typeof verdict.stdoutMatches === 'boolean'
        && verdict.actualBytes === test.process.stdoutBytes && verdict.expectedBytes === encoder.encode(tests[index].expectedStdout).length,
      '原生公开测试判定缺失或不一致。');
      requireThat(test.status === 'runtime_error' ? verdict.exitCode !== 0
        : verdict.exitCode === 0 && verdict.stdoutMatches === (test.status === 'passed'), '测试通过状态与原生退出码或比较结果不一致。');
      if (test.status === 'passed') requireThat(verdict.actualBytes === verdict.expectedBytes
        && test.process.stdout === tests[index].expectedStdout && test.process.stdoutSha256 === await sha256(tests[index].expectedStdout), '通过记录的输出或哈希不一致。');
    }
  }
  for (const entry of report.containers) {
    requireThat(entry && /^doctor-[a-f0-9]{32}$/.test(entry.name) && ['compile','run'].includes(entry.phase)
      && entry.cleanup && typeof entry.cleanup.removed === 'boolean' && text(entry.cleanup.detail,8192), '容器清理记录无效。');
  }
  requireThat(new Set(report.containers.map(entry=>entry.name)).size === report.containers.length, '不同阶段或测试不能复用同一个容器。');
  if (report.status === 'tool_error') requireThat(['not_run','incomplete'].includes(report.testStatus), '工具异常不能声明测试汇总通过。');
  if (report.status !== 'tool_error') {
    requireThat(report.containers.length > 0 && report.containers.every(entry => entry.cleanup.removed), '未确认容器清理，不能标记完成。');
  }
  if (report.compile.status === 'compile_passed' && report.status !== 'tool_error') {
    requireThat(report.compile.normalized?.status === 'compile_passed' && report.compile.process?.exitCode === 0
      && !report.compile.process.reason && digest(report.artifact?.sha256)
      && Number.isInteger(report.artifact.bytes) && report.artifact.bytes >= 4 && report.artifact.bytes <= 32*1024*1024, '编译通过缺少原生判定或有效产物依据。');
  }
  if (report.status !== 'tool_error' && ['compile_passed','compile_failed'].includes(report.compile.status)) {
    const entry=report.containers[0];
    requireThat(entry?.phase === 'compile' && entry.inspection?.image === report.image
      && entry.inspection.state?.Running === true && entry.inspection.state?.OOMKilled === false
      && !entry.inspection.state?.Error, '编译容器缺少一致的运行与镜像依据。');
  }
  if (report.status === 'passed' || report.status === 'test_failed') {
    requireThat(report.compile.status === 'compile_passed' && report.tests.length > 0
      && report.tests.every(test => !['not_run','tool_error','launch_error','cancelled'].includes(test.status)), '测试结束状态与执行情况不一致。');
    const passed = report.tests.every(test => test.status === 'passed');
    requireThat((report.status === 'passed') === passed && report.testStatus === (passed ? 'passed' : 'failed'), '汇总测试结论与逐例结果不一致。');
    requireThat(report.containers.length === tests.length + 1 && report.containers[0].phase === 'compile'
      && report.containers.slice(1).every(entry => entry.phase === 'run'), '测试没有对应的独立容器记录。');
    for (const [index,entry] of report.containers.slice(1).entries()) {
      if (report.tests[index].status === 'passed') requireThat(entry.inspection?.image === report.image
        && entry.inspection.state?.Running === false && entry.inspection.state?.OOMKilled === false
        && entry.inspection.state?.ExitCode === 0 && !entry.inspection.state?.Error, '通过测试缺少一致的容器退出证据。');
    }
  }
  if (report.status === 'compile_failed') requireThat(report.compile.status === 'compile_failed'
    && report.compile.normalized?.status === 'compile_failed' && report.compile.process?.exitCode === 1
    && !report.compile.process.reason && report.containers.length === 1
    && report.testStatus === 'not_run' && report.tests.every(test => test.status === 'not_run'), '编译失败不能包含已通过的行为测试。');
  if (report.status === 'not_run') requireThat(tests.length === 0 && report.testStatus === 'not_run', '已提供测试的报告不能声明无测试。');
}
export async function validateVerificationRecord(data) {
  requireThat(exact(data,['schemaVersion','kind','verificationId','createdAt','finishedAt','state','revision','tests','report','detail'])
    && data.schemaVersion === 1 && data.kind === 'doctor-revision-verification' && validVerificationId(data.verificationId)
    && iso(data.createdAt) && ['running','unknown','completed','failed'].includes(data.state) && text(data.detail,8192), '不支持的修改验证记录。');
  requireThat(encoder.encode(JSON.stringify(data)).length <= MAX_VERIFICATION_BYTES, '修改验证报告超过大小限制。');
  await validateRevision(data.revision); validatePublicTests(data.tests);
  if (data.state === 'running' || data.state === 'unknown') {
    requireThat(data.finishedAt === null && data.report === null, '待确认任务不得包含结束结论。');
  } else {
    requireThat(iso(data.finishedAt) && data.finishedAt >= data.createdAt, '修改验证结束时间无效。');
    if (data.state === 'failed') requireThat(data.report === null && data.detail.length > 0, '失败任务必须保留原因，不能声明通过。');
    else {
      await validateSandboxReport(data.report,data.revision,data.tests);
      requireThat(data.report.startedAt >= data.createdAt && data.report.finishedAt <= data.finishedAt, '容器报告时间与接收记录不一致。');
    }
  }
  return data;
}
const compileNames = {not_run:'未编译',compile_passed:'编译通过',compile_failed:'编译未通过',tool_error:'编译工具异常'};
const testNames = {not_run:'测试未运行',passed:'公开测试通过',failed:'公开测试未通过',incomplete:'测试未完成'};
export function verificationView(data) {
  if (data.state === 'running' || data.state === 'unknown') return {label:'状态待确认',tone:'warning',compileLabel:'未确认',testLabel:'未确认',detail:'尚无完整结束记录。仅当前服务确认活跃的任务可显示正在验证；不能从残留文件推断通过。'};
  if (data.state === 'failed') return {label:'验证未完成',tone:'error',compileLabel:'未确认',testLabel:'测试未完成',detail:data.detail};
  const report=data.report;
  const labels={passed:'公开测试通过',test_failed:'公开测试未通过',compile_failed:'编译未通过',tool_error:'验证工具异常',not_run:'行为未验证'};
  return {label:labels[report.status] || '状态无效',tone:report.status === 'passed' ? 'success' : 'error',
    compileLabel:compileNames[report.compile.status] || '未确认',testLabel:testNames[report.testStatus] || '未确认',
    detail:report.detail || (report.status === 'passed' ? '仅针对这份已保存修改和本次公开测试，不代表所有输入正确或保留测试通过。' : '请查看编译结果和逐项测试；未通过不能计为修复成功。')};
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const resultNames={passed:'通过',failed:'输出不符',runtime_error:'运行异常',timeout:'超时',output_limit:'输出超限',cancelled:'已取消',oom:'内存超限',tool_error:'工具异常',launch_error:'启动失败',not_run:'未运行'};
// Call after validateVerificationRecord. All candidate text is HTML escaped.
export function verificationHTML(data) {
  const view=verificationView(data), report=data.report;
  const tests=data.tests.map((test,index) => {
    const result=report?.tests[index];
    return `<section><h3>${escape(test.id)} · ${escape(resultNames[result?.status] || '未确认')}</h3><p>退出码：${escape(result?.process?.exitCode ?? '未取得')}；判定方式：比较原始字节（包含尾部换行）。</p><div class="columns"><div><h4>公开输入</h4><pre>${escape(test.stdin)}</pre></div><div><h4>期望输出</h4><pre>${escape(test.expectedStdout)}</pre></div><div><h4>实际 stdout</h4><pre>${escape(result?.process?.stdout ?? '未取得')}</pre></div></div><details><summary>精确文本、stderr 与异常</summary><p>期望输出（JSON 转义）：<code>${escape(JSON.stringify(test.expectedStdout))}</code></p><p>实际输出（JSON 转义）：<code>${escape(result?.process ? JSON.stringify(result.process.stdout) : '未取得')}</code></p><h4>stderr</h4><pre>${escape(result?.process?.stderr || '无')}</pre><p>异常：${escape(result?.process?.reason || '无')}</p></details></section>`;
  }).join('');
  const diff=lineDiff(data.revision.baseRecord.source.text,data.revision.source.text).map(row =>
    `${row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '} ${row.text}`).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Doctor 修改与公开测试报告</title><style>body{max-width:1080px;margin:40px auto;padding:0 22px;font:15px/1.7 system-ui,sans-serif;color:#18352b;background:#f6f8f4}h1{font-size:28px}h2{margin-top:30px}section{background:white;border:1px solid #d9e2da;border-radius:12px;padding:20px;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eff3ef;padding:12px;border-radius:6px;min-height:24px}code,p{overflow-wrap:anywhere}.columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.scope{color:#59685f}@media(max-width:700px){.columns{grid-template-columns:1fr}body{margin:20px auto}}@media print{body{background:white}section{break-inside:avoid}}</style></head><body>
<p>Doctor · 离线开发记录</p><h1>修改与公开测试报告</h1><p><strong>${escape(view.label)}</strong> · ${escape(view.compileLabel)} · ${escape(view.testLabel)}</p><p class="scope">${escape(view.detail)}</p>
<section><h2>记录身份</h2><p>验证编号：<code>${escape(data.verificationId)}</code></p><p>修订编号：<code>${escape(data.revision.revisionId)}</code></p><p>接收时间：${escape(data.createdAt)}；结束时间：${escape(data.finishedAt || '未确认')}</p><p>源码：${escape(data.revision.source.name)}；SHA-256：<code>${escape(data.revision.source.sha256)}</code></p><p>原诊断记录 SHA-256：<code>${escape(data.revision.recordSha256)}</code></p><p>SDK：${escape(report?.sdkVersion || '未确认')}；镜像：<code>${escape(report?.image || '未确认')}</code></p></section>
<section><h2>已确认的源码差异</h2><pre>${escape(diff)}</pre><details><summary>修改后的完整源码</summary><pre>${escape(data.revision.source.text)}</pre></details></section>
${data.revision.documentEvidence ? `<p class="scope">文档依据 SHA-256：<code>${escape(data.revision.documentEvidenceSha256)}</code></p>` : ''}${documentEvidenceHTML(data.revision.documentEvidence)}
<section><h2>编译结果</h2><p>${escape(view.compileLabel)}；退出码：${escape(report?.compile?.process?.exitCode ?? '未取得')}</p><h3>stdout</h3><pre>${escape(report?.compile?.process?.stdout || '无')}</pre><h3>stderr</h3><pre>${escape(report?.compile?.process?.stderr || '无')}</pre><p>异常或说明：${escape(report?.compile?.process?.reason || report?.detail || data.detail || '无')}</p></section>
<h2>公开测试</h2>${tests}<section><h2>清理与结论范围</h2><p>容器清理：${report?.containers?.length && report.containers.every(c=>c.cleanup?.removed) ? '本次记录中的容器均确认不存在' : '未取得全部清理确认'}</p><p>本报告绑定已保存修改，可能与编辑器当前内容不同。记录由本机服务生成，不含数字签名；哈希用于一致性核对，不证明外部来源真实性。没有保留测试、模型修复或正式 A/B 结论。原诊断与人工确认记录保持不变；附带文档只对应原诊断的检索，不证明修改正确。</p></section></body></html>`;
}
