import { mkdir, open, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readRecord, MAX_REPORT_BYTES } from '../web/report.mjs';
import { validTaskId, validateTask } from '../web/task.mjs';

const LOG_LIMIT = 16 * 1024;
const META_LIMIT = 256 * 1024;
const TERMINAL = ['completed','failed','cancelled','timed_out'];
function inside(path, parent) { return path.startsWith(parent + sep); }
export function logExcerpt(text) {
  const bytes = Buffer.from(text || '', 'utf8');
  return {text:bytes.subarray(0, LOG_LIMIT).toString('utf8'), truncated:bytes.length > LOG_LIMIT};
}
async function boundedRead(file, parent, limit, excerpt = false) {
  const actual = await realpath(file);
  if (!inside(actual, parent)) throw new Error('记录路径超出任务目录。');
  const handle = await open(actual, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (!excerpt && stat.size > limit)) throw new Error('记录文件过大或类型不符。');
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (!excerpt && offset > limit) throw new Error('记录读取期间超过大小限制。');
    return {text:buffer.subarray(0, Math.min(offset,limit)).toString('utf8'), truncated:offset > limit};
  } finally { await handle.close(); }
}
function ownerExists(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
}

export class TaskStore {
  constructor(root) { this.root = root; this.session = randomBytes(16).toString('hex'); }
  async directory(name, create = false) {
    const root = await realpath(this.root);
    const runs = join(root,'runs');
    if (create) await mkdir(runs,{recursive:true});
    const canonicalRuns = await realpath(runs);
    if (!inside(canonicalRuns,root)) throw new Error('任务目录不在项目内。');
    const directory = join(canonicalRuns,name);
    if (create) await mkdir(directory,{recursive:true});
    const actual = await realpath(directory);
    if (!inside(actual,canonicalRuns)) throw new Error('任务目录不在项目内。');
    return actual;
  }
  async begin(taskId, caseId) {
    if (!validTaskId(taskId)) throw new Error('Invalid task ID');
    const directory = join(await this.directory('tasks',true),taskId);
    await mkdir(directory); // Exclusive ID; never replace an existing task.
    const task = {schemaVersion:1, kind:'doctor-task', taskId, caseId, startedAt:new Date().toISOString(),
      finishedAt:null, state:'running', reason:'', detail:'任务已接收，正在等待仓颉核心返回。',
      ownerPid:process.pid, ownerSession:this.session};
    await writeFile(join(directory,'start.json'),JSON.stringify(task),{flag:'wx'});
    return task;
  }
  async finish(task) {
    validateTask(task);
    if (!TERMINAL.includes(task.state)) throw new Error('Invalid terminal state');
    const parent = await this.directory('tasks');
    const directory = await realpath(join(parent,task.taskId));
    if (!inside(directory,parent)) throw new Error('任务目录不在项目内。');
    const text = JSON.stringify(task);
    if (Buffer.byteLength(text) > META_LIMIT) throw new Error('Task metadata too large');
    await writeFile(join(directory,'finish.pending.json'),text,{flag:'wx'});
    await rename(join(directory,'finish.pending.json'),join(directory,'finish.json'));
  }
  async record(taskId, caseId) {
    const parent = await this.directory('native');
    const directory = await realpath(join(parent,taskId));
    if (!inside(directory,parent)) throw new Error('任务目录不在项目内。');
    const r = await readRecord((await boundedRead(join(directory,'record.json'),directory,MAX_REPORT_BYTES)).text);
    if (r.producer !== 'cangjie-core' || r.taskId !== taskId || (caseId && r.source.name !== caseId + '.cj'))
      throw new Error('原生诊断记录与任务不匹配。');
    return r;
  }
  async logs(taskId) {
    const logs = {};
    try {
      const parent = await this.directory('native');
      const directory = await realpath(join(parent,taskId));
      if (!inside(directory,parent)) return logs;
      for (const name of ['version.stdout','version.stderr','compiler.stdout','compiler.stderr']) {
        try { logs[name] = await boundedRead(join(directory,name),directory,LOG_LIMIT,true); }
        catch (e) { if (e.code !== 'ENOENT') logs[name] = {text:'日志不可读取。',truncated:false}; }
      }
    } catch { /* Launch failures may never create a native directory. */ }
    return logs;
  }
  async history(active = new Set()) {
    const tasks = new Map(); let unreadable = 0;
    try {
      const parent = await this.directory('tasks');
      for (const entry of await readdir(parent,{withFileTypes:true})) {
        if (!entry.isDirectory() || !validTaskId(entry.name)) continue;
        const directory = join(parent,entry.name);
        try {
          const start = validateTask(JSON.parse((await boundedRead(join(directory,'start.json'),directory,META_LIMIT)).text));
          if (start.taskId !== entry.name || start.state !== 'running' || !Number.isSafeInteger(start.ownerPid) || start.ownerPid <= 0)
            throw new Error('Invalid task start');
          let task;
          try {
            task = validateTask(JSON.parse((await boundedRead(join(directory,'finish.json'),directory,META_LIMIT)).text));
            if (!TERMINAL.includes(task.state) || task.taskId !== start.taskId || task.caseId !== start.caseId || task.startedAt !== start.startedAt)
              throw new Error('Mismatched task finish');
          } catch (e) {
            const missing = e.code === 'ENOENT';
            if (!missing) unreadable++;
            const state = missing && active.has(start.taskId) ? 'running' : missing && !ownerExists(start.ownerPid) ? 'interrupted' : 'unknown';
            task = {...start,state,reason:missing?'no_terminal_record':'invalid_terminal_record',detail:{
              running:'编译任务正在进行。', interrupted:'负责此任务的服务进程已退出，未留下最终状态；不推断编译结果。',
              unknown:'缺少可确认的最终状态；原服务可能仍在运行，未自动重试或终止其他进程。'
            }[state]};
          }
          tasks.set(task.taskId,task);
        } catch { unreadable++; }
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // Preserve pre-journal native tasks. Their complete records are still validated.
    try {
      const parent = await this.directory('native');
      for (const entry of await readdir(parent,{withFileTypes:true})) {
        if (!entry.isDirectory() || !validTaskId(entry.name) || tasks.has(entry.name)) continue;
        try {
          const r = await this.record(entry.name);
          tasks.set(entry.name,{schemaVersion:1,kind:'doctor-task',taskId:entry.name,caseId:r.source.name.replace(/\.cj$/,''),
            startedAt:r.capturedAt,finishedAt:null,state:'completed',reason:'legacy_record',detail:'早期原生记录；未采集任务结束时间。',record:r});
        } catch { unreadable++; }
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const recent = [...tasks.values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,20);
    for (const task of recent) {
      if (task.record) continue;
      try { task.record = await this.record(task.taskId,task.caseId); }
      catch (e) {
        if (task.state === 'completed') { task.state = 'unknown'; task.reason = 'record_unavailable'; task.detail = '最终状态存在，但诊断记录缺失或校验失败；不能确认编译结果。'; unreadable++; }
      }
      if (['interrupted','unknown'].includes(task.state)) task.logs = await this.logs(task.taskId);
    }
    return {tasks:recent, unreadable};
  }
}
