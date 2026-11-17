// User-requested local execution of trusted, manually confirmed code.
// Time/output limits and process-tree termination are NOT a security sandbox.
import {spawn} from 'node:child_process';
import {join} from 'node:path';

export function localEnvironment() {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|CANGJIE_HOME|CANGJIE_PATH|CANGJIE_STDX_PATH)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
}
export function runLocalProcess(executable, args, {cwd, stdin='', timeout=5000, maxOutput=65536, signal}={}) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({exitCode:null,signal:null,reason:'cancelled',stdout:'',stderr:''});
    const child=spawn(executable,args,{cwd,env:localEnvironment(),shell:false,windowsHide:true,
      detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const out=[],err=[]; let size=0,reason='',exited=false;
    const stop=why=>{
      if(reason||exited)return;
      reason=why;
      if(!child.pid)return;
      if(process.platform==='win32'){
        const killer=spawn(join(process.env.SystemRoot||'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});
        killer.on('error',()=>child.kill());
        killer.on('close',code=>{if(code!==0&&!exited)child.kill();});
      }else{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
    };
    const timer=setTimeout(()=>stop('timeout'),timeout);
    const abort=()=>stop('cancelled');signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    for(const [stream,buffers]of[[child.stdout,out],[child.stderr,err]])stream.on('data',chunk=>{
      const room=Math.max(0,maxOutput-size);size+=chunk.length;if(room)buffers.push(chunk.subarray(0,room));
      if(size>maxOutput)stop('output_limit');
    });
    child.stdin.on('error',()=>{});child.stdin.end(stdin,'utf8');
    child.on('error',e=>{reason=reason||e.code||'launch_error';});
    child.on('exit',()=>{exited=true;});
    child.on('close',(exitCode,exitSignal)=>{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
      resolve({exitCode,signal:exitSignal,reason,stdout:Buffer.concat(out).toString('base64'),stderr:Buffer.concat(err).toString('base64')});
    });
  });
}
