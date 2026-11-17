import {mkdir,lstat,realpath,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validRevisionId} from '../web/revision.mjs';
import {sha256} from '../web/report.mjs';
import {validateLocalCheck,localOutcome} from '../web/local-check.mjs';
import {runLocalProcess} from './local-process.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const keys=(x,list)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===list.length&&list.every(k=>Object.hasOwn(x,k));
async function directory(parent,name){
  const path=join(parent,name);await mkdir(path,{recursive:false}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  const st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink()||await realpath(path)!==path)throw Error('本机验证目录无效。');return path;
}
export class LocalCheckService{
  constructor({root,bridge,revisionStore,runner=runLocalProcess,platform=process.platform,enabled=true}){
    this.root=resolve(root);this.bridge=bridge;this.revisionStore=revisionStore;this.runner=runner;this.platform=platform;this.enabled=enabled;this.examples=[];
  }
  get health(){return {available:this.enabled&&this.platform==='win32'&&Boolean(this.bridge?.health.available),mode:'trusted-local',examples:this.examples,
    detail:'本机运行自己信任的人工源码；这是本地运行，不是容器安全隔离。'};}
  async loadExamples(){
    const c=JSON.parse(await readFile(join(this.root,'data/cases/catalog.json'),'utf8'));
    this.examples=c.cases.filter(x=>['type_mismatch','undefined_name','argument_count','hello'].includes(x.id)).map(x=>({sourceSha256:x.sourceSha256,task:x.task,test:x.publicTests[0]}));
  }
  async parent(){return directory(await directory(this.root,'runs'),'local-checks');}
  async check(input,signal){
    if(!keys(input,['revisionId','confirmed','test'])||!validRevisionId(input.revisionId)||input.confirmed!==true)throw fail(400,'只接受已确认修改的编号和测试选项。');
    input=JSON.parse(JSON.stringify(input));
    if(input.test!==null&&(!keys(input.test,['stdin','expectedStdout'])||typeof input.test.stdin!=='string'||Buffer.byteLength(input.test.stdin)>4096||!(input.test.expectedStdout===null||typeof input.test.expectedStdout==='string')||Buffer.byteLength(input.test.expectedStdout||'')>16384))throw fail(400,'输入或期望输出无效或过大。');
    if(!this.health.available)throw fail(503,'本机验证暂不可用，请检查本机仓颉编译器。');
    if(this.bridge.busy)throw fail(409,'本机已有任务正在执行，请等待结束。');
    this.bridge.busy=true;
    try{
      const revision=await this.revisionStore.get(input.revisionId);
      const example=revision.source.name===revision.baseRecord.source.name&&this.examples.find(x=>x.sourceSha256===revision.baseRecord.source.sha256);
      const test=input.test||{stdin:example?.test?.stdin||'',expectedStdout:example?.test?.expectedStdout??null};
      const checkId=randomBytes(16).toString('hex'),startedAt=new Date().toISOString();
      const parent=await this.parent(),cwd=join(parent,checkId);await mkdir(cwd);
      const request={checkId,startedAt,revision,test,mode:'trusted-local'};
      await writeFile(join(cwd,'request.json'),JSON.stringify(request),{flag:'wx'});
      await writeFile(join(cwd,'input.cj'),revision.source.text,{flag:'wx'});
      const compile=await this.runner(this.bridge.compiler,['--diagnostic-format=noColor','--error-count-limit','8','input.cj','-o','program.exe'],{cwd,timeout:60000,maxOutput:1048576,signal});
      let run=null;
      if(compile.exitCode===0&&!compile.reason&&!compile.signal){
        const artifact=await lstat(join(cwd,'program.exe')).catch(()=>null);
        if(!artifact?.isFile()||artifact.isSymbolicLink())compile.reason='missing_artifact';
        else run=await this.runner(join(cwd,'program.exe'),[],{cwd,stdin:test.stdin,timeout:5000,maxOutput:65536,signal});
      }
      const payload={schemaVersion:1,kind:'doctor-local-check',...request,finishedAt:new Date().toISOString(),
        compilerVersion:this.bridge.health.compilerVersion||'SDK 1.0.5（基线）',comparison:'text-crlf-to-lf',compile,run,status:localOutcome(compile,run,test.expectedStdout)};
      const report={...payload,sha256:await sha256(JSON.stringify(payload))};await validateLocalCheck(report);
      await writeFile(join(cwd,'report.json'),JSON.stringify(report),{flag:'wx'});
      return report;
    }finally{this.bridge.busy=false;}
  }
  async get(id){
    if(!validRevisionId(id))throw fail(400,'无效的验证编号。');
    const parent=await this.parent(),cwd=join(parent,id),stat=await lstat(cwd);
    if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(cwd)!==cwd)throw fail(400,'验证目录无效。');
    const file=join(cwd,'report.json'),f=await lstat(file);
    if(!f.isFile()||f.isSymbolicLink()||f.size>4*1024*1024)throw fail(400,'验证报告无效。');
    const report=await validateLocalCheck(JSON.parse(await readFile(file,'utf8')));
    if(report.checkId!==id)throw fail(400,'报告编号不匹配。');
    const requestFile=join(cwd,'request.json'),requestStat=await lstat(requestFile);
    if(!requestStat.isFile()||requestStat.isSymbolicLink()||requestStat.size>4*1024*1024)throw fail(400,'请求记录无效。');
    const request=JSON.parse(await readFile(requestFile,'utf8'));
    if(JSON.stringify(request)!==JSON.stringify({checkId:report.checkId,startedAt:report.startedAt,revision:report.revision,test:report.test,mode:report.mode}))throw fail(400,'请求与结果不匹配。');
    return report;
  }
  async list(){
    const entries=await readdir(await this.parent(),{withFileTypes:true});const checks=[];let unreadable=0;
    for(const e of entries){if(!validRevisionId(e.name))continue;try{const r=await this.get(e.name);checks.push({checkId:r.checkId,revisionId:r.revision.revisionId,sourceName:r.revision.source.name,status:r.status,finishedAt:r.finishedAt});}catch{unreadable++;}}
    checks.sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt));return {checks:checks.slice(0,20),unreadable};
  }
}
