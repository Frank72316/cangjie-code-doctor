// Transport and evidence storage only. Ranking/tokenization run in Cangjie.
import { open, realpath, mkdir, writeFile, rename } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readRecord, compileView } from '../web/report.mjs';
import { validateDocumentEvidence } from '../web/document-evidence.mjs';
import { logExcerpt } from './task-store.mjs';

const CORPUS_LIMIT = 256 * 1024;
const hash = text => createHash('sha256').update(text).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
export function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'docs.cangjie-lang.cn' ||
       (url.hostname === 'github.com' && url.pathname.startsWith('/cangjielanguage/cangjie_docs/')));
  } catch { return false; }
}
async function boundedText(file, parent, limit) {
  const actual = await realpath(file);
  if (!actual.startsWith(parent + sep)) throw new Error('文档或记录路径超出项目目录。');
  const handle = await open(actual,'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('文档文件类型或大小不符合约定。');
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await handle.read(buffer,size,buffer.length - size,null);
      if (!bytesRead) break; size += bytesRead;
    }
    if (size > limit) throw new Error('文档读取期间超出大小限制。');
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
  } finally { await handle.close(); }
}
export async function corpusSnapshot(root) {
  const canonicalRoot = await realpath(root);
  const manifest = JSON.parse(await boundedText(join(root,'data/docs/manifest.json'),canonicalRoot,16384));
  if (manifest.corpusFile !== 'cangjie-1.0.5.json' || manifest.sdkVersion !== '1.0.5' ||
      !/^[a-f0-9]{64}$/.test(manifest.corpusSha256)) throw new Error('文档清单无效。');
  const text = await boundedText(join(root,'data/docs/cangjie-1.0.5.json'),canonicalRoot,CORPUS_LIMIT);
  if (hash(text) !== manifest.corpusSha256) throw new Error('文档快照摘要不一致，请核对来源后重新建立清单。');
  const corpus = JSON.parse(text);
  if (corpus.schemaVersion !== 1 || corpus.sdkVersion !== '1.0.5' || corpus.snapshotId !== manifest.snapshotId ||
      corpus.sourceRevision !== manifest.sourceRevision || !Array.isArray(corpus.documents) ||
      corpus.documents.length < 1 || corpus.documents.length > 256) throw new Error('文档版本或快照信息不一致。');
  const ids = new Set();
  for (const doc of corpus.documents) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(doc?.id) || ids.has(doc.id) ||
        !['title','section','text'].every(key => typeof doc[key] === 'string' && doc[key].length > 0) ||
        doc.text.length > 2500 || !officialUrl(doc.url)) throw new Error('文档片段或来源地址无效。');
    ids.add(doc.id);
  }
  return {corpus,text,sha256:manifest.corpusSha256};
}
export function validatedResult(result, corpus, query) {
  if (result?.schemaVersion !== 1 || result.sdkVersion !== corpus.sdkVersion || result.snapshotId !== corpus.snapshotId ||
      result.sourceRevision !== corpus.sourceRevision || result.algorithm !== 'bm25' || result.query !== query ||
      result.parameters?.k1 !== 1.2 || result.parameters?.b !== 0.75 || result.topK !== 3 ||
      result.queryExpansion !== 'compiler-glossary-v1' || result.tokenizer !== 'ascii-lower-identifier+cjk-unigram-bigram-v1' ||
      typeof result.effectiveQuery !== 'string' || result.effectiveQuery.length > 4000 ||
      !Array.isArray(result.results) || result.results.length > 3)
    throw new Error('检索输出与请求或文档快照不一致。');
  const seen = new Set(); let previous = Infinity;
  for (const match of result.results) {
    const original = corpus.documents.find(doc=>doc.id === match?.id);
    if (!original || seen.has(match.id) || !['id','title','url','section','text'].every(key=>match[key] === original[key]) ||
        !Number.isFinite(match.score) || match.score <= 0 || match.score > previous)
      throw new Error('检索引用不属于当前快照，或排序结果无效。');
    seen.add(match.id); previous = match.score;
  }
  return result;
}

