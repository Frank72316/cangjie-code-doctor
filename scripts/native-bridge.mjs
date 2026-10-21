// Local HTTP transport for the Cangjie CLI. Compilation, snapshots and diagnostic
// interpretation live in src/compiler.cj. No shell and no user-supplied commands.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { TaskStore, logExcerpt } from './task-store.mjs';

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
  if (signal?.aborted) return Promise.resolve({code:null,signal:null,stdout:'',stderr:'',reason:'cancelled'});
  return new Promise(resolveResult => {
    const child = spawn(executable, args, {shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['ignore','pipe','pipe']});
    let stdout = '', stderr = '', size = 0, reason = '', exited = false;
    const stop = why => { if (!reason) { reason = why; stopTree(child); } };
    const timer = setTimeout(() => stop('timeout'), timeout);
    // Once the process has exited, a late UI cancel cannot rewrite its outcome.
    const abort = () => { if (!exited) stop('cancelled'); };
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
    child.on('exit', () => { exited = true; });
    child.on('error', error => { launchError = error.code || 'launch_error'; });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      resolveResult({code, signal:exitSignal, stdout, stderr, reason:reason || launchError || ''});
    });
  });
}

export class NativeBridge {
  constructor({root, executable, compiler, executor = runNative}) {
    this.root = resolve(root); this.executable = executable; this.compiler = compiler;
    this.token = randomBytes(24).toString('hex'); this.busy = false;
    // Executor injection is for deterministic fault tests, never exposed through HTTP.
    this.executor = executor; this.store = new TaskStore(this.root); this.active = new Set();
    this.health = {available:false, code:'not_configured', detail:'尚未配置仓颉核心和 SDK；现有诊断记录仍可浏览。'};
  }
  async probe() {
    if (!this.executable || !this.compiler) return this.health;
    const r = await this.executor(this.executable, ['--version'], {timeout:8000});
    if (r.code !== 0 || r.reason || r.signal || !r.stdout.startsWith('Cangjie Code Doctor 0.3.0')) {
      this.health = {available:false, code:'native_unavailable', exitCode:r.code,
        detail:`仓颉核心未能正常启动（退出码 ${r.code ?? r.reason ?? '未知'}）。当前可查看记录，不能在本机实时编译。`};
    } else {
      const compiler = await this.executor(this.compiler, ['--version'], {timeout:8000});
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
    this.active.add(taskId);
    try {
      const task = await this.store.begin(taskId,caseId);
      let r, result, state = 'failed', reason = 'native_error', detail;
      try {
        r = await this.executor(this.executable, ['compile-example', this.root, this.compiler, caseId, taskId, task.startedAt], {signal});
        if (r.reason || r.signal || r.code !== 0) {
          state = r.reason === 'cancelled' ? 'cancelled' : r.reason === 'timeout' ? 'timed_out' : 'failed';
          reason = r.reason || r.signal || 'native_exit';
          detail = {cancelled:'已终止本次编译请求；不据此判断源码是否正确。',timed_out:'任务超过时限，已终止；不据此判断源码是否正确。'}[state]
            || `仓颉任务未正常完成（${r.code ?? reason}），请查看任务日志。`;
        } else {
          reason = 'invalid_record';
          result = await this.store.record(taskId,caseId);
          const returned = JSON.parse(r.stdout);
          if (JSON.stringify(result) !== JSON.stringify(returned) || result.capturedAt !== task.startedAt)
            throw new Error('返回的诊断与磁盘记录不一致。');
          state = 'completed'; reason = ''; detail = '编译任务已完成，诊断及源码快照已保存；程序行为未验证。';
        }
      } catch (e) { detail = `任务未能完成：${e.message}`; }
      const finished = {...task,state,reason,detail,finishedAt:new Date().toISOString(),
        process:r ? {exitCode:r.code,signal:r.signal,reason:r.reason,stdout:logExcerpt(r.stdout),stderr:logExcerpt(r.stderr)} : null,
        logs:state === 'completed' ? {} : await this.store.logs(taskId)};
      // Publishing the terminal state is part of completion. A disk failure is not a success.
      try { await this.store.finish(finished); }
      catch { throw Object.assign(new Error('任务状态保存失败；请保留任务目录并刷新历史核查。'),{taskId}); }
      if (state !== 'completed') throw Object.assign(new Error(detail),{taskId,taskState:state});
      return result;
    } finally { this.active.delete(taskId); this.busy = false; }
  }
  async history() {
    return this.store.history(this.active);
  }
}
