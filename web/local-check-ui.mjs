import {validateLocalCheck,localCheckHTML,LOCAL_LABELS,outputText} from './local-check.mjs';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
export function initLocalCheckUI({context,saveRevision,refreshHealth,download}){
  let busy=false,result=null,controller=null,runSource=null,previousBase=null,recoveryTimer=null;
  async function refreshAfterStop(){
    await refreshHealth();render();await history();
    if(context().health.busy)recoveryTimer=setTimeout(refreshAfterStop,1000);
  }
  function render(){
    const c=context(),example=c.source.name===c.record?.source.name&&c.health.localCheck?.examples?.find(x=>x.sourceSha256===c.record?.source.sha256);
    if(previousBase!==c.record){previousBase=c.record;$('local-custom').checked=false;result=null;$('local-result').replaceChildren();}
    $('local-options').hidden=!$('local-custom').checked;
    $('local-task').textContent=example?'本样例要求：'+example.task.replace(' LF 换行','换行'):'修改后可直接运行并查看输出；需要自动判断时，在下方填写期望输出。';
    $('local-check-run').disabled=busy||c.loading||!c.changed||!c.health.localCheck?.available||c.health.busy;
    $('local-check-run').textContent=busy?'正在编译并运行…':c.saved?'验证这份修改':'保存并验证这份修改';
    $('local-check-cancel').hidden=!busy;
    $('local-availability').textContent=c.health.localCheck?.available?'在本机运行你确认的源码；只运行自己信任的代码。':c.health.token?'本机运行尚未就绪，请展开“环境详情”检查；仍可单独保存修改。':'未连接本机运行服务。';
    $('local-stale').hidden=!result||result.revision.source.text===c.source.text&&result.revision.source.name===c.source.name;
    if(result)$('local-stale').textContent='代码又有修改，下方是上一次运行结果。请重新验证当前副本。';
  }
  function show(r){
    const area=$('local-result');area.replaceChildren();area.dataset.status=r.status;
    area.append(el('h3',LOCAL_LABELS[r.status]));
    area.append(el('p',`编译：${r.compile.exitCode===0&&!r.compile.reason?'通过':r.status==='compile_failed'?'未通过':'未完成'}　运行：${r.run?r.run.reason?'未完成':r.run.exitCode===0?'正常结束':'异常退出':'未运行'}`));
    if(r.run){area.append(el('strong','实际输出'),el('pre',outputText(r.run.stdout)||'（没有输出）'));}
    if(r.test.expectedStdout!==null)area.append(el('p','本次期望：'+JSON.stringify(r.test.expectedStdout)),el('p','比较文本时统一 Windows / Linux 换行；空格和末尾换行仍参与比较。','small-label'));
    if(r.status==='passed')area.append(el('p','本次输入下，实际输出符合期望。可继续修改代码或下载报告。'));
    if(r.status==='output_mismatch')area.append(el('p','程序能编译和运行，但结果没有满足要求。请继续检查代码。'));
    if(r.status==='ran')area.append(el('p','未设置期望输出，因此这里只展示运行结果，不能判断是否符合题意。'));
    if(r.status==='tool_error')area.append(el('p','本次没有得到完整验证结果：'+(r.run?.reason||r.compile.reason||'工具异常')+'。不能据此判断源码正确。'));
    const details=el('details'),summary=el('summary','编译器输出、标准错误与记录编号');details.open=['compile_failed','runtime_failed','tool_error'].includes(r.status);details.append(summary,
      el('pre',outputText(r.compile.stderr)+outputText(r.compile.stdout)||'编译器没有输出'),
      el('pre',r.run?outputText(r.run.stderr)||'运行没有标准错误':'程序未运行'),
      el('p',`修改 ${r.revision.revisionId} · 验证 ${r.checkId}`));area.append(details);
    for(const [label,extension,body,type]of[['下载验证报告 HTML','html',localCheckHTML(r),'text/html;charset=utf-8'],['下载验证记录 JSON','json',JSON.stringify(r,null,2),'application/json']]){
      const b=el('button',label);b.addEventListener('click',()=>download(`doctor-local-check-${r.checkId}.${extension}`,body,type));area.append(b);
    }
    area.append(el('p','本机检查仅覆盖本次输入；不是容器隔离测试或正式 A/B 成绩。','small-label'));render();
  }
  async function history(){
    const area=$('local-check-history');if(!context().health.token)return;
    try{const response=await fetch('/api/local-checks',{headers:{'X-Doctor-Token':context().health.token}});if(!response.ok)return;
      const data=await response.json();area.replaceChildren();
      for(const item of data.checks){const row=el('div','', 'local-history-row');row.append(el('span',`${item.sourceName} · ${LOCAL_LABELS[item.status]} · ${new Date(item.finishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`));
        const b=el('button','下载验证报告');b.addEventListener('click',async()=>{b.disabled=true;try{const res=await fetch('/api/local-checks/'+item.checkId,{headers:{'X-Doctor-Token':context().health.token}});const json=await res.json();if(!res.ok)throw Error(json.error);const r=await validateLocalCheck(json);download(`doctor-local-check-${r.checkId}.html`,localCheckHTML(r),'text/html;charset=utf-8');}catch(e){row.append(el('p',e.message));}finally{b.disabled=false;}});row.append(b);area.append(row);
      }
      if(!data.checks.length)area.append(el('p','尚无本机验证结果。在编译诊断页修改后，点“保存并验证这份修改”。'));
      if(data.unreadable)area.append(el('p',`${data.unreadable} 份任务缺少完整或有效结果，不能当作通过。`));
    }catch{area.textContent='验证记录暂时无法读取，请刷新重试。';}
  }
  $('local-custom').addEventListener('change',render);
  $('local-check-cancel').addEventListener('click',()=>controller?.abort());
  $('local-refresh-history').addEventListener('click',history);
  $('local-check-run').addEventListener('click',async()=>{
    if(busy||$('local-check-run').disabled)return;
    clearTimeout(recoveryTimer);
    const c=context();runSource={...c.source};
    const test=$('local-custom').checked?{stdin:$('local-stdin').value,expectedStdout:$('local-compare').checked?$('local-expected').value+($('local-newline').checked?'\n':''):null}:null;
    busy=true;controller=new AbortController();result=null;$('local-result').replaceChildren(el('p','正在保存副本并编译。编译成功后会运行，不需要跳转页面。'));render();
    try{
      const revision=await saveRevision();
      if(!revision?.revisionId)throw Error('未取得已确认的修改记录，请核对保存状态。');
      const now=context();if(now.source.text!==runSource.text||now.source.name!==runSource.name)throw Error('保存期间代码又有修改，本次没有运行。请重新核对。');
      const res=await fetch('/api/local-checks',{method:'POST',headers:{'Content-Type':'application/json','X-Doctor-Token':now.health.token},body:JSON.stringify({revisionId:revision.revisionId,confirmed:true,test}),signal:controller.signal});
      const data=await res.json();if(!res.ok)throw Error(data.error||'本机验证失败。');
      const checked=await validateLocalCheck(data);
      if(checked.revision.revisionId!==revision.revisionId||checked.revision.source.text!==runSource.text)throw Error('返回结果与本次修改不一致。');
      result=checked;show(result);
    }catch(e){$('local-result').replaceChildren(el('p',e.name==='AbortError'?'已请求停止。请在“记录与报告 → 本机修改验证”核对最终记录；没有完整报告不表示通过。':e.message));}
    finally{busy=false;controller=null;await refreshAfterStop();}
    $('local-result').scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  return {refresh:render,history};
}