export async function retrieveEvidence(bridge, input, signal) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(input,'record') ||
      Object.keys(input).some(key=>!['record','query'].includes(key)) ||
      (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 2000 || input.query.includes('\0'))))
    throw fail('检索只接受诊断记录和不超过 2000 字符的查询，不接受文件路径。');
  let record;
  try { record = await readRecord(JSON.stringify(input.record)); }
  catch (error) { throw fail(error.message); }
  if (!/^Cangjie Compiler: 1\.0\.5(?:\s|$)/.test(record.compiler.version))
    throw fail('当前文档仅对应 SDK 1.0.5，不能用于此记录的编译器版本。',422);
  const view = compileView(record);
  if (view.status === 'tool_error') throw fail('当前记录是工具异常，请先取得有效的编译诊断。',422);
  const manual = input.query?.trim();
  const query = manual || view.diagnostics.map(d=>`${d.code} ${d.message} ${d.hint}`).join('\n').slice(0,2000).trim();
  const snapshot = await corpusSnapshot(bridge.root);
  if (signal?.aborted) throw fail('检索已取消。',499);
  const retrievalId = randomBytes(16).toString('hex');
  const directory = join(await bridge.store.directory('retrieval',true),retrievalId);
  await mkdir(directory);
  const createdAt = new Date().toISOString();
  const recordText = JSON.stringify(record);
  const request = {schemaVersion:1,kind:'doctor-retrieval-request',retrievalId,createdAt,
    sourceSha256:record.source.sha256,recordSha256:hash(recordText),corpusSha256:snapshot.sha256,
    query,queryOrigin:manual ? 'manual' : 'diagnostics',record};
  await writeFile(join(directory,'request.json'),JSON.stringify(request),{flag:'wx'});
  let native;
  try {
    await writeFile(join(directory,'corpus.json'),snapshot.text,{flag:'wx'});
    await writeFile(join(directory,'query.json'),JSON.stringify({sdkVersion:'1.0.5',query,topK:3}),{flag:'wx'});
    const relative = `runs/retrieval/${retrievalId}`;
    native = await bridge.executor(bridge.executable,['retrieve',`${relative}/corpus.json`,`${relative}/query.json`],
      {cwd:bridge.root,timeout:15000,signal});
    if (native.code !== 0 || native.reason || native.signal || native.stderr.trim())
      throw new Error(`文档检索未完成（${native.reason || native.signal || native.code}）。`);
    const result = validatedResult(JSON.parse(native.stdout),snapshot.corpus,query);
    // Retain a self-contained evidence object; ranking is never reproduced in JS.
    const evidence = {...result,kind:'doctor-document-evidence',retrievalId,createdAt,
      sourceName:record.source.name,sourceSha256:record.source.sha256,recordSha256:request.recordSha256,
      compilerVersion:record.compiler.version,corpusSha256:snapshot.sha256,queryOrigin:request.queryOrigin};
    await validateDocumentEvidence(evidence,record);
    await writeFile(join(directory,'evidence.pending.json'),JSON.stringify(evidence),{flag:'wx'});
    await rename(join(directory,'evidence.pending.json'),join(directory,'evidence.json'));
    return evidence;
  } catch (error) {
    const failure = {schemaVersion:1,kind:'doctor-retrieval-failure',retrievalId,createdAt,finishedAt:new Date().toISOString(),
      reason:error.message,process:native ? {...native,stdout:logExcerpt(native.stdout),stderr:logExcerpt(native.stderr)} : null};
    try { await writeFile(join(directory,'failure.json'),JSON.stringify(failure),{flag:'wx'}); }
    catch { throw new Error('检索失败且故障记录无法写入，请保留当前任务目录。'); }
    throw Object.assign(error,{retrievalId});
  }
}
