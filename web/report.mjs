// New records consume native normalized diagnostics. Legacy captures retain a
// read-only compatibility renderer; no compiler is launched from the browser.
const encoder = new TextEncoder();
export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 64 * 1024;
export function validateSource(name, text) {
  if (!name.toLowerCase().endsWith('.cj')) throw new Error('请选择 .cj 源文件。');
  if (encoder.encode(text).length > MAX_SOURCE_BYTES) throw new Error('源码超过 64 KiB。');
  if (text.includes('\0')) throw new Error('源码包含空字符，不能作为文本预览。');
  if (text.split(/\r\n|\r|\n/).length > 200) throw new Error('首版只接收不超过 200 行的单文件。');
  return text;
}
export async function sha256(text) {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function readRecord(text) {
  if (encoder.encode(text).length > MAX_REPORT_BYTES) throw new Error('记录超过 2 MiB。');
  const r = JSON.parse(text);
  if (r?.schemaVersion !== 1 || r?.kind !== 'trusted-development-capture') throw new Error('不支持的诊断记录格式。');
  if (typeof r.source?.text !== 'string' || typeof r.source?.name !== 'string') throw new Error('记录缺少源码副本。');
  validateSource(r.source.name, r.source.text);
  if (await sha256(r.source.text) !== r.source.sha256) throw new Error('源码 SHA-256 不匹配，记录未载入。');
  const c = r.compiler;
  if (!c || !Number.isSafeInteger(c.exitCode) || typeof c.stdout !== 'string' || typeof c.stderr !== 'string' ||
      typeof c.version !== 'string' || c.inputName !== 'input.cj' || typeof c.timedOut !== 'boolean' ||
      typeof c.artifactCreated !== 'boolean') throw new Error('记录缺少有效的编译器状态。');
  if (encoder.encode(c.stdout + c.stderr).length > 1048576) throw new Error('编译器输出超过 1 MiB。');
  if (r.execution?.attempted !== false || r.execution?.testStatus !== 'not_run') throw new Error('此预览只支持未执行程序的开发记录。');
  if (r.producer === 'cangjie-core') validateNormalized(r);
  return r;
}
function validateNormalized(r) {
  const n = r.normalized, c = r.compiler;
  if (!n || !['compile_passed','compile_failed','tool_error'].includes(n.status) ||
      !['complete','partial','invalid','empty'].includes(n.parseState) || typeof n.detail !== 'string' ||
      n.exitCode !== c.exitCode || n.rawDiagnostics !== c.stderr + c.stdout || n.testStatus !== 'not_run' || !Array.isArray(n.diagnostics))
    throw new Error('仓颉结构化结果与原始证据不一致。');
  for (const d of n.diagnostics) {
    if (!d || !['code','severity','message','hint','file'].every(k => typeof d[k] === 'string') ||
        !Number.isSafeInteger(d.line) || !Number.isSafeInteger(d.column) || d.line < 0 || d.column < 0)
      throw new Error('仓颉诊断项无效。');
  }
  if ((n.status === 'compile_passed' && (c.exitCode !== 0 || !c.artifactCreated || n.diagnostics.some(d => d.severity === 'error'))) ||
      (n.status === 'compile_failed' && c.exitCode !== 1) || (n.status !== 'tool_error' && c.timedOut))
    throw new Error('仓颉结果状态与进程状态矛盾。');
}
export function compileView(record) {
  const c = record.compiler;
  const result = { status: 'tool_error', label: '工具异常', detail: '', diagnostics: [], parseState: 'invalid' };
  try {
    if (record.producer === 'cangjie-core') {
      validateNormalized(record);
      const n = record.normalized;
      return {...n, label:{compile_passed:'编译通过', compile_failed:'编译未通过', tool_error:'工具异常'}[n.status],
        detail:n.detail || (n.status === 'compile_passed' ? '已生成编译产物；尚未运行程序或测试。' : '仓颉核心已解析编译器输出，可点击诊断定位。'),
        diagnostics:n.diagnostics.map(d => ({...d, canLocate:d.file === c.inputName && d.line > 0 && d.line <= record.source.text.split('\n').length}))};
    }
    if (c.timedOut) throw new Error('编译超时，不能据此判断源码是否正确。');
    if (c.exitCode < 0 || c.exitCode >= 128) throw new Error(`编译器异常退出（${c.exitCode}）。`);
    if (c.stdout.trim() && c.stderr.trim()) throw new Error('两个输出流均有内容，请查看原始日志。');
    const raw = (c.stderr || c.stdout).trim();
    let errors = 0;
    let incomplete = false;
    if (raw) {
      const data = JSON.parse(raw);
      if (!Array.isArray(data.Diags) || !Number.isSafeInteger(data.Num?.Errors) || data.Num.Errors < 0)
        throw new Error('诊断结构缺失或错误计数无效。');
      errors = data.Num.Errors;
      result.diagnostics = data.Diags.map(d => {
        if (!d || typeof d !== 'object') throw new Error('诊断项格式无效。');
        const severity = typeof d.Severity === 'string' ? d.Severity : 'unknown';
        const message = typeof d.Message === 'string' ? d.Message : '';
        if (!['error', 'warning', 'note'].includes(severity) || !message) incomplete = true;
        const location = d.Location ?? {};
        const line = Number.isSafeInteger(location.Line) && location.Line > 0 ? location.Line : null;
        const column = Number.isSafeInteger(location.Column) && location.Column > 0 ? location.Column : null;
        const file = typeof location.File === 'string' ? location.File : '';
        // Only positions for the exact captured input may navigate the source pane.
        const canLocate = file === c.inputName && line !== null && line <= record.source.text.split('\n').length;
        return { code: typeof d.DiagKind === 'string' ? d.DiagKind : '', severity, message: message || '诊断正文缺失',
          hint: typeof d.MainHint?.Content === 'string' ? d.MainHint.Content : '', line, column, file, canLocate };
      });
      const visibleErrors = result.diagnostics.filter(d => d.severity === 'error').length;
      if (visibleErrors > errors) throw new Error('错误计数与诊断项矛盾。');
      incomplete ||= visibleErrors < errors;
      result.parseState = incomplete ? 'partial' : 'complete';
    } else { result.parseState = 'empty'; }
    if (c.exitCode === 0 && errors === 0 && !incomplete && c.artifactCreated) {
      result.status = 'compile_passed'; result.label = '编译通过';
      result.detail = '已生成编译产物；尚未运行程序或测试。';
    } else if (c.exitCode === 1 && errors > 0) {
      result.status = 'compile_failed'; result.label = '编译未通过';
      result.detail = incomplete ? '部分诊断未完整解析，请同时检查原始日志。' : `编译器报告 ${errors} 个错误，可点击诊断定位。`;
    } else { throw new Error('退出码、诊断或编译产物不一致，不能确认为正常编译。'); }
  } catch (error) { result.detail = error.message; }
  return result;
}
export function sourceIsCurrent(record, name, text) {
  // Textarea uses LF; normalize CRLF only for editor comparison, never for the recorded hash.
  return !!record && name === record.source.name && text === record.source.text.replace(/\r\n?/g, '\n');
}
export function lineRange(text, line) {
  const lines = text.split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return null;
  const start = lines.slice(0, line - 1).reduce((n, v) => n + v.length + 1, 0);
  return { start, end: start + lines[line - 1].length };
}
