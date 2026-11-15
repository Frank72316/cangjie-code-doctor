// Page design / local validation only. No network, persistent storage or exported key state.
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

export function initAISettings(doc=document,win=window) {
  const $=id=>doc.getElementById(id);
  const form=$('ai-settings-form');
  const fields={baseURL:$('ai-base-url'),model:$('ai-model'),apiKey:$('ai-key')};
  const errors={baseURL:$('ai-url-error'),model:$('ai-model-error'),apiKey:$('ai-key-error')};
  const result=$('ai-config-result'),state=$('ai-config-state'),toggle=$('ai-key-toggle');
  const hideKey=()=>{ fields.apiKey.type='password'; toggle.textContent='显示'; toggle.setAttribute('aria-pressed','false'); };
  const clearMessages=()=>{
    for (const name of Object.keys(fields)) {
      fields[name].removeAttribute('aria-invalid'); errors[name].textContent=''; errors[name].hidden=true;
    }
    result.hidden=true; result.textContent=''; result.removeAttribute('data-state');
  };
  const reset=()=>{
    for (const field of Object.values(fields)) field.value='';
    hideKey(); clearMessages(); state.textContent='待填写'; state.removeAttribute('data-state');
  };
  reset(); // Clear browser-restored form values on a fresh load.
  form.addEventListener('submit',event=>{
    event.preventDefault(); clearMessages(); hideKey();
    const validation=validateAIFields({baseURL:fields.baseURL.value,model:fields.model.value,apiKey:fields.apiKey.value});
    for (const [name,message] of Object.entries(validation.errors)) {
      fields[name].setAttribute('aria-invalid','true'); errors[name].textContent=message; errors[name].hidden=false;
    }
    state.textContent=validation.valid?'格式已检查':'请补全填写';
    state.dataset.state=validation.valid?'checked':'incomplete';
    result.hidden=false; result.dataset.state=validation.valid?'checked':'incomplete';
    result.textContent=validation.valid?'填写格式检查通过。内容仅临时留在本标签页，尚未连接服务或验证密钥。'
      :'还有填写项需要调整，请查看输入框下方的提示。';
    if (!validation.valid) fields[Object.keys(validation.errors)[0]].focus();
  });
  form.addEventListener('input',()=>{
    clearMessages(); state.textContent='待检查填写'; state.removeAttribute('data-state');
  });
  toggle.addEventListener('click',()=>{
    const show=fields.apiKey.type==='password'; fields.apiKey.type=show?'text':'password';
    toggle.textContent=show?'隐藏':'显示'; toggle.setAttribute('aria-pressed',String(show));
  });
  $('ai-clear').addEventListener('click',()=>{
    reset(); result.textContent='连接信息与密钥已从本页清空。'; result.hidden=false; fields.baseURL.focus();
  });
  // Page lifecycle clearing also handles back/forward cache restores.
  win.addEventListener('pagehide',reset);
  win.addEventListener('pageshow',event=>{ if (event.persisted) reset(); });
  doc.addEventListener('visibilitychange',()=>{ if (doc.hidden) hideKey(); });
}
