import { readEvidenceReview, reviewOutcome, reviewHTML, MAX_REVIEW_BYTES } from './evidence-review.mjs';
import { compileView } from './report.mjs';
import { lineDiff } from './revision.mjs';
import { officialDocumentURL } from './document-evidence.mjs';
import { outputDifference } from './output-difference.mjs';

const $ = id => document.getElementById(id);
const node = (tag,text='',className='') => {
  const item = document.createElement(tag); item.textContent = text;
  if (className) item.className = className;
  return item;
};
const time = value => value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(value)) : '未记录';
const testNames = {passed:'通过',failed:'输出不符',runtime_error:'运行异常',timeout:'超时',output_limit:'输出超限',oom:'内存超限',tool_error:'工具异常',cancelled:'已取消',launch_error:'启动失败',not_run:'未运行'};
const detail = (label,...children) => { const e=node('details'); e.append(node('summary',label),...children); return e; };

export function initEvidenceReviewUI({download}) {
  let generation = 0, archive = null, selected = null;
  const status = (message,error=false) => { $('evidence-review-status').textContent=message; $('evidence-review-status').dataset.state=error?'error':'idle'; };
  const discard = () => {
    archive=null; selected=null;
    $('evidence-review-result').hidden=true; $('evidence-review-result').replaceChildren();
    $('evidence-review-select').replaceChildren(); $('evidence-review-picker').hidden=true;
    $('evidence-review-download').disabled=true;
  };
  const render = () => {
    const entry=archive?.entries[Number($('evidence-review-select').value)];
    if (!entry) return;
    selected=entry;
    const {revision:r,verification:v}=entry, outcome=reviewOutcome(entry), base=compileView(r.baseRecord);
    const root=$('evidence-review-result'); root.replaceChildren(); root.hidden=false;
    const heading=node('div','','review-heading');
    heading.append(node('h3',r.source.name),node('strong',outcome.label,`review-verdict ${outcome.tone}`));
    root.append(heading,node('p','已有报告回看 · 本次没有编译或运行程序','review-boundary'),
      node('p',`修改保存：${time(r.createdAt)}；验证结束：${time(v?.finishedAt)}（北京时间）`,'review-meta'));
    const grid=node('div','','review-stages');
    const stage=(title,summary)=>{const e=node('section','','review-stage');e.append(node('h4',title),node('p',summary));grid.append(e);return e;};
    const diagnosis=stage('01 原报错',base.label);
    for(const d of base.diagnostics.slice(0,3)) diagnosis.append(node('p',`第 ${d.line ?? '未知'} 行：${d.message}`));
    diagnosis.append(detail('原源码与完整诊断',node('pre',r.baseRecord.source.text),node('pre',r.baseRecord.compiler.stderr || r.baseRecord.compiler.stdout || '（无编译器输出）')));
    const evidence=r.documentEvidence;
    const docs=stage('02 文档依据',evidence?`SDK ${evidence.sdkVersion} · ${evidence.results.length} 条摘录`:'未附带文档依据');
    if(evidence){
      if(!evidence.results.length) docs.append(node('p','本次查询没有匹配；不代表官方文档没有相关说明。'));
      for(const match of evidence.results){
        const link=node('a','查看官方原文 ↗');link.href=officialDocumentURL(match.url);link.target='_blank';link.rel='noopener noreferrer';
        docs.append(detail(`${match.title} · ${match.section}`,node('pre',match.text),link));
      }
      docs.append(node('p','仓颉官方文档贡献者 · CC BY 4.0；仅为原诊断参考。','review-meta'));
    }else docs.append(node('p','文件未附带引用，不能据此判断是否查阅过文档。'));
    const edit=stage('03 已确认修改','人工修改已存档；保存本身不执行验证。');
    const diff=lineDiff(r.baseRecord.source.text,r.source.text);
    edit.append(node('pre',diff.map(row=>`${row.kind==='add'?'+':row.kind==='remove'?'−':' '} ${row.text}`).join('\n'),'review-diff'));
    const tests=stage('04 公开测试',`${outcome.compileLabel} · ${outcome.testLabel}`);
    tests.append(node('p',outcome.detail));
    for(const [i,t] of (v?.tests || []).entries()){
      const result=v.report?.tests[i];
      const testDetail=detail(`${t.id} · ${testNames[result?.status] || '未取得结果'}`,
        node('p',`输入：${JSON.stringify(t.stdin)}`),node('p',`期望输出：${JSON.stringify(t.expectedStdout)}`),
        node('p',`实际输出：${result?.process?JSON.stringify(result.process.stdout):'未取得'}`));
      const difference=outputDifference(t,result);
      if(difference){testDetail.open=true;testDetail.append(node('p',difference,'output-difference'));}
      tests.append(testDetail);
    }
    root.append(grid);
    const identity=detail('核对记录身份与来源说明',
      node('p',`修改编号：${r.revisionId}`),node('p',`验证编号：${v?.verificationId || '未附带'}`),
      node('p',`源码 SHA-256：${r.source.sha256}`),node('p',`打开文件 SHA-256：${archive.fileSha256}`),
      node('p',`SDK：${v?.report?.sdkVersion || r.baseRecord.compiler.version}；容器镜像：${v?.report?.image || '未附带'}`),
      node('p',`材料包导出时间：${time(archive.exportedAt)}（北京时间；不是执行时间）`),
      node('p',v?.report?.containers?.length && v.report.containers.every(c=>c.cleanup.removed)?'原记录中的容器均有清理确认。':'没有取得全部容器清理确认。'),
      node('p','文件只在当前页面读取，不上传或写入本机历史，也不替换编辑器内容。哈希用于一致性核对，不证明来源真实；没有 AI 修复、保留测试或正式 A/B 结论。'));
    root.append(identity); $('evidence-review-download').disabled=false;
  };
  const openFile = async file => {
    if(!file) return;
    const request=++generation; discard(); $('evidence-review-clear').disabled=false;
    status('正在核对文件、源码和记录哈希…');
    try {
      if(!Number.isSafeInteger(file.size) || file.size<1 || file.size>MAX_REVIEW_BYTES) throw new Error('请选择不超过 32 MiB 的 JSON 文件。');
      const bytes=await file.arrayBuffer();
      if(bytes.byteLength!==file.size || bytes.byteLength>MAX_REVIEW_BYTES) throw new Error('文件大小发生变化，无法打开。');
      let text;
      try { text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes); }
      catch { throw new Error('文件不是有效的 UTF-8 JSON，无法核对原始字节。'); }
      const data=await readEvidenceReview(text);
      if(request!==generation) return;
      archive=data;
      if(!data.entries.length){status('材料包有效，但没有修改或验证记录。');return;}
      for(const [i,entry] of data.entries.entries()){
        const option=node('option',`${entry.revision.source.name} · ${reviewOutcome(entry).label} · ${time(entry.verification?.createdAt || entry.revision.createdAt)} · ${(entry.verification?.verificationId || entry.revision.revisionId).slice(0,8)}`);
        option.value=String(i);$('evidence-review-select').append(option);
      }
      $('evidence-review-select').value='0';$('evidence-review-picker').hidden=data.entries.length<2;
      status(`已打开 ${file.name || '报告 JSON'} · 内容与记录哈希核对通过 · ${data.entries.length} 份可回看记录。此校验不认证来源，也没有执行程序。`);render();
    }catch(error){if(request===generation){discard();status(`打开失败：${error.message} 请检查所选文件。`,true);}}
  };
  $('evidence-review-file').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';await openFile(file);});
  $('evidence-review-select').addEventListener('change',render);
  $('evidence-review-clear').addEventListener('click',()=>{generation++;discard();$('evidence-review-file').value='';$('evidence-review-clear').disabled=true;status('回看内容已清空，原文件和本机记录保持不变。');});
  $('evidence-review-download').addEventListener('click',()=>{
    if(selected) download(`doctor-review-${selected.verification?.verificationId || selected.revision.revisionId}.html`,reviewHTML(selected),'text/html;charset=utf-8');
  });
  return {openFile};
}
