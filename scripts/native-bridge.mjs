// Local HTTP transport for the Cangjie CLI. Compilation, snapshots and diagnostic
// interpretation live in src/compiler.cj. No shell and no user-supplied commands.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const EXAMPLE_IDS = ['type_mismatch', 'undefined_name', 'argument_count', 'hello'];
function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore', shell:false});
    killer.on('error', () => child.kill());
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}
export function runNative(executable, args, {timeout = 70000, signal} = {}) {
  return new Promise(resolveResult => {
    const child = spawn(executable, args, {shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
    let stdout = '', stderr = '', size = 0, reason = '';
    const stop = why => { if (!reason) { reason = why; stopTree(child); } };
    const timer = setTimeout(() => stop('timeout'), timeout);
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) {
      stream.on('data', text => {
        size += Buffer.byteLength(text);
        if (size > 2 * 1024 * 1024) { stop('output_limit'); return; }
        if (isError) stderr += text; else stdout += text;
      });
    }
    let launchError;
    child.on('error', error => { launchError = error.code || 'launch_error'; });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolveResult({code, signal:exitSignal, stdout, stderr, reason:reason || launchError || ''});
    });
  });
}

export class NativeBridge {
  constructor({root, executable, compiler}) {
    this.root = resolve(root); this.executable = executable; this.compiler = compiler;
    this.token = randomBytes(24).toString('hex'); this.busy = false;
    this.health = {available:false, code:'not_configured', detail:'尚未配置仓颉核心和 SDK；现有诊断记录仍可浏览。'};
  }
  async probe() {
    if (!this.executable || !this.compiler) return this.health;
    const r = await runNative(this.executable, ['--version'], {timeout:8000});
    if (r.code !== 0 || r.reason || r.signal || !r.stdout.startsWith('Cangjie Code Doctor 0.2.0')) {
      this.health = {available:false, code:'native_unavailable', exitCode:r.code,
        detail:`仓颉核心未能正常启动（退出码 ${r.code ?? r.reason ?? '未知'}）。当前可查看记录，不能在本机实时编译。`};
    } else {
      const compiler = await runNative(this.compiler, ['--version'], {timeout:8000});
      if (compiler.code !== 0 || compiler.reason || compiler.signal || !compiler.stdout.startsWith('Cangjie Compiler: 1.0.5 (')) {
        this.health = {available:false, code:'sdk_unavailable', detail:'SDK 1.0.5 编译器未就绪；现有诊断记录仍可浏览。'};
      } else {
        this.health = {available:true, code:'ready', detail:'仓颉核心已就绪。仅可重新编译四个已审核样例，程序不会运行。', version:r.stdout.trim()};
      }
    }
    return this.health;
  }
  async compile(caseId, signal) {
    if (!EXAMPLE_IDS.includes(caseId)) throw Object.assign(new Error('只允许已审核的开发样例。'), {status:400});
    if (!this.health.available) throw Object.assign(new Error(this.health.detail), {status:503});
    if (this.busy) throw Object.assign(new Error('已有编译任务正在进行，请等待完成。'), {status:409});
    this.busy = true;
    const taskId = randomBytes(16).toString('hex');
    try {
      const r = await runNative(this.executable, ['compile-example', this.root, this.compiler, caseId, taskId, new Date().toISOString()], {signal});
      if (r.reason || r.signal) throw new Error(`仓颉任务未完成：${r.reason || r.signal}；未生成有效诊断记录。`);
      let result;
      try { result = JSON.parse(r.stdout); } catch { throw new Error(`仓颉任务异常退出（${r.code}），未返回有效记录。`); }
      if (r.code !== 0) throw new Error(result.detail || `仓颉任务失败（${r.code}）。`);
      if (result.taskId !== taskId || result.producer !== 'cangjie-core') throw new Error('仓颉记录与本次任务不匹配。');
      return result;
    } finally { this.busy = false; }
  }
  async history() {
    const parent = join(this.root, 'runs/native');
    let canonical, entries;
    try { canonical = await realpath(parent); entries = await readdir(canonical, {withFileTypes:true}); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    const canonicalRoot = await realpath(this.root);
    if (!canonical.startsWith(canonicalRoot + sep)) throw new Error('任务目录不在项目内。');
    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f]{32}$/.test(entry.name)) continue;
      try {
        const file = join(canonical, entry.name, 'record.json');
        const actual = await realpath(file);
        if (!actual.startsWith(canonical + sep)) continue;
        const text = await readFile(actual, 'utf8');
        if (Buffer.byteLength(text) > 2 * 1024 * 1024) continue;
        const r = JSON.parse(text);
        if (r.producer === 'cangjie-core' && r.taskId === entry.name) records.push(r);
      } catch { /* Incomplete and corrupt tasks remain on disk, but are not results. */ }
    }
    return records.sort((a,b) => String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0,20);
  }
}
