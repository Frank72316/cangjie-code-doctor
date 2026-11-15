// Offline registration only. No model, compiler, container or private test access.
import { createHash } from 'node:crypto';
import { checkCaseCatalog, readBounded } from './case-catalog.mjs';
import { corpusSnapshot } from './retrieval.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value);
const number = (value,min,max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const optional = (value, check) => value === null || check(value);
export const EXPERIMENT_LIMITS = Object.freeze({configBytes:32768,templateBytes:32768,baselineBytes:65536});
const retrieval = {algorithm:'bm25',topK:3,k1:1.2,b:0.75,queryExpansion:'compiler-glossary-v1',
  tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1'};
const protocol = {groups:{A:'without-documents',B:'with-documents'},maxRounds:2,
  pairOrder:'catalog-alternating-ab-ba',retrievalAcrossRounds:'fixed-first-round',feedback:'own-public-results-only',
  stop:'public-pass-or-cancel-or-no-change-or-budget-or-round-limit',candidateSelection:'latest-format-valid',
  invalidResponseConsumesRound:true,serviceFailurePairRetries:1,holdoutAccess:'independent-after-all-candidates-locked',
  success:'compile-and-all-public-and-holdout',correctCases:'separate-regression-no-model',
  plannedErrorCases:16,plannedRegressionCases:4,maxPlannedGenerations:64};

async function jsonFile(root,path,limit) {
  const bytes=await readBounded(root,path,limit);
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new Error('材料不是有效 UTF-8 JSON。'); }
}

function validate(config) {
  requireThat(exact(config,['schemaVersion','kind','sdkVersion','catalogPath','sharedModel','budget','environment',
    'templates','retrieval','protocol']) && config.schemaVersion===1 && config.kind==='doctor-experiment-config'
    && config.sdkVersion==='1.0.5','实验配置版本或字段无效。');
  requireThat(typeof config.catalogPath==='string' && /^data\/cases\/[a-zA-Z0-9_-]+\.json$/.test(config.catalogPath),'案例清单路径无效。');
  const m=config.sharedModel;
  requireThat(exact(m,['provider','modelId','temperature','topP','maxOutputTokens','seed'])
    && optional(m.provider,identifier) && optional(m.modelId,identifier)
    && optional(m.temperature,v=>number(v,0,2)) && optional(m.topP,v=>number(v,Number.MIN_VALUE,1))
    && optional(m.maxOutputTokens,v=>Number.isSafeInteger(v) && v>=1 && v<=131072)
    && optional(m.seed,v=>Number.isSafeInteger(v) && v>=0 && v<=2147483647),'共享模型配置无效；两组只能共用一份模型与采样参数。');
  const b=config.budget;
  requireThat(exact(b,['currency','maxCost']) && optional(b.currency,v=>['CNY','USD'].includes(v))
    && optional(b.maxCost,v=>number(v,Number.MIN_VALUE,1000000)),'预算配置无效。');
  const e=config.environment;
  requireThat(exact(e,['platform','imageId','toolCommit','toolAcceptanceSha256','holdoutIsolationSha256'])
    && e.platform==='linux-docker' && optional(e.imageId,v=>typeof v==='string' && /^sha256:[a-f0-9]{64}$/.test(v))
    && optional(e.toolCommit,v=>typeof v==='string' && /^[a-f0-9]{40}$/.test(v))
    && optional(e.toolAcceptanceSha256,digest) && optional(e.holdoutIsolationSha256,digest),'环境登记无效；须使用不可变镜像 ID 和完整提交摘要。');
  requireThat(exact(config.templates,['sharedPrompt','publicFeedback']),'提示模板字段无效。');
  for (const ref of Object.values(config.templates)) requireThat(ref===null || (exact(ref,['path','sha256'])
    && typeof ref.path==='string' && /^data\/experiments\/prompts\/[a-zA-Z0-9_-]+\.txt$/.test(ref.path)
    && digest(ref.sha256)),'模板只允许公开 prompts 目录下的文本和摘要，不接受保留测试路径。');
  requireThat(canonical(config.retrieval)===canonical(retrieval),'检索参数与当前 SDK 1.0.5 检索实现不一致。');
  requireThat(canonical(config.protocol)===canonical(protocol),'对照协议偏离本版开题约定；不能独立更改组别、轮次、反馈、分母或保留测试规则。');
}

export async function checkExperimentConfig({root,configPath='data/experiments/config.json'}={}) {
  requireThat(typeof configPath==='string' && /^data\/experiments\/[a-zA-Z0-9_-]+\.json$/.test(configPath),'配置只允许 data/experiments/ 下的 JSON。');
  const config=await jsonFile(root,configPath,EXPERIMENT_LIMITS.configBytes);
  validate(config);
  const cases=await checkCaseCatalog({root,catalogPath:config.catalogPath});
  // Check the fixed public files with the bounded no-link reader before invoking
  // the existing corpus validator. Never follow a file path from the manifest.
  const manifestBytes=await readBounded(root,'data/docs/manifest.json',16384);
  const corpusBytes=await readBounded(root,'data/docs/cangjie-1.0.5.json',256*1024);
  const docs=await corpusSnapshot(root);
  requireThat(sha(corpusBytes)===docs.sha256,'读取期间文档材料发生变化。');
  const templateHashes={}, blockers=[];
  for (const [name,ref] of Object.entries(config.templates)) {
    templateHashes[name]=null;
    if (ref===null) { blockers.push({field:`templates.${name}`,reason:'尚未登记并复核公开提示模板'}); continue; }
    const bytes=await readBounded(root,ref.path,EXPERIMENT_LIMITS.templateBytes);
    let text;
    try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new Error('提示模板不是有效 UTF-8。'); }
    requireThat(text.trim() && !text.includes('\0'),'提示模板为空或含空字符。');
    requireThat(sha(bytes)===ref.sha256,`${name}：模板内容与登记摘要不一致。`);
    templateHashes[name]=sha(bytes);
  }
  for (const [section, fields] of Object.entries({sharedModel:['provider','modelId','temperature','topP','maxOutputTokens'],
    budget:['currency','maxCost'],environment:['imageId','toolCommit','toolAcceptanceSha256','holdoutIsolationSha256']})) {
    for (const field of fields) if (config[section][field]===null) blockers.push({field:`${section}.${field}`,reason:'尚未登记'});
  }
  if (!cases.metadataComplete) blockers.push({field:'cases',reason:'案例数量或复核材料尚未齐全'});
  const materials={config:sha(canonical(config)),cases:cases.datasetSha256,
    documents:sha(canonical({manifest:sha(manifestBytes),corpus:docs.sha256})),templates:sha(canonical(templateHashes))};
  return {schemaVersion:1,kind:'doctor-experiment-preparation',sdkVersion:'1.0.5',
    materials,snapshotSha256:sha(canonical(materials)),counts:cases.counts,
    caseGaps:cases.gaps,caseBlockers:cases.blockers,blockers,metadataComplete:blockers.length===0,
    protocol:structuredClone(protocol),corpusSha256:docs.sha256,snapshotId:docs.corpus.snapshotId,
    experimentFrozen:false,executionAuthorized:false,
    limitations:['本检查只核对公开配置、文档、案例及模板，不调用模型、不执行程序、不读取保留测试。',
      '登记齐全不代表冻结或允许执行；模型兼容性、预算、工具提交及验收摘要对应的证据仍须独立核实。',
      '两组共用模型、提示骨架和反馈模板；模板语义、公平性及不含保留测试仍需人工复核。',
      '摘要用于发现材料变化，不是签名、可信时间戳或实验成绩。']};
}

export function compareExperimentSnapshots(previous,current) {
  const keys=['config','cases','documents','templates'];
  for (const report of [previous,current]) requireThat(report?.schemaVersion===1
    && report.kind==='doctor-experiment-preparation' && report.sdkVersion==='1.0.5'
    && report.experimentFrozen===false && report.executionAuthorized===false
    && exact(report.materials,keys) && keys.every(key=>digest(report.materials[key]))
    && digest(report.snapshotSha256) && report.snapshotSha256===sha(canonical(report.materials)),
    '基线不是完整有效的实验准备摘要。');
  const changed=keys.filter(key=>previous.materials[key]!==current.materials[key]);
  return {unchanged:changed.length===0,changed};
}

export async function readExperimentBaseline(root,path) {
  requireThat(typeof path==='string' && /^runs\/experiment-preparation\/[a-zA-Z0-9_-]+\.json$/.test(path),
    '基线只允许 runs/experiment-preparation/ 下的 JSON。');
  return jsonFile(root,path,EXPERIMENT_LIMITS.baselineBytes);
}
