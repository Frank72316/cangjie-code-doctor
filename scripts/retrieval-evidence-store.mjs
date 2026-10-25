// Attach only a completed local retrieval whose original record and pinned corpus agree.
import { lstat, open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { sha256, MAX_REPORT_BYTES } from '../web/report.mjs';
import { validateDocumentEvidence, MAX_DOCUMENT_EVIDENCE_BYTES } from '../web/document-evidence.mjs';
import { corpusSnapshot, validatedResult } from './retrieval.mjs';

const fail = message => Object.assign(new Error(message),{status:400});
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
async function childDirectory(parent, name) {
  const directory = join(parent,name), stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(directory) !== directory)
    throw fail('文档依据目录无效，不接受链接或项目外路径。');
  return directory;
}
async function boundedText(file, maxBytes) {
  const before = await lstat(file);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size > maxBytes)
    throw fail('文档依据文件过大或类型无效，不接受链接。');
  const handle = await open(file,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const actual = await handle.stat();
    if (!actual.isFile() || actual.nlink !== 1 || actual.size > maxBytes || actual.ino !== before.ino || actual.dev !== before.dev)
      throw fail('文档依据文件已变化或类型无效。');
    const buffer = Buffer.alloc(maxBytes + 1); let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer,size,buffer.length-size,null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes || await realpath(file) !== file) throw fail('文档依据读取期间超限或路径变化。');
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
  } finally { await handle.close(); }
}

export async function readCompletedRetrieval(root, retrievalId, baseRecord) {
  if (typeof retrievalId !== 'string' || !/^[a-f0-9]{32}$/.test(retrievalId)) throw fail('文档检索编号无效。');
  try {
    const canonicalRoot = await realpath(root);
    const runs = await childDirectory(canonicalRoot,'runs');
    const retrievals = await childDirectory(runs,'retrieval');
    const directory = await childDirectory(retrievals,retrievalId);
    try { await lstat(join(directory,'failure.json')); throw fail('此检索含失败记录，不能作为已完成依据附带。'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const evidence = JSON.parse(await boundedText(join(directory,'evidence.json'),MAX_DOCUMENT_EVIDENCE_BYTES));
    const request = JSON.parse(await boundedText(join(directory,'request.json'),MAX_REPORT_BYTES + 16384));
    const query = JSON.parse(await boundedText(join(directory,'query.json'),16384));
    const storedCorpus = await boundedText(join(directory,'corpus.json'),256 * 1024);
    await validateDocumentEvidence(evidence,baseRecord);
    if (!exact(request,['schemaVersion','kind','retrievalId','createdAt','sourceSha256','recordSha256','corpusSha256','query','queryOrigin','record'])
      || request.schemaVersion !== 1 || request.kind !== 'doctor-retrieval-request'
      || request.retrievalId !== retrievalId || evidence.retrievalId !== retrievalId
      || request.createdAt !== evidence.createdAt || request.sourceSha256 !== baseRecord.source.sha256
      || request.recordSha256 !== evidence.recordSha256 || request.corpusSha256 !== evidence.corpusSha256
      || request.query !== evidence.query || request.queryOrigin !== evidence.queryOrigin
      || await sha256(JSON.stringify(request.record)) !== evidence.recordSha256
      || !exact(query,['sdkVersion','query','topK']) || query.sdkVersion !== evidence.sdkVersion
      || query.query !== evidence.query || query.topK !== evidence.topK)
      throw fail('文档依据与原始检索请求、查询或诊断记录不一致。');
    const pinned = await corpusSnapshot(canonicalRoot);
    if (await sha256(storedCorpus) !== evidence.corpusSha256 || evidence.corpusSha256 !== pinned.sha256)
      throw fail('文档依据与已核验的官方快照不一致，请重新检索。');
    // The pinned hash also verifies the archived corpus bytes. Ranking stays native;
    // validatedResult checks the exact excerpt membership and sorted score contract.
    validatedResult(evidence,pinned.corpus,request.query);
    await childDirectory(retrievals,retrievalId);
    return evidence;
  } catch (error) {
    if (error.code === 'ENOENT') throw fail('未找到完整的本机文档检索依据，请重新检索后保存。');
    throw fail(error.message);
  }
}
