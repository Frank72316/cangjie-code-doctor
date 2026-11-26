import {appendDocumentText} from './document-guide.mjs';
import {compileView} from './report.mjs';

export function adviceMatchesCurrent(archive,c){
  return !!(archive && c.record && c.current && !c.loading
    && archive.context.source.sha256===c.record.source.sha256
    && archive.context.source.name===c.record.source.name
    && JSON.stringify(archive.context.diagnostics)===JSON.stringify(compileView(c.record).diagnostics));
}
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
  let status=null,controller=null,snapshot=null,result=null,archive=null,selection=0,historyVersion=0;
  function refresh(){
    const c=context(),valid=c.record && c.current && !c.loading;
    $('ai-source-name').textContent=c.record ? `${c.record.source.name}${valid?'':' · 请恢复原诊断或重新载入记录'}` : '请先选择诊断样例';
    $('ai-use-docs').disabled=!c.evidence || !valid || !!controller;
    if(!c.evidence)$('ai-use-docs').checked=false;
    $('ai-document-count').textContent=c.evidence ? `可附带 ${c.evidence.results.length} 条原文 · 检索时间：${when(c.evidence.createdAt)}` : '尚未选择文档，可先去“文档依据”检索或恢复历史记录';
    $('ai-send').disabled=!!controller || !valid || !status?.configured || status.busy || status.used>=status.limit || !$('ai-consent').checked;
    $('ai-stop').hidden=!controller;
    $('ai-consent').disabled=!!controller;
    $('ai-stale').hidden=archive?adviceMatchesCurrent(archive,c):(!result || (snapshot?.record===c.record && c.current));
    for(const b of $('ai-history-list').querySelectorAll('button'))b.disabled=!!controller;
  }
  const requestHeaders=()=>({'X-Doctor-Token':context().health.token});
  const when=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'时间未知';
  function showAnswer(data){
    result=data;$('ai-answer').replaceChildren();
    if(data)appendDocumentText($('ai-answer'),data.answer,doc);
    $('ai-answer-meta').textContent=data?`${data.sourceName} · ${when(data.createdAt)} · ${data.returnedModel} · 输入 ${data.usage.prompt_tokens??'未提供'} / 输出 ${data.usage.completion_tokens??'未提供'} tokens · ${data.retrievalId?'已附带文档':'未附带文档'}`:'';
    $('ai-answer-state').textContent=data?.truncated?'这份回答达到长度限制，可能不完整；没有自动续写。':'';
    $('ai-answer-panel').hidden=false;
  }
  function showArchive(data){
    archive=data;showAnswer(data.result);
    if(!data.result){$('ai-answer-meta').textContent=`${data.sourceName} · ${when(data.createdAt)}`;$('ai-answer-state').textContent=data.message;}
    $('ai-context-panel').hidden=false;$('ai-context-panel').open=!data.result;
    $('ai-context-source').textContent=data.context.source.text;
    const diagnostics=$('ai-context-diagnostics');diagnostics.replaceChildren();
    if(!data.context.diagnostics.length)diagnostics.textContent='当时没有编译诊断条目。';
    for(const d of data.context.diagnostics){const p=doc.createElement('p');p.textContent=`${d.canLocate?`第 ${d.line} 行，第 ${d.column} 列 · `:''}${d.code}: ${d.message}${d.hint?' · '+d.hint:''}`;diagnostics.append(p);}
    const documents=$('ai-context-documents');documents.replaceChildren();
    if(!data.context.documents.length)documents.textContent='这次没有附带文档。';
    for(const d of data.context.documents){
      const details=doc.createElement('details'),summary=doc.createElement('summary'),body=doc.createElement('div'),link=doc.createElement('a');
      summary.textContent=`[${d.id}] ${d.title}`;body.className='document-excerpt';appendDocumentText(body,d.text,doc);
      link.href=d.url;link.textContent='查看官方来源';link.target='_blank';link.rel='noopener noreferrer';
      details.append(summary,body,link);documents.append(details);
    }
    $('ai-download').textContent='下载回答与当时的提问内容';refresh();
  }
  async function openArchive(id){
    if(controller)return;const version=++selection;
    archive=null;result=null;$('ai-answer-panel').hidden=true;
    $('ai-history-status').textContent='正在核对这份记录…';
    try{
      const r=await fetch(`/api/ai/history/${id}`,{headers:requestHeaders()}),data=await r.json();
      if(version!==selection)return;if(!r.ok)throw Error(data.error||'读取失败');
      showArchive(data);$('ai-history-status').textContent='已读取本机记录，没有调用模型。';
      if(!$('ai-assistant').hidden)$('ai-answer-panel').scrollIntoView({block:'start'});
    }catch(e){if(version===selection)$('ai-history-status').textContent=e.message;}
  }
  async function loadHistory(){
    if(!context().health.token)return;const version=++historyVersion;
    try{
      const r=await fetch('/api/ai/history',{headers:requestHeaders()}),data=await r.json();
      if(version!==historyVersion)return;if(!r.ok)throw Error(data.error||'读取失败');
      const list=$('ai-history-list');list.replaceChildren();
      $('ai-history-status').textContent=data.items.length?`共显示 ${data.items.length} 条记录${data.limited?'，仅列出最近修改的 100 个归档':''}。`:'还没有 AI 调用记录。完成一次提问后会自动保存在这里。';
      for(const item of data.items){
        const row=doc.createElement('div'),info=doc.createElement('div'),title=doc.createElement('strong'),meta=doc.createElement('p'),button=doc.createElement('button');
        row.className='ai-history-row';title.textContent=item.sourceName;
        meta.textContent=`${when(item.createdAt)} · ${{completed:'已保存建议',failed:'调用未完成',incomplete:'结束状态待确认',invalid:'记录无法核对'}[item.state]}`;
        info.append(title,meta);
        if(item.state==='invalid'){const note=doc.createElement('p');note.textContent=item.message;info.append(note);row.append(info);}
        else{button.textContent=item.state==='completed'?'查看建议':'查看记录';button.addEventListener('click',()=>openArchive(item.id));row.append(info,button);}
        list.append(row);
      }
      refresh();
    }catch(e){if(version===historyVersion){$('ai-history-list').replaceChildren();$('ai-history-status').textContent=`无法读取历史：${e.message}`;}}
  }
  async function loadStatus(){
    try{
      const token=context().health.token;if(!token){$('ai-local-status').textContent='等待本地服务就绪。';return;}
      const r=await fetch('/api/ai/status',{headers:{'X-Doctor-Token':token}});
      if(!r.ok)throw Error();status=await r.json();
      $('ai-local-status').textContent=status.configured?`已读取本地配置 · ${status.model} · 本次启动已调用 ${status.used}/${status.limit} 次` : status.detail;
    }catch{status=null;$('ai-local-status').textContent='无法读取本地 AI 配置，请检查工作台服务。';}finally{refresh();await loadHistory();}
  }
  $('ai-refresh').addEventListener('click',loadStatus);
  $('ai-consent').addEventListener('change',refresh);
  $('ai-send').addEventListener('click',async()=>{
    const c=context();if(!c.current||!c.record||!$('ai-consent').checked||controller)return;
    ++selection;snapshot={record:c.record};result=null;archive=null;$('ai-answer-panel').hidden=true;$('ai-context-panel').hidden=true;
    $('ai-download').textContent='下载本次 AI 建议记录';
    const retrievalId=$('ai-use-docs').checked?c.evidence?.retrievalId:null;
    const abort=new AbortController();controller=abort;refresh();
    $('ai-request-status').textContent='正在请求 DeepSeek，通常需要等待一会儿；不会自动重试。';
    try{
      const r=await fetch('/api/ai/explain',{method:'POST',headers:{'Content-Type':'application/json','X-Doctor-Token':c.health.token},
        body:JSON.stringify({record:c.record,retrievalId,confirmed:true}),signal:abort.signal});
      const data=await r.json();if(!r.ok)throw Error(data.error||'调用失败');
      showAnswer(data);
      try{const saved=await fetch(`/api/ai/history/${data.id}`,{headers:requestHeaders()});if(saved.ok)showArchive(await saved.json());}catch{/* Live answer remains available if local history cannot be read. */}
      if(!$('ai-assistant').hidden)$('ai-answer-panel').scrollIntoView({block:'start'});
      $('ai-request-status').textContent=data.truncated?'回答达到长度限制，可能不完整。未自动续写。':'建议已返回。模型没有执行代码，建议仍需人工核对。';
    }catch(e){$('ai-request-status').textContent=e.name==='AbortError'?'已停止等待；请求可能已计费。不要立即重复点击。':e.message;}
    finally{controller=null;$('ai-consent').checked=false;await loadStatus();}
  });
  $('ai-stop').addEventListener('click',()=>controller?.abort());
  $('ai-history-refresh').addEventListener('click',loadHistory);
  $('ai-download').addEventListener('click',()=>{const saved=archive||result;if(saved)download(`${saved.sourceName}.ai-advice.json`,JSON.stringify(saved,null,2),'application/json');});
  return {refresh,loadStatus};
}
