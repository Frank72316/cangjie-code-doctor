// A local, append-only intent journal for cooperative Linux container ownership.
// Recovery never discovers containers by prefix: every exact name must already
// have a durable intent, and daemon identity is checked before removing its ID.
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { acquireExecutionLease } from './execution-lease.mjs';
import { SandboxContainer, runSandboxProcess } from './sandbox-container.mjs';

export const SANDBOX_LIFECYCLE_LIMITS = Object.freeze({operations:10000, filesPerOperation:160, intents:100000, recordBytes:4096});
const DOCKER_HOST = 'unix:///var/run/docker.sock';
const ID = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{64}$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;
const NAME = /^doctor-[0-9a-f]{32}$/;
const INTENT_KEYS = 'createdAt,image,kind,name,operationId,phase,schemaVersion,workspaceId';
const RECEIPT_KEYS = 'cleanedAt,containerId,detail,image,intentSha256,kind,name,operationId,phase,removed,schemaVersion,workspaceId';
const MARKER_KEYS = 'containerId,image,intentSha256,kind,name,operationId,phase,recordedAt,schemaVersion,workspaceId';
const MARKERS = Object.freeze({attempted:'doctor-sandbox-create-attempt',created:'doctor-sandbox-created','not-started':'doctor-sandbox-not-started'});
const digest = value => createHash('sha256').update(value).digest('hex');
const same = (left,right) => left.dev === right.dev && left.ino === right.ino;
const fail = message => Object.assign(new Error(`容器生命周期记录不可用：${message}`),{status:503,code:'sandbox_lifecycle_unavailable'});
const keys = value => value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort().join(',') : '';
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const brief = value => String(value ?? '').slice(0,512);
const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
const validFile = info => info.isFile() && !info.isSymbolicLink() && info.nlink === 1;

