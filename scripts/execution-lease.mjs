// Linux cooperative execution ownership for one canonical workspace. flock(2)
// locks an open-file description: the short-lived flock child and this process
// share that description through stdio[3]. Keep this FD open until all work ends.
// Never unlink the file or explicitly LOCK_UN: an in-flight Docker CLI may still
// own an inherited FD and must keep excluding recovery after its parent exits.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const EXECUTION_LOCK_NAME = '.doctor-execution.lock';
const failure = (status, code, message) => Object.assign(new Error(message), {status, code});
const unavailable = detail => failure(503, 'execution_lock_unavailable', `无法取得本地执行锁：${detail}`);
const invalid = () => failure(409, 'execution_lease_lost', '本地执行锁已释放或工作目录、锁文件发生变化；已停止本次执行。');
const same = (left,right) => left.dev === right.dev && left.ino === right.ino;

async function existingDirectory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path)
    throw unavailable('工作目录或 runs 必须为真实目录，不接受链接。');
  return info;
}
function validFile(info) { return info.isFile() && !info.isSymbolicLink() && info.nlink === 1; }

async function lockDescriptor(fd) {
  return new Promise((resolveLock,rejectLock) => {
    let child, fault, stderr='', bytes=0;
    try {
      // The numeric-FD form locks fd 3 and exits; there is no shell or helper
      // command. All other inherited descriptors are closed by child_process.
      child = spawn('flock', ['--exclusive','--nonblock','--conflict-exit-code','75','3'],
        {shell:false,windowsHide:true,stdio:['ignore','pipe','pipe',fd]});
    } catch { rejectLock(unavailable('系统 flock 无法启动，请安装 Linux util-linux 后重试。')); return; }
    const timer = setTimeout(() => {
      fault = unavailable('系统 flock 检查超时，未启用执行。'); child.kill('SIGKILL');
    },5000);
    child.on('error',error => {
      fault = unavailable(error.code === 'ENOENT'
        ? '未找到系统 flock，请安装 Linux util-linux；不能降级为无锁执行。'
        : '系统 flock 无法启动，未启用执行。');
    });
    for (const stream of [child.stdout,child.stderr]) stream.on('data',chunk => {
      bytes += chunk.length;
      if (stream === child.stderr && stderr.length < 2048) stderr += chunk.toString('utf8').slice(0,2048-stderr.length);
      if (bytes > 16384 && !fault) {
        fault = unavailable('系统 flock 输出异常，未启用执行。'); child.kill('SIGKILL');
      }
    });
    child.on('close',(code,signal) => {
      clearTimeout(timer);
      if (fault) { rejectLock(fault); return; }
      if (code === 75 && !signal) {
        rejectLock(failure(409,'execution_locked','此工作目录已有其他服务或执行任务占用；请等待该任务结束，不会接管或终止它。')); return;
      }
      if (code !== 0 || signal) {
        rejectLock(unavailable(`系统 flock 未确认锁定（${signal || code}）${stderr.trim() ? '：'+stderr.trim() : '。'}`)); return;
      }
      resolveLock();
    });
  });
}

export async function acquireExecutionLease(root) {
  if (process.platform !== 'linux') throw unavailable('当前执行锁仅支持 Linux；其他平台不启用容器执行。');
  if (typeof root !== 'string' || !root || root.includes('\0')) throw unavailable('工作目录无效。');
  let handle;
  try {
    const canonical = await realpath(resolve(root)), rootIdentity = await existingDirectory(canonical);
    const directory = join(canonical,'runs');
    try { await mkdir(directory,{mode:0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const directoryIdentity = await existingDirectory(directory), path = join(directory,EXECUTION_LOCK_NAME);
    // Reject links before opening as well as via O_NOFOLLOW. An existing stable
    // inode is reused; truncation or removal would split ownership across files.
    try { if (!validFile(await lstat(path))) throw unavailable('锁文件必须为无链接的普通文件。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    handle = await open(path,constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,0o600);
    const fileIdentity = await handle.stat(), current = await lstat(path);
    if (!validFile(fileIdentity) || !validFile(current) || !same(current,fileIdentity)) throw unavailable('锁文件类型或身份已变化。');
    await lockDescriptor(handle.fd);
    const controller = new AbortController(); let released=false, releasePromise;
    const assertHeld = async () => {
      try {
        if (released || controller.signal.aborted) throw invalid();
        const [currentRoot,currentDirectory,currentFile,openedFile] = await Promise.all([
          existingDirectory(canonical),existingDirectory(directory),lstat(path),handle.stat()]);
        if (released || controller.signal.aborted || !same(currentRoot,rootIdentity) || !same(currentDirectory,directoryIdentity)
            || !validFile(currentFile) || !validFile(openedFile) || !same(currentFile,fileIdentity) || !same(openedFile,fileIdentity)) throw invalid();
        return true;
      } catch {
        const error = invalid(); controller.abort(error); throw error;
      }
    };
    await assertHeld();
    return {
      get fd() { if (released || controller.signal.aborted) throw invalid(); return handle.fd; },
      signal:controller.signal,
      assertHeld,
      release() {
        if (releasePromise) return releasePromise;
        released=true; controller.abort(invalid());
        // close, not LOCK_UN: inherited child FDs continue to protect in-flight
        // daemon requests until those child processes have actually ended.
        releasePromise=handle.close(); return releasePromise;
      }
    };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error.status) throw error;
    throw unavailable(`工作目录或稳定锁文件无法访问（${error.code || 'unknown'}）。`);
  }
}
