// Public case preparation only: no compiler, model, reference or holdout access.
import { open, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePublicTests } from '../web/verification.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const text = (value, max) => typeof value === 'string' && value.isWellFormed() && value.trim().length > 0
  && Buffer.byteLength(value,'utf8') <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const categories = ['syntax','type','scope-or-api','logic','correct'];
export const CASE_LIMITS = Object.freeze({catalogBytes:2*1024*1024,sourceBytes:64*1024,maxCases:200,maxLines:200});
const expected = Object.freeze({development:10,evaluation:20,syntax:4,type:4,'scope-or-api':4,logic:4,correct:4});

function publicPath(value, kind) {
  const pattern = kind === 'source' ? /^(examples|data\/cases\/sources)\/[a-zA-Z0-9_-]+\.cj$/
    : /^data\/cases\/[a-zA-Z0-9_-]+\.json$/;
  requireThat(typeof value === 'string' && pattern.test(value),kind === 'source'
    ? '源码只允许 examples/ 或 data/cases/sources/ 下的单文件 .cj。'
    : '清单只允许 data/cases/ 下的 JSON 文件。');
}

// Inspect each component and read through a bounded handle. This is an offline
// preparation check, not a hostile concurrent-writer sandbox or an authenticity proof.
export async function readBounded(root, relative, maxBytes) {
  // Callers must also restrict the material kind; this shared reader never accepts traversal.
  requireThat(typeof relative === 'string' && /^[a-zA-Z0-9_./-]+$/.test(relative)
    && !relative.startsWith('/') && !relative.split('/').some(part => !part || part === '.' || part === '..'), '材料相对路径无效。');
  root = resolve(root);
  requireThat(await realpath(root) === root,'请使用无链接的工作区真实路径。');
  let path = root;
  const parts = relative.split('/');
  for (const [index,part] of parts.entries()) {
    path = join(path,part);
    const info = await lstat(path);
    requireThat(!info.isSymbolicLink() && await realpath(path) === path
      && (index === parts.length-1 ? info.isFile() && info.nlink === 1 : info.isDirectory()),'材料含链接或无效文件类型。');
  }
  const before = await lstat(path);
  requireThat(before.size <= maxBytes,'材料文件超过读取上限。');
  const handle = await open(path,'r');
  try {
    const current = await handle.stat();
    requireThat(current.dev === before.dev && current.ino === before.ino && current.isFile() && current.nlink === 1,'读取期间材料发生变化。');
    const bytes = Buffer.alloc(maxBytes+1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes,length,bytes.length-length,null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat(), final = await lstat(path);
    requireThat(length <= maxBytes,'材料文件超过读取上限。');
    requireThat([after,final].every(stat => stat.dev === before.dev && stat.ino === before.ino
      && stat.size === before.size && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs)
      && !final.isSymbolicLink() && await realpath(path) === path,'读取期间材料发生变化。');
    return bytes.subarray(0,length);
  } finally { await handle.close(); }
}

function validateCatalog(catalog) {
  requireThat(exact(catalog,['schemaVersion','kind','sdkVersion','cases']) && catalog.schemaVersion === 1
    && catalog.kind === 'doctor-public-case-catalog' && catalog.sdkVersion === '1.0.5','案例清单版本或字段无效。');
  requireThat(Array.isArray(catalog.cases) && catalog.cases.length <= CASE_LIMITS.maxCases,'案例数量超过上限。');
  const ids = new Set(), families = new Map(), sources = new Map();
  for (const item of catalog.cases) {
    requireThat(exact(item,['id','familyId','split','category','title','task','sourcePath','sourceSha256',
      'initialExpectation','origin','publicTests','review']),'案例字段不完整或包含未识别字段。');
    requireThat(id(item.id) && !ids.has(item.id),'案例编号无效或重复。'); ids.add(item.id);
    requireThat(id(item.familyId) && ['development','evaluation'].includes(item.split)
      && categories.includes(item.category),`${item.id}：划分、同源编号或分类无效。`);
    requireThat(!families.has(item.familyId) || families.get(item.familyId) === item.split,`${item.id}：同源题目跨开发集与评估集。`);
    families.set(item.familyId,item.split);
    requireThat(digest(item.sourceSha256),`${item.id}：源码摘要无效。`);
    requireThat(!sources.has(item.sourceSha256) || sources.get(item.sourceSha256) === item.split,`${item.id}：相同源码跨开发集与评估集。`);
    sources.set(item.sourceSha256,item.split);
    publicPath(item.sourcePath,'source');
    requireThat(text(item.title,200) && text(item.task,8192),`${item.id}：请填写标题、题意与输入输出约定。`);
    const initial = item.category === 'correct' ? 'passes-public-tests' : item.category === 'logic' ? 'fails-public-tests' : 'compile-error';
    requireThat(item.initialExpectation === initial,`${item.id}：初始预期与错误分类不符。`);
    requireThat(exact(item.origin,['kind','reference','permission']) && ['project-example','student','adapted'].includes(item.origin.kind)
      && text(item.origin.reference,1024) && ['project-owned','permission-pending','authorized'].includes(item.origin.permission)
      && (item.origin.permission !== 'project-owned' || item.origin.kind === 'project-example'),`${item.id}：来源或授权登记无效。`);
    validatePublicTests(item.publicTests,{allowEmpty:true});
    const inputs=new Map();
    for (const value of item.publicTests) {
      requireThat(!inputs.has(value.stdin) || inputs.get(value.stdin) === value.expectedStdout,`${item.id}：同一公开测试输入对应不同预期输出。`);
      inputs.set(value.stdin,value.expectedStdout);
    }
    requireThat(exact(item.review,['reviewers','referenceSha256','initialEvidenceSha256','holdoutCommitmentSha256'])
      && Array.isArray(item.review.reviewers) && item.review.reviewers.length <= 10
      && item.review.reviewers.every(name => text(name,120) && name === name.trim())
      && new Set(item.review.reviewers).size === item.review.reviewers.length
      && ['referenceSha256','initialEvidenceSha256','holdoutCommitmentSha256'].every(key => item.review[key] === null || digest(item.review[key])),`${item.id}：复核登记无效。`);
  }
  return catalog;
}

export async function checkCaseCatalog({root, catalogPath='data/cases/catalog.json'} = {}) {
  publicPath(catalogPath,'catalog');
  const data = await readBounded(root,catalogPath,CASE_LIMITS.catalogBytes);
  let catalog;
  try { catalog = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)); }
  catch { throw new Error('案例清单不是有效 UTF-8 JSON。'); }
  validateCatalog(catalog);
  const counts = {development:0,evaluation:0,evaluationByCategory:Object.fromEntries(categories.map(key=>[key,0]))};
  const blockers = [], manifest = [];
  for (const item of catalog.cases) {
    const source = await readBounded(root,item.sourcePath,CASE_LIMITS.sourceBytes);
    requireThat(sha(source) === item.sourceSha256,`${item.id}：源码与登记摘要不符，请复核修改后再更新清单。`);
    let code;
    try { code = new TextDecoder('utf-8',{fatal:true}).decode(source); } catch { throw new Error(`${item.id}：源码不是有效 UTF-8。`); }
    const lines = code.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').length;
    requireThat(code.trim().length > 0 && !code.includes('\0') && lines <= CASE_LIMITS.maxLines,`${item.id}：源码为空、含空字符或超过200行。`);
    counts[item.split]++;
    if (item.split === 'evaluation') counts.evaluationByCategory[item.category]++;
    const missing=[];
    if (item.origin.permission === 'permission-pending') missing.push('来源授权待确认');
    if (!item.publicTests.length) missing.push('缺少公开测试');
    if (item.review.reviewers.length < 2) missing.push('不足两名复核人');
    if (!item.review.referenceSha256) missing.push('缺少参考实现摘要');
    if (!item.review.initialEvidenceSha256) missing.push('缺少初始行为证据摘要');
    if (item.split === 'evaluation' && !item.review.holdoutCommitmentSha256) missing.push('缺少独立保留测试承诺摘要');
    if (missing.length) blockers.push({caseId:item.id,reasons:missing});
    manifest.push({id:item.id,sha256:sha(canonical(item))});
  }
  const gaps=[];
  for (const key of ['development','evaluation']) if (counts[key] !== expected[key]) gaps.push({field:key,actual:counts[key],expected:expected[key]});
  for (const key of categories) if (counts.evaluationByCategory[key] !== expected[key]) gaps.push({field:`evaluation.${key}`,actual:counts.evaluationByCategory[key],expected:expected[key]});
  return {schemaVersion:1,kind:'doctor-case-preparation',sdkVersion:catalog.sdkVersion,
    datasetSha256:sha(canonical(catalog)),manifest,counts,gaps,blockers,
    metadataComplete:!gaps.length && !blockers.length,
    scope:'public-catalog-only',experimentFrozen:false,
    limitations:['仅核验公开清单结构、源码摘要和登记完整性，不执行代码或模型。',
      '不读取参考实现或保留测试；复核人、授权和证据摘要的真实性仍须人工核查。',
      '登记完整不等于实验冻结，仍需验证模型预算、工具验收、保留测试隔离与配置冻结。']};
}