async function directoryIdentity(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || normalize(await realpath(path)) !== normalize(path))
    throw fail('目录不是规范路径下的真实目录，不接受链接。');
  return info;
}
async function syncDirectory(path) {
  // Windows does not expose fsync for directories through this API. Production
  // execution is Linux-only; injected Windows tests still fsync every record.
  if (process.platform !== 'linux') return;
  const handle = await open(path,constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function childDirectory(parent,name,{create=false,exclusive=false}={}) {
  const path = join(parent,name);
  if (create) {
    try { await mkdir(path,{mode:0o700}); await syncDirectory(parent); }
    catch (error) { if (exclusive || error.code !== 'EEXIST') throw error; }
  }
  return {path,identity:await directoryIdentity(path)};
}
async function boundedEntries(path,limit) {
  const entries=[];
  for await (const entry of await opendir(path)) {
    if (entries.length >= limit) throw fail('记录数量超过扫描上限，需人工核查归档后重试；不会跳过旧记录。');
    entries.push(entry);
  }
  return entries.sort((left,right) => left.name.localeCompare(right.name));
}
async function boundedRead(path) {
  const before = await lstat(path);
  if (!validFile(before) || before.size < 2 || before.size > SANDBOX_LIFECYCLE_LIMITS.recordBytes)
    throw fail('记录必须是有界、无链接的普通文件。');
  const handle = await open(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    if (!validFile(current) || !same(before,current) || current.size !== before.size) throw fail('记录读取前已变化。');
    const buffer=Buffer.alloc(SANDBOX_LIFECYCLE_LIMITS.recordBytes+1); let offset=0;
    while (offset < buffer.length) {
      const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);
      if (!bytesRead) break;
      offset+=bytesRead;
    }
    const after=await handle.stat(), named=await lstat(path);
    if (offset !== before.size || !validFile(after) || !validFile(named) || !same(after,before) || !same(named,before)
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs || named.mtimeMs !== before.mtimeMs)
      throw fail('记录读取期间已变化或超过大小限制。');
    const bytes=buffer.subarray(0,offset);
    let value;
    try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
    catch { throw fail('记录不是有效 UTF-8 JSON。'); }
    return {value,hash:digest(bytes)};
  } finally { await handle.close(); }
}
async function writeExclusive(path,value,guard) {
  const bytes=Buffer.from(JSON.stringify(value));
  if (bytes.length > SANDBOX_LIFECYCLE_LIMITS.recordBytes) throw fail('记录超过大小限制。');
  await guard();
  const handle=await open(path,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const info=await handle.stat(), named=await lstat(path);
    if (!validFile(info) || !validFile(named) || !same(info,named) || info.size !== bytes.length)
      throw fail('写盘后的记录身份发生变化。');
    await guard();
  } finally { await handle.close(); }
  await syncDirectory(resolve(path,'..'));
  return digest(bytes);
}
function validateIntent(value,{workspaceId,operationId,name}) {
  if (keys(value) !== INTENT_KEYS || value.schemaVersion !== 1 || value.kind !== 'doctor-sandbox-intent'
      || value.workspaceId !== workspaceId || value.operationId !== operationId || value.name !== name
      || !SHA.test(value.workspaceId) || !ID.test(value.operationId) || !NAME.test(value.name) || !IMAGE.test(value.image)
      || !['compile','run'].includes(value.phase) || !iso(value.createdAt)) throw fail('intent 损坏或不属于当前工作目录。');
  return value;
}
function validateReceipt(value,intent,intentSha256) {
  if (keys(value) !== RECEIPT_KEYS || value.schemaVersion !== 1 || value.kind !== 'doctor-sandbox-cleanup'
      || value.removed !== true || value.intentSha256 !== intentSha256 || !SHA.test(value.intentSha256)
      || !iso(value.cleanedAt) || Date.parse(value.cleanedAt) < Date.parse(intent.createdAt)
      || (value.containerId !== null && !SHA.test(value.containerId))
      || typeof value.detail !== 'string' || !value.detail || Buffer.byteLength(value.detail) > 2048
      || ['name','workspaceId','operationId','image','phase'].some(key => value[key] !== intent[key]))
    throw fail('清理 receipt 损坏或未与原 intent 绑定。');
  return value;
}
function validateMarker(value,intent,intentSha256,type) {
  if (keys(value) !== MARKER_KEYS || value.schemaVersion !== 1 || value.kind !== MARKERS[type]
      || value.intentSha256 !== intentSha256 || !iso(value.recordedAt) || Date.parse(value.recordedAt) < Date.parse(intent.createdAt)
      || (type === 'created' ? !SHA.test(value.containerId) : value.containerId !== null)
      || ['name','workspaceId','operationId','image','phase'].some(key=>value[key] !== intent[key]))
    throw fail('创建状态记录损坏或未绑定 intent。');
  return value;
}
function cleanupProof(markers,containerId) {
  if (markers.created) {
    if (containerId !== markers.created.containerId) throw fail('清理 ID 与已确认创建的容器不一致。');
  } else {
    if (markers.attempted && !markers['not-started'])
      throw fail('创建状态待人工核查：create 已尝试但未确认完成，瞬时缺失不能排除稍后出现的容器。');
    if (containerId !== null) throw fail('清理 ID 缺少已确认创建的记录。');
  }
}
function dockerEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^DOCKER_/i.test(key)));
}
function missing(result,identifier) {
  // A failing daemon connection, permission error, or truncated response is not
  // evidence of absence. Only Docker's explicit inspect-not-found response is.
  const match=/^Error(?: response from daemon)?: No such (?:container|object): ([^\r\n]+)\r?\n?$/i.exec(result.stderr.toString('utf8'));
  return result.reason === '' && result.code === 1 && result.stdout.toString('utf8').trim() === '[]'
    && match?.[1] === identifier;
}
function validateDockerResult(result,maxBytes) {
  if (!result || (result.code !== null && !Number.isInteger(result.code)) || typeof result.reason !== 'string'
      || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
      || result.stdout.length+result.stderr.length > maxBytes) throw fail('Docker 响应无效或超过大小限制。');
  return result;
}
function verifyIdentity(actual,intent) {
  const labels=actual?.Config?.Labels;
  if (!actual || !SHA.test(actual.Id) || actual.Name !== `/${intent.name}` || actual.Image !== intent.image
      || actual.Config?.Image !== intent.image || labels?.['org.cangjie.doctor.sandbox'] !== 'experimental-v1'
      || labels?.['org.cangjie.doctor.workspace'] !== intent.workspaceId
      || labels?.['org.cangjie.doctor.operation'] !== intent.operationId)
    throw fail(`登记容器 ${intent.name} 的身份或归属不符，未执行删除。`);
  return actual.Id;
}

