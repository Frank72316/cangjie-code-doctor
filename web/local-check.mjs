import {validateRevision,validRevisionId} from './revision.mjs';
import {sha256} from './report.mjs';

export const LOCAL_LABELS={passed:'本次检查通过',output_mismatch:'输出与题目要求不符',ran:'已运行，尚未判断结果',compile_failed:'修改后仍有编译错误',runtime_failed:'程序运行失败',tool_error:'本次验证未完成'};
export function outputText(base64){return new TextDecoder().decode(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)));}
function processResult(p){
  if(!p||!(p.exitCode===null||Number.isSafeInteger(p.exitCode))||!(p.signal===null||typeof p.signal==='string')||typeof p.reason!=='string')throw Error('本机进程记录无效。');
  for(const name of ['stdout','stderr']){
    if(typeof p[name]!=='string'||p[name].length>1500000||p[name].length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(p[name]))throw Error('输出字节无效。');
    try{atob(p[name]);}catch{throw Error('输出字节无效。');}
  }
}
export function localOutcome(compile,run,expectedStdout){
  if(!compile||compile.reason||compile.signal)return 'tool_error';
  if(compile.exitCode===1)return 'compile_failed';
  if(compile.exitCode!==0)return 'tool_error';
  if(!run||run.reason||run.signal)return 'tool_error';
  if(run.exitCode!==0)return 'runtime_failed';
  if(expectedStdout===null)return 'ran';
  // Local console text: Windows println uses CRLF. Preserve raw output in the
  // report; normalize only CRLF for this explicit local comparison policy.
  let actual;
  try{actual=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(run.stdout),c=>c.charCodeAt(0)));}catch{return 'output_mismatch';}
  return actual.replace(/\r\n/g,'\n')===expectedStdout.replace(/\r\n/g,'\n')?'passed':'output_mismatch';
}
export async function validateLocalCheck(data){
  if(data?.kind!=='doctor-local-check'||data.schemaVersion!==1||!validRevisionId(data.checkId)||data.mode!=='trusted-local'||!LOCAL_LABELS[data.status]||!Number.isFinite(Date.parse(data.startedAt))||!Number.isFinite(Date.parse(data.finishedAt)))throw Error('不支持的本机验证报告。');
  if(data.comparison!=='text-crlf-to-lf')throw Error('本机比较规则无效。');
  await validateRevision(data.revision);
  if(typeof data.test?.stdin!=='string'||new TextEncoder().encode(data.test.stdin).length>4096||!(data.test.expectedStdout===null||typeof data.test.expectedStdout==='string')||new TextEncoder().encode(data.test.expectedStdout||'').length>16384)throw Error('测试内容无效。');
  processResult(data.compile);if(data.run)processResult(data.run);
  if(data.run&&(data.compile.exitCode!==0||data.compile.reason||data.compile.signal))throw Error('编译未完成却记录了运行结果。');
  if(data.status!==localOutcome(data.compile,data.run,data.test.expectedStdout))throw Error('本机验证结论与输出不一致。');
  const {sha256:hash,...payload}=data;
  if(hash!==await sha256(JSON.stringify(payload)))throw Error('本机验证报告摘要不一致。');
  return data;
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function localCheckHTML(r){
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本机修改验证</title><style>body{font:17px system-ui;max-width:980px;margin:40px auto;padding:20px;color:#20352b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4ef;padding:20px}h1{color:#355d38}</style><h1>${escape(LOCAL_LABELS[r.status])}</h1><p>本机实际编译与运行 · ${escape(r.finishedAt)} · 编号 ${escape(r.checkId)}</p><p>仅针对本次输入与期望，不是所有输入正确、容器隔离验收或正式 A/B。只运行自己信任的源码。</p><h2>修改后的源码</h2><pre>${escape(r.revision.source.text)}</pre><p>修改编号 ${escape(r.revision.revisionId)} / SHA-256 ${escape(r.revision.source.sha256)}</p><h2>编译输出</h2><pre>${escape(outputText(r.compile.stderr)+outputText(r.compile.stdout)||'无编译器输出')}</pre><h2>运行输入</h2><pre>${escape(JSON.stringify(r.test.stdin))}</pre><h2>比较规则</h2><p>本机文本比较仅将 CRLF 统一为 LF；空格及末尾换行仍参与比较。原始输出以 JSON 中的 Base64 字段保留。不是正式容器的逐字节比较。</p><h2>期望输出</h2><pre>${escape(r.test.expectedStdout===null?'未设置，仅展示运行输出':JSON.stringify(r.test.expectedStdout))}</pre><h2>实际输出</h2><pre>${escape(r.run?outputText(r.run.stdout):'未运行')}</pre><h2>运行状态 / 标准错误</h2><pre>${escape(r.run?JSON.stringify({exitCode:r.run.exitCode,reason:r.run.reason,stderr:outputText(r.run.stderr)},null,2):'编译未完成，未运行')}</pre><p>报告摘要 ${escape(r.sha256)}（一致性校验，不是数字签名）</p></html>`;
}