export function compareCaseSnapshots(previous,current) {
  for (const report of [previous,current]) {
    requireThat(report?.schemaVersion === 1 && report.kind === 'doctor-case-preparation' && report.sdkVersion === '1.0.5'
      && digest(report.datasetSha256) && Array.isArray(report.manifest) && report.manifest.length <= CASE_LIMITS.maxCases
      && report.manifest.every(item => exact(item,['id','sha256']) && id(item.id) && digest(item.sha256))
      && new Set(report.manifest.map(item=>item.id)).size === report.manifest.length,'比对基线不是有效的案例准备摘要。');
  }
  const before = new Map(previous.manifest.map(item=>[item.id,item.sha256]));
  const after = new Map(current.manifest.map(item=>[item.id,item.sha256]));
  return {unchanged:previous.datasetSha256 === current.datasetSha256
      && canonical(previous.manifest) === canonical(current.manifest),
    added:[...after.keys()].filter(key=>!before.has(key)),removed:[...before.keys()].filter(key=>!after.has(key)),
    changed:[...after.keys()].filter(key=>before.has(key) && before.get(key)!==after.get(key)),
    orderChanged:canonical([...before.keys()]) !== canonical([...after.keys()])};
}

export async function readCaseBaseline(root,relative) {
  requireThat(typeof relative === 'string' && /^runs\/case-preparation\/[a-zA-Z0-9_-]+\.json$/.test(relative),
    '基线只允许 runs/case-preparation/ 下的 JSON 文件。');
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(root,relative,CASE_LIMITS.catalogBytes))); }
  catch { throw new Error('无法读取有效的案例准备基线，请检查文件及大小。'); }
}