export async function openSandboxExecution(root,{leaseFactory=acquireExecutionLease,executor=runSandboxProcess}={}) {
  if (typeof leaseFactory !== 'function' || typeof executor !== 'function') throw fail('执行依赖无效。');
  const lease=await leaseFactory(root);
  try {
    if (!lease || typeof lease.assertHeld !== 'function' || typeof lease.release !== 'function' || !lease.signal
        || !Number.isInteger(lease.fd) || lease.fd < 0) throw fail('执行锁接口无效。');
    await lease.assertHeld();
    const canonical=await realpath(resolve(root));
    const workspaceId=digest(canonical), operationId=randomBytes(16).toString('hex');
    const watched=[{path:canonical,identity:await directoryIdentity(canonical)}];
    const runs=await childDirectory(canonical,'runs',{create:true}); watched.push(runs);
    const journal=await childDirectory(runs.path,'sandbox-lifecycle',{create:true}); watched.push(journal);
    let released=false, releasePromise, operation;
    const guard=async (extra=[]) => {
      if (released) throw fail('当前执行已释放，不能继续操作容器。');
      await lease.assertHeld();
      for (const item of [...watched,...extra]) {
        if (!same(await directoryIdentity(item.path),item.identity)) throw fail('日志目录身份发生变化。');
      }
      await lease.assertHeld();
    };
    const guardedExecutor=async (executable,args,options={}) => {
      await guard();
      if (executable !== 'docker' || !Array.isArray(args) || args[0] !== '--host' || args[1] !== DOCKER_HOST)
        throw fail('Docker 必须使用固定本地 Unix socket。');
      const maxBytes=options.maxBytes ?? 256*1024;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32*1024*1024)
        throw fail('Docker 输出上限无效。');
      const signals=[lease.signal,options.signal].filter(Boolean);
      const result=await executor('docker',args,{...options,maxBytes,env:dockerEnvironment(),leaseFd:lease.fd,
        signal:signals.length === 1 ? signals[0] : AbortSignal.any(signals)});
      await guard();
      return validateDockerResult(result,maxBytes);
    };
    const execute=args => guardedExecutor('docker',['--host',DOCKER_HOST,...args],{timeoutMs:10000,maxBytes:256*1024});
    const inspect=async identifier => {
      const result=await execute(['container','inspect',identifier]);
      if (missing(result,identifier)) return null;
      if (result.code !== 0 || result.reason) throw fail(`无法核实容器 ${identifier}（${result.reason || result.code}）：${brief(result.stderr.toString('utf8'))}`);
      let values;
      try { values=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.stdout)); }
      catch { throw fail('Docker inspect 返回无效 JSON。'); }
      if (!Array.isArray(values) || values.length !== 1 || !values[0] || typeof values[0] !== 'object')
        throw fail('Docker inspect 返回身份不明确。');
      return values[0];
    };
    const receiptFor=(intent,intentSha256,containerId,detail) => ({schemaVersion:1,kind:'doctor-sandbox-cleanup',
      name:intent.name,image:intent.image,workspaceId:intent.workspaceId,operationId:intent.operationId,phase:intent.phase,
      intentSha256,removed:true,containerId,cleanedAt:new Date().toISOString(),detail:brief(detail)});
    const readMarkers=async entry => {
      const markers={};
      for (const type of Object.keys(MARKERS)) {
        try {
          const read=await boundedRead(join(entry.directory.path,`${entry.intent.name}.${type}.json`));
          markers[type]=validateMarker(read.value,entry.intent,entry.hash,type);
        } catch(error) { if(error.code !== 'ENOENT') throw error; }
      }
      if (markers.created && markers['not-started'] || markers['not-started'] && !markers.attempted)
        throw fail('创建状态记录彼此矛盾。');
      return markers;
    };
    const markerWrites=new Map();
    const saveMarker=(entry,type,containerId=null) => {
      const path=join(entry.directory.path,`${entry.intent.name}.${type}.json`);
      const existing=markerWrites.get(path);
      if(existing) {
        if(existing.containerId !== containerId) return Promise.reject(fail('已确认创建的容器 ID 发生变化。'));
        return existing.promise;
      }
      const promise=Promise.resolve().then(async()=>{
      await guard([entry.directory]);
      const marker={schemaVersion:1,kind:MARKERS[type],name:entry.intent.name,image:entry.intent.image,
        workspaceId:entry.intent.workspaceId,operationId:entry.intent.operationId,phase:entry.intent.phase,
        intentSha256:entry.hash,containerId,recordedAt:new Date().toISOString()};
      validateMarker(marker,entry.intent,entry.hash,type);
      try { await writeExclusive(path,marker,()=>guard([entry.directory])); }
      catch(error) {
        if(error.code !== 'EEXIST') throw error;
        const existing=validateMarker((await boundedRead(path)).value,entry.intent,entry.hash,type);
        if(existing.containerId !== containerId) throw fail('已确认创建的容器 ID 发生变化。');
        return existing;
      }
      return marker;
      });
      markerWrites.set(path,{containerId,promise});
      return promise;
    };
    const saveReceipt=async (entry,containerId,detail) => {
      await guard([entry.directory]);
      const intentRead=await boundedRead(entry.intentPath);
      validateIntent(intentRead.value,entry.intent);
      if (intentRead.hash !== entry.hash) throw fail('intent 已变化，不能登记清理结果。');
      cleanupProof(await readMarkers(entry),containerId);
      try {
        const old=await boundedRead(entry.receiptPath);
        return validateReceipt(old.value,entry.intent,entry.hash);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const receipt=receiptFor(entry.intent,entry.hash,containerId,detail);
      validateReceipt(receipt,entry.intent,entry.hash);
      try { await writeExclusive(entry.receiptPath,receipt,() => guard([entry.directory])); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        return validateReceipt((await boundedRead(entry.receiptPath)).value,entry.intent,entry.hash);
      }
      return receipt;
    };

    // Read and validate the complete bounded journal before any recovery mutation.
    const pending=[]; let count=0;
    for (const item of await boundedEntries(journal.path,SANDBOX_LIFECYCLE_LIMITS.operations)) {
      await guard();
      if (!ID.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) throw fail('operation 目录名称或类型无效。');
      const directory=await childDirectory(journal.path,item.name);
      const files=await boundedEntries(directory.path,SANDBOX_LIFECYCLE_LIMITS.filesPerOperation);
      const names=new Set(files.map(file => file.name));
      for (const file of files) {
        if (!/^doctor-[0-9a-f]{32}\.(?:intent|cleanup|attempted|created|not-started)\.json$/.test(file.name) || !file.isFile() || file.isSymbolicLink())
          throw fail('operation 中存在未知文件、链接或非普通记录。');
        if (!file.name.endsWith('.intent.json') && !names.has(file.name.replace(/\.(?:cleanup|attempted|created|not-started)\.json$/,'.intent.json')))
          throw fail('创建状态或清理 receipt 缺少原 intent。');
      }
      for (const file of files.filter(file => file.name.endsWith('.intent.json'))) {
        if (++count > SANDBOX_LIFECYCLE_LIMITS.intents) throw fail('intent 总数超过扫描上限，需人工核查归档。');
        await guard([directory]);
        const name=file.name.slice(0,-'.intent.json'.length), intentPath=join(directory.path,file.name);
        const read=await boundedRead(intentPath);
        const intent=validateIntent(read.value,{workspaceId,operationId:item.name,name});
        const receiptPath=join(directory.path,`${name}.cleanup.json`);
        const entry={directory,intentPath,receiptPath,intent,hash:read.hash};
        entry.markers=await readMarkers(entry);
        if (names.has(`${name}.cleanup.json`)) {
          const receipt=validateReceipt((await boundedRead(receiptPath)).value,intent,read.hash);
          cleanupProof(entry.markers,receipt.containerId);
        } else pending.push(entry);
        await guard([directory]);
      }
    }
    const recovered=[];
    for (const entry of pending) {
      await guard([entry.directory]);
      const actual=await inspect(entry.intent.name);
      let containerId=null;
      if (actual) {
        containerId=verifyIdentity(actual,entry.intent);
        if (entry.markers['not-started'] || entry.markers.created && entry.markers.created.containerId !== containerId)
          throw fail('实际容器与已登记创建状态或完整 ID 不符，未执行删除。');
        await saveMarker(entry,'created',containerId);
        const removed=await execute(['rm','--force','--volumes',containerId]);
        if (removed.code !== 0 || removed.reason) throw fail(`恢复清理失败（${removed.reason || removed.code}），保留 intent。`);
        if (await inspect(containerId) || await inspect(entry.intent.name)) throw fail('恢复清理后容器 ID 或名称仍存在，保留 intent。');
      } else {
        containerId=entry.markers.created?.containerId ?? null;
        cleanupProof(entry.markers,containerId);
        if(containerId && await inspect(containerId)) throw fail('登记名称虽缺失，但已登记容器 ID 仍存在，未执行删除。');
      }
      const receipt=await saveReceipt(entry,containerId,actual ? 'Recovery verified absence of both exact container ID and registered name.' : 'Recovery verified the registered container name is absent.');
      recovered.push({name:entry.intent.name,operationId:entry.intent.operationId,containerId,removed:true,cleanedAt:receipt.cleanedAt});
    }

    const buildContainer=async (options,factory=value => new SandboxContainer(value)) => {
      await guard();
      if (!options || !IMAGE.test(options.image) || !['compile','run'].includes(options.phase) || typeof factory !== 'function')
        throw fail('容器配置无效。');
      if (count >= SANDBOX_LIFECYCLE_LIMITS.intents) throw fail('intent 总数已达上限，需人工核查归档。');
      if (!operation) {
        if ((await boundedEntries(journal.path,SANDBOX_LIFECYCLE_LIMITS.operations)).length >= SANDBOX_LIFECYCLE_LIMITS.operations)
          throw fail('operation 数量已达上限，需人工核查归档。');
        operation=await childDirectory(journal.path,operationId,{create:true,exclusive:true});
      }
      await guard([operation]);
      if ((await boundedEntries(operation.path,SANDBOX_LIFECYCLE_LIMITS.filesPerOperation)).length > SANDBOX_LIFECYCLE_LIMITS.filesPerOperation-5)
        throw fail('本次 operation 的容器数量已达上限。');
      const instance=factory({...options,docker:'docker',dockerHost:DOCKER_HOST,executor:guardedExecutor,
        owner:{workspaceId,operationId},leaseFd:lease.fd});
      if (!instance || !NAME.test(instance.name) || instance.created || instance.createAttempted
          || typeof instance.create !== 'function' || typeof instance.remove !== 'function')
        throw fail('容器工厂未返回有效的未启动容器。');
      const name=instance.name, intent={schemaVersion:1,kind:'doctor-sandbox-intent',name,image:options.image,
        workspaceId,operationId,phase:options.phase,createdAt:new Date().toISOString()};
      const intentPath=join(operation.path,`${name}.intent.json`),receiptPath=join(operation.path,`${name}.cleanup.json`);
      const hash=await writeExclusive(intentPath,intent,() => guard([operation]));
      count++;
      const entry={directory:operation,intentPath,receiptPath,intent,hash};
      const held=async () => {
        await guard([operation]);
        if (instance.name !== name) throw fail('容器名称已变化。');
      };
      let creating=false, createCalled=false, deferredCleanup=false, recording;
      const originalRemove=instance.remove.bind(instance);
      instance.remove=async (...args) => {
        await held();
        const result=await originalRemove(...args);
        if (result?.removed !== true) return result;
        try {
          if(instance.lastInspection) {
            const confirmedId=verifyIdentity(instance.lastInspection,intent);
            await saveMarker(entry,'created',confirmedId);
          }
          if (creating) { deferredCleanup=true; return result; }
          const markers=await readMarkers(entry),containerId=markers.created?.containerId ?? null;
          cleanupProof(markers,containerId);
          if (!recording) recording=saveReceipt(entry,containerId,
            result.detail || 'Container implementation verified removal.').finally(() => { recording=null; });
          await recording;
          return result;
        } catch (error) {
          return {removed:false,detail:`容器已移除，但清理记录未确认：${brief(error.message)}`};
        }
      };
      const originalCreate=instance.create.bind(instance);
      instance.create=async (...args) => {
        await held();
        if(createCalled) throw fail('一个登记容器只能尝试创建一次。');
        createCalled=true;
        try { await lstat(receiptPath); throw fail('已有清理记录的容器不能再次创建。'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await saveMarker(entry,'attempted');
        creating=true;
        try {
          const actual=await originalCreate(...args);
          const confirmedId=verifyIdentity(actual,intent);
          await saveMarker(entry,'created',confirmedId);
          return actual;
        } catch(error) {
          // SandboxContainer sets createAttempted immediately before its Docker
          // call. Validation failures before that point never reach the daemon.
          if(instance.createAttempted !== true && !instance.created && !instance.containerId)
            await saveMarker(entry,'not-started');
          throw error;
        }
        finally {
          creating=false;
          if (deferredCleanup) {
            // A timeout may have removed before docker create finished. Never
            // publish that early absence as a durable terminal receipt.
            deferredCleanup=false; instance.removed=false;
            const cleanup=await instance.remove();
            if (!cleanup?.removed) throw fail(`创建结束后未确认清理：${brief(cleanup?.detail)}`);
          }
        }
      };
      for (const method of ['start','exec','inspect']) if (typeof instance[method] === 'function') {
        const original=instance[method].bind(instance);
        instance[method]=async (...args) => { await held(); return original(...args); };
      }
      return instance;
    };
    let containerQueue=Promise.resolve();
    const container=(...args) => {
      const pending=containerQueue.then(()=>buildContainer(...args));
      containerQueue=pending.catch(()=>{});
      return pending;
    };
    return {lease,workspaceId,operationId,recovered,container,
      release() {
        if (!releasePromise) { released=true; releasePromise=Promise.resolve().then(() => lease.release()); }
        return releasePromise;
      }};
  } catch (error) {
    await lease?.release?.().catch(() => {});
    throw error.status ? error : fail(`${error.code || 'unknown'}：${brief(error.message)}`);
  }
}
