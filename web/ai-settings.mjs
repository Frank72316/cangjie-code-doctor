import {appendDocumentText} from './document-guide.mjs';
// Legacy field validator retained for future per-user setup; live calls use server-only config.
export function validateAIFields({baseURL,model,apiKey}) {
  const errors={};
  if (typeof baseURL!=='string' || !baseURL.trim() || baseURL.length>2048 || /[\s\x00-\x1f\x7f]/.test(baseURL)) {
    errors.baseURL='请填写完整服务地址，例如 https://api.example.com/v1。';
  } else {
    try {
      const url=new URL(baseURL);
      const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
      if ((url.protocol!=='https:' && !(url.protocol==='http:' && local)) || !url.hostname
        || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { errors.baseURL='请使用 HTTPS 基础地址，不要包含账号、密钥、查询参数或 #。本机服务可用 HTTP。'; }
  }
  if (typeof model!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model)) {
    errors.model='请填写模型 ID，可包含字母、数字、点、下划线、短横线、冒号和斜线。';
  }
  if (typeof apiKey!=='string' || apiKey.length<1 || apiKey.length>4096 || !/^[\x21-\x7e]+$/.test(apiKey)) {
    errors.apiKey='请填写 API Key，检查是否多复制了空格、换行或中文。';
  }
  // Do not return submitted values or include them in validation errors.
  return {valid:Object.keys(errors).length===0,errors};
}

export function initAISettings({context,download},doc=document) {
  const $=id=>doc.getElementById(id);
  let status=null,controller=null,snapshot=null,result=null;
  function refresh(){
    const c=context(),valid=c.record && c.current && !c.loading;
    $('ai-source-name').textContent=c.record ? `${c.record.source.name}${valid?'':' · 请恢复原诊断或重新载入记录'}` : '请先选择诊断样例';
    $('ai-use-docs').disabled=!c.evidence || !valid || !!controller;
    if(!c.evidence)$('ai-use-docs').checked=false;
    $('ai-document-count').textContent=c.evidence ? `可附带 ${c.evidence.results.length} 条已检索原文` : '尚未检索文档，可先去“文档依据”检索';
    $('ai-send').disabled=!!controller || !valid || !status?.configured || status.busy || status.used>=status.limit || !$('ai-consent').checked;
    $('ai-stop').hidden=!controller;
    $('ai-consent').disabled=!!controller;
    $('ai-stale').hidden=!result || (snapshot?.record===c.record && c.current);
  }
  async function loadStatus(){
    try{
      const token=context().health.token;if(!token){$('ai-local-status').textContent='等待本地服务就绪。';return;}
      const r=await fetch('/api/ai/status',{headers:{'X-Doctor-Token':token}});
      if(!r.ok)throw Error();status=await r.json();
      $('ai-local-status').textContent=status.configured?`已读取本地配置 · ${status.model} · 本次启动已调用 ${status.used}/${status.limit} 次` : status.detail;
    }catch{status=null;$('ai-local-status').textContent='无法读取本地 AI 配置，请检查工作台服务。';}finally{refresh();}
  }
  $('ai-refresh').addEventListener('click',loadStatus);
  $('ai-consent').addEventListener('change',refresh);
  $('ai-send').addEventListener('click',async()=>{
    const c=context();if(!c.current||!c.record||!$('ai-consent').checked||controller)return;
    snapshot={record:c.record};result=null;$('ai-answer-panel').hidden=true;
    const retrievalId=$('ai-use-docs').checked?c.evidence?.retrievalId:null;
    const abort=new AbortController();controller=abort;refresh();
    $('ai-request-status').textContent='正在请求 DeepSeek，通常需要等待一会儿；不会自动重试。';
    try{
      const r=await fetch('/api/ai/explain',{method:'POST',headers:{'Content-Type':'application/json','X-Doctor-Token':c.health.token},
        body:JSON.stringify({record:c.record,retrievalId,confirmed:true}),signal:abort.signal});
      const data=await r.json();if(!r.ok)throw Error(data.error||'调用失败');
      result=data;$('ai-answer').replaceChildren();appendDocumentText($('ai-answer'),data.answer,doc);
      $('ai-answer-meta').textContent=`${data.sourceName} · ${data.returnedModel} · 输入 ${data.usage.prompt_tokens??'未提供'} / 输出 ${data.usage.completion_tokens??'未提供'} tokens · ${data.retrievalId?'已附带文档':'未附带文档'}`;
      $('ai-answer-panel').hidden=false;
      if(!$('ai-assistant').hidden)$('ai-answer-panel').scrollIntoView({block:'start'});
      $('ai-request-status').textContent=data.truncated?'回答达到长度限制，可能不完整。未自动续写。':'建议已返回。模型没有执行代码，建议仍需人工核对。';
    }catch(e){$('ai-request-status').textContent=e.name==='AbortError'?'已停止等待；请求可能已计费。不要立即重复点击。':e.message;}
    finally{controller=null;$('ai-consent').checked=false;await loadStatus();}
  });
  $('ai-stop').addEventListener('click',()=>controller?.abort());
  $('ai-download').addEventListener('click',()=>{if(result)download(`${result.sourceName}.ai-advice.json`,JSON.stringify(result,null,2),'application/json');});
  return {refresh,loadStatus};
}
