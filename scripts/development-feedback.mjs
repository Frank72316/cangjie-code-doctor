import {sha} from './pilot-common.mjs';

// Only the previous answer and the same condition's public check enter round two.
export function followupRequest(request, previous, checked) {
  if (previous.caseId !== checked.caseId || previous.group !== checked.group ||
      previous.codeSha256 !== checked.codeSha256 || previous.requestSha256 !== sha(request)) {
    throw Error('Public feedback belongs to another condition');
  }
  if (checked.status === 'passed') return null;
  const feedback = checked.public ?? {status:'invalid', detail:'上一轮输出未通过完整单字段 JSON 源码格式检查。'};
  return {...request, messages:[...request.messages,
    {role:'assistant',content:previous.answer},
    {role:'user',content:JSON.stringify({publicFeedback:feedback, instruction:'请结合上一轮公开反馈，按原题和原输出格式再修复一次。'})}
  ]};
}
