// Read-only material inventory and export. Never removes runs, locks or evidence.
import { lstat, opendir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateRevision } from '../web/revision.mjs';
import { validateVerificationRecord } from '../web/verification.mjs';

export const STORAGE_LIMITS = Object.freeze({maxEntries:20000, maxDepth:8, maxRecords:200, maxBytes:32 * 1024 * 1024});
const groupNames = ['tasks','native','retrieval','revisions','revision-verifications','other'];
const idPattern = /^[a-f0-9]{32}$/;
const fail = (status,message) => Object.assign(new Error(message),{status});
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = stat => `${stat.dev}:${stat.ino}`;
const version = stat => `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
const changed = () => fail(409,'记录在导出期间发生变化，请等待任务结束后重试。');

async function inspectDirectory(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(path) !== path)
    throw fail(400,'记录目录包含链接或无效类型，未读取其目标。');
  return stat;
}
async function rootState(root) {
  const canonical = await realpath(root);
  if (canonical !== root) throw fail(400,'工作区路径包含链接或别名，请使用真实工作区路径。');
  const rootIdentity = identity(await inspectDirectory(root));
  const runs = join(root,'runs');
  let runsIdentity = null;
  try { runsIdentity = identity(await inspectDirectory(runs)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return {root,rootIdentity,runs,runsIdentity};
}
async function guard(state) {
  const current = await rootState(state.root);
  if (current.rootIdentity !== state.rootIdentity || current.runsIdentity !== state.runsIdentity) throw changed();
}
async function directoryNames(path,limit) {
  const names=[];
  for await (const entry of await opendir(path)) {
    if (names.length === limit) throw fail(413,'材料条目超过导出上限 200 条，未生成截断的导出包。');
    names.push(entry.name);
  }
  return names.sort();
}
async function recordFiles(path,type) {
  const folder = await inspectDirectory(path);
  const allowed = type === 'revision' ? ['revision.json','revision.pending.json'] : ['request.json','verification.json','verification.pending.json'];
  const files=[];
  for await (const entry of await opendir(path)) {
    if (!allowed.includes(entry.name) || files.length === allowed.length)
      throw fail(400,'材料目录含未识别文件，未生成可能遗漏内容的导出包。');
    const filename=join(path,entry.name), stat=await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || await realpath(filename) !== filename)
      throw fail(400,'材料文件含链接或无效类型，导出已停止。');
    files.push({name:entry.name,version:version(stat)});
  }
  if (identity(await inspectDirectory(path)) !== identity(folder)) throw changed();
  files.sort((a,b) => a.name.localeCompare(b.name));
  return {identity:identity(folder),files};
}
async function entries(state) {
  await guard(state);
  const result=[];
  if (!state.runsIdentity) return result;
  for (const [name,type] of [['revisions','revision'],['revision-verifications','verification']]) {
    const directory=join(state.runs,name);
    let folder;
    try { folder=await inspectDirectory(directory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const id of await directoryNames(directory,STORAGE_LIMITS.maxRecords - result.length)) {
      if (!idPattern.test(id)) throw fail(400,'材料目录含未识别条目，导出已停止；没有跳过或删除原文件。');
      const info=await recordFiles(join(directory,id),type);
      result.push({type,id,parentIdentity:identity(folder),...info});
    }
    if (identity(await inspectDirectory(directory)) !== identity(folder)) throw changed();
  }
  await guard(state);
  return result;
}

export class StorageService {
  constructor({root,revisionStore,verificationService} = {}) {
    this.root=resolve(root || process.cwd()); this.revisionStore=revisionStore; this.verificationService=verificationService;
  }
  async summary() {
    const report={schemaVersion:1,kind:'doctor-storage-summary',scannedAt:new Date().toISOString(),complete:true,files:0,bytes:0,
      groups:groupNames.map(name=>({name,files:0,bytes:0})),issues:[],limits:{maxEntries:STORAGE_LIMITS.maxEntries,maxDepth:STORAGE_LIMITS.maxDepth}};
    const problem=message=>{report.complete=false; if (!report.issues.includes(message) && report.issues.length<20) report.issues.push(message);};
    let state;
    try { state=await rootState(this.root); }
    catch { problem('工作区或运行目录不可安全读取，统计不完整。'); return report; }
    if (!state.runsIdentity) return report;
    let visited=0, exhausted=false;
    const walk=async (path,depth,group) => {
      let initial;
      try {
        initial=await inspectDirectory(path);
        for await (const entry of await opendir(path)) {
          if (++visited>STORAGE_LIMITS.maxEntries) {exhausted=true; problem('达到遍历条目上限，显示的仅为已扫描部分。'); break;}
          const item=join(path,entry.name), selected=depth===0 ? (groupNames.slice(0,-1).includes(entry.name) ? entry.name : 'other') : group;
          try {
            // Check the parent again before examining each child; never follow a replaced link.
            if (identity(await inspectDirectory(path))!==identity(initial)) {problem('目录读取期间变化，统计不完整。'); break;}
            const stat=await lstat(item);
            if (stat.isSymbolicLink()) {problem('发现链接，未跟随目标，相关占用未计入。'); continue;}
            if (stat.isDirectory()) {
              if (depth>=STORAGE_LIMITS.maxDepth) problem('达到目录深度上限，显示的仅为已扫描部分。');
              else await walk(item,depth+1,selected);
            } else if (stat.isFile() && stat.nlink===1 && Number.isSafeInteger(stat.size)) {
              report.files++; report.bytes+=stat.size;
              const subtotal=report.groups.find(value=>value.name===selected); subtotal.files++; subtotal.bytes+=stat.size;
            } else problem('发现硬链接或特殊文件，相关占用未计入。');
          } catch {problem('部分条目不可读或已变化，统计不完整。');}
          if (exhausted) break;
        }
        const end=await inspectDirectory(path);
        if (identity(end)!==identity(initial) || end.mtimeMs!==initial.mtimeMs) problem('目录读取期间变化，统计不完整。');
      } catch {problem('部分目录不可安全读取，统计不完整。');}
    };
    await walk(state.runs,0,'other');
    try {await guard(state);} catch {problem('运行目录读取期间变化，统计不完整。');}
    return report;
  }
  async exportEvidence() {
    if (!this.revisionStore?.get || !this.verificationService?.get) throw fail(503,'修改或验证记录服务未配置，无法确认导出范围。');
    try {
      const state=await rootState(this.root), before=await entries(state);
      const bundle={schemaVersion:1,kind:'doctor-evidence-bundle',exportedAt:new Date().toISOString(),scope:'saved-revisions-and-verifications',
        revisions:[],verifications:[],manifest:[],counts:{revisions:0,verifications:0},limitations:[
          '仅包含已保存修改和独立验证记录；不包含原生任务目录、独立检索目录、容器恢复日志、二进制或保留测试，不是整个工作区备份。',
          '缺少结束记录的验证保留 unknown 状态，不补写成功结论。读取前后核对发现变化会拒绝导出，但这不是跨进程事务快照。',
          'SHA-256 仅用于一致性校验，不是数字签名。导出包可能含源码、编译日志和公开测试，分享前应自行审阅。']};
      let dataBytes=0;
      const read=async item=>{
        let value;
        try {
          value=await (item.type==='revision' ? this.revisionStore : this.verificationService).get(item.id);
          if (item.type==='revision') await validateRevision(value); else await validateVerificationRecord(value);
        } catch {throw fail(400,`材料 ${item.id} 无法完整读取或未通过校验，导出已停止；原文件保留。`);}
        if (value[item.type==='revision'?'revisionId':'verificationId']!==item.id) throw fail(400,'材料编号与目录不一致，导出已停止。');
        if (item.type==='verification' && value.state==='running') throw fail(409,'验证仍在进行，请完成后再导出材料。');
        return JSON.stringify(value);
      };
      for (const item of before) {
        const serialized=await read(item);
        dataBytes+=Buffer.byteLength(serialized);
        if (dataBytes>STORAGE_LIMITS.maxBytes) throw fail(413,'材料超过 32 MiB 导出上限，未生成截断的导出包。');
        const key=item.type==='revision'?'revisions':'verifications'; bundle[key].push(JSON.parse(serialized)); bundle.counts[key]++;
        bundle.manifest.push({type:item.type,id:item.id,sha256:hash(serialized)});
      }
      const revisions=new Map(bundle.revisions.map(value=>[value.revisionId,JSON.stringify(value)]));
      for (const value of bundle.verifications) {
        if (revisions.has(value.revision.revisionId) && revisions.get(value.revision.revisionId)!==JSON.stringify(value.revision))
          throw fail(400,'验证引用的修改与同编号修订不一致，导出已停止。');
      }
      if (JSON.stringify(before)!==JSON.stringify(await entries(state))) throw changed();
      for (let index=0;index<before.length;index++) {
        if (hash(await read(before[index]))!==bundle.manifest[index].sha256) throw changed();
      }
      if (JSON.stringify(before)!==JSON.stringify(await entries(state))) throw changed();
      if (Buffer.byteLength(JSON.stringify(bundle))>STORAGE_LIMITS.maxBytes) throw fail(413,'材料超过 32 MiB 导出上限，未生成截断的导出包。');
      return bundle;
    } catch (error) {
      if (error.status && error.status!==404) throw error;
      // Do not expose OS error strings that may contain workspace paths.
      throw fail(400,'部分材料不可读、已变化或不完整，导出已停止；原文件保留，请检查记录后重试。');
    }
  }
}
