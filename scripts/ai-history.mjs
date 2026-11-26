import {open, lstat, realpath, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {officialDocumentURL} from '../web/document-evidence.mjs';

const idPattern=/^[a-f0-9]{32}$/;
const digest=text=>createHash('sha256').update(text).digest('hex');
const check=value=>{if(!value)throw new Error('AI 记录内容不一致或已损坏。');};
const text=(v,max)=>typeof v==='string' && v.length>0 && v.length<=max;
const date=v=>typeof v==='string' && Number.isFinite(Date.parse(v));
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));

// Fixed paths, no links, bounded reads. Local hashes detect mismatch, not authenticity.
async function child(parent,name,directory=false){
  const path=join(parent,name),stat=await lstat(path);
  check(!stat.isSymbolicLink() && (directory?stat.isDirectory():stat.isFile()));
  check(await realpath(path)===path);
  return path;
}
async function json(parent,name,optional=false){
  let path;
  try{path=await child(parent,name);}catch(e){if(optional && e.code==='ENOENT')return null;throw e;}
  const handle=await open(path,'r');
  try{
    check((await handle.stat()).size<=192*1024);
    const buffer=Buffer.alloc(192*1024+1);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
    check(offset<=192*1024);return JSON.parse(buffer.subarray(0,offset).toString('utf8'));
  }finally{await handle.close();}
}

function validateRequest(r,id){
  check(exact(r,['schemaVersion','kind','id','createdAt','model','thinking','maxTokens','temperature','sourceSha256','sourceName','retrievalId','messages']));
  check(r.schemaVersion===1 && r.kind==='doctor-ai-request' && r.id===id && date(r.createdAt));
  check(r.model==='deepseek-flash' && r.thinking==='disabled' && r.maxTokens===1500 && r.temperature===0);
  check(r.retrievalId===null || (typeof r.retrievalId==='string' && idPattern.test(r.retrievalId)));
  check(Array.isArray(r.messages) && r.messages.length===2);
  r.messages.forEach((m,i)=>check(exact(m,['role','content']) && m.role===(i?'user':'system') && text(m.content,24000)));
  const c=JSON.parse(r.messages[1].content);
  check(exact(c,['language','sdkVersion','source','diagnostics','documents']) && c.language==='Cangjie' && c.sdkVersion==='1.0.5');
  check(exact(c.source,['name','text','sha256']) && text(c.source.name,256) && typeof c.source.text==='string');
  check(c.source.name===r.sourceName && digest(c.source.text)===r.sourceSha256 && c.source.sha256===r.sourceSha256);
  check(Array.isArray(c.diagnostics) && c.diagnostics.length<=100);
  for(const d of c.diagnostics){
    check(exact(d,['code','severity','message','hint','line','column','file','canLocate']));
    check(['code','severity','message','hint','file'].every(k=>typeof d[k]==='string') && typeof d.canLocate==='boolean');
    check(['line','column'].every(k=>d[k]===null || Number.isSafeInteger(d[k])));
  }
  check(Array.isArray(c.documents) && c.documents.length<=3 && (r.retrievalId!==null || c.documents.length===0));
  for(const d of c.documents){check(exact(d,['id','title','url','text']) && text(d.id,80) && text(d.title,512) && text(d.text,2500));officialDocumentURL(d.url);}
  return c;
}

function validateResult(r,q,id){
  check(exact(r,['schemaVersion','kind','id','createdAt','finishedAt','requestSha256','sourceSha256','sourceName','retrievalId','requestedModel','returnedModel','usage','answer','truncated','compiled','executed','formalExperiment']));
  check(r.schemaVersion===1 && r.kind==='doctor-ai-advice' && r.id===id && r.createdAt===q.createdAt && date(r.finishedAt));
  check(r.requestSha256===digest(JSON.stringify(q)) && r.sourceSha256===q.sourceSha256 && r.sourceName===q.sourceName && r.retrievalId===q.retrievalId);
  check(r.requestedModel===q.model && text(r.returnedModel,160) && text(r.answer,24000) && typeof r.truncated==='boolean');
  check(r.compiled===false && r.executed===false && r.formalExperiment===false);
  check(r.usage && typeof r.usage==='object' && !Array.isArray(r.usage));
  check(Object.entries(r.usage).every(([k,v])=>['prompt_tokens','completion_tokens','total_tokens'].includes(k) && Number.isSafeInteger(v) && v>=0));
}

export class AIHistory {
  constructor(root){this.root=root;}
  async directory(){return child(await child(await realpath(this.root),'runs',true),'ai',true);}
  async read(id){
    if(typeof id!=='string' || !idPattern.test(id))throw Object.assign(new Error('AI 记录编号无效。'),{status:400});
    try{
      const folder=await child(await this.directory(),id,true);
      const request=await json(folder,'request.json');const context=validateRequest(request,id);
      const result=await json(folder,'result.json',true),failure=await json(folder,'failure.json',true);
      if(result)validateResult(result,request,id);
      // A failure and a result together are ambiguous; do not choose the favorable one.
      check(!(result && failure));
      if(failure)check(exact(failure,['finishedAt','started','message']) && date(failure.finishedAt) && typeof failure.started==='boolean' && text(failure.message,1000));
      const state=result?'completed':failure?'failed':'incomplete';
      return {schemaVersion:1,kind:'doctor-ai-history',id,state,createdAt:request.createdAt,sourceName:request.sourceName,
        request,context,result,message:result?'已保存 AI 建议，尚未验证代码。':failure?'调用未完成；可能已经计费，没有自动重试。':'未找到结束记录，可能仍在等待或曾被中断；不能推断成功。'};
    }catch(e){throw Object.assign(new Error(e.code==='ENOENT'?'AI 记录不存在或文件缺失。':'AI 记录无法核对，请检查本地归档。'),{status:e.code==='ENOENT'?404:409});}
  }
  async list(){
    let directory;
    try{directory=await this.directory();}catch(e){if(e.code==='ENOENT')return {items:[],limited:false};throw Object.assign(new Error('AI 历史目录不可读取。'),{status:409});}
    const entries=await readdir(directory,{withFileTypes:true});
    const candidates=[];
    for(const entry of entries){if(!idPattern.test(entry.name))continue;const stat=await lstat(join(directory,entry.name));candidates.push({id:entry.name,mtime:stat.mtimeMs});}
    candidates.sort((a,b)=>b.mtime-a.mtime || a.id.localeCompare(b.id));
    const items=[];
    for(const {id} of candidates.slice(0,100)){
      try{const r=await this.read(id);items.push({id,state:r.state,createdAt:r.createdAt,sourceName:r.sourceName,message:r.message});}
      catch{items.push({id,state:'invalid',createdAt:null,sourceName:'无法读取的记录',message:'文件缺失、损坏或关联不一致，未展示回答。'});}
    }
    return {items,limited:candidates.length>100};
  }
}
