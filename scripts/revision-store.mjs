import { mkdir, lstat, open, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../web/report.mjs';
import { validateRevisionInput, validateRevision, validRevisionId, MAX_REVISION_BYTES } from '../web/revision.mjs';

function failure(status, message) { return Object.assign(new Error(message), {status}); }
async function childDirectory(parent, name, create = false) {
  const directory = join(parent, name);
  if (create) { try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(directory) !== directory)
    throw failure(400, '修改记录目录无效，不接受链接或项目外路径。');
  return directory;
}
async function boundedRead(file) {
  const stat = await lstat(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_REVISION_BYTES)
    throw failure(400, '修改记录文件过大或类型无效。');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_REVISION_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev)
      throw failure(400, '修改记录文件已变化或类型无效。');
    const buffer = Buffer.alloc(MAX_REVISION_BYTES + 1); let offset = 0;
    while (offset < buffer.length) {
      const {bytesRead} = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > MAX_REVISION_BYTES) throw failure(400, '修改记录读取期间超过大小限制。');
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0, offset));
  } finally { await handle.close(); }
}

export class RevisionStore {
  constructor(root) { this.root = resolve(root); }
  async directory(create = false) {
    const root = await realpath(this.root);
    const runs = await childDirectory(root, 'runs', create);
    return childDirectory(runs, 'revisions', create);
  }
  async save(input) {
    try { await validateRevisionInput(input); }
    catch (error) { throw failure(400, error.message); }
    // JSON cloning also freezes the accepted base record against caller mutation.
    const baseRecord = JSON.parse(JSON.stringify(input.baseRecord));
    const source = {name:input.source.name,text:input.source.text,sha256:await sha256(input.source.text)};
    const revision = {schemaVersion:1,kind:'doctor-manual-revision',revisionId:randomBytes(16).toString('hex'),
      createdAt:new Date().toISOString(),baseRecord,recordSha256:await sha256(JSON.stringify(baseRecord)),
      source,origin:'manual',compileStatus:'not_run',testStatus:'not_run',execution:{attempted:false}};
    await validateRevision(revision);
    const parent = await this.directory(true), directory = join(parent,revision.revisionId);
    await mkdir(directory); // Exclusive ID; never replace an earlier confirmed edit.
    await childDirectory(parent,revision.revisionId);
    await writeFile(join(directory,'revision.pending.json'),JSON.stringify(revision),{flag:'wx'});
    await rename(join(directory,'revision.pending.json'),join(directory,'revision.json'));
    return revision;
  }
  async get(revisionId) {
    if (!validRevisionId(revisionId)) throw failure(400, '无效的修改记录编号。');
    try {
      const directory = await childDirectory(await this.directory(), revisionId);
      const revision = await validateRevision(JSON.parse(await boundedRead(join(directory,'revision.json'))));
      if (revision.revisionId !== revisionId) throw new Error('修改记录与目录编号不一致。');
      return revision;
    } catch (error) {
      if (error.code === 'ENOENT') throw failure(404, '修改记录不存在。');
      throw failure(400, error.message);
    }
  }
  async list() {
    let entries;
    try { entries = await readdir(await this.directory(), {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') return {revisions:[],unreadable:0}; throw error; }
    const revisions = []; let unreadable = 0;
    for (const entry of entries) {
      if (!validRevisionId(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) { unreadable++; continue; }
      try {
        const revision = await this.get(entry.name);
        revisions.push({revisionId:revision.revisionId,createdAt:revision.createdAt,sourceName:revision.source.name,
          sourceSha256:revision.source.sha256,baseName:revision.baseRecord.source.name});
      } catch { unreadable++; }
    }
    revisions.sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.revisionId.localeCompare(b.revisionId));
    return {revisions:revisions.slice(0,20),unreadable};
  }
}
