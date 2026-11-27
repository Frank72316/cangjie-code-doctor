import {rankWithReceiver} from './rank-api-receiver.mjs';

const front = /队首|队头|头部|前端|最前|第一个|最早|最小|栈顶|最上面/;
const back = /队尾|尾部|后端|最后|最晚|最大/;
const up = /升序|递增|从小到大|往大|往高/;
const down = /降序|递减|从大到小|往小|往低/;

// A document name supplies operation semantics; the SDK description resolves
// unnamed ends (for example Queue.peek). Do not read examples or gold labels.
function documentFacets(doc) {
  const name = doc.section.match(/^(?:func|prop) (\w+)/)?.[1] ?? '';
  const description = (doc.text.split('功能：')[1] ?? '').split('\n')[0];
  if (name === 'forward' || name === 'backward') {
    return {operation:'walk', end:name === 'forward' ? 'up' : 'down'};
  }
  let operation;
  if (/^(remove|clear|pop)/i.test(name)) operation='remove';
  else if (/^(add|push|insert)/i.test(name)) operation='insert';
  else if (/^(first|last|peek|get|contains|toArray|iterator)/i.test(name)) operation='read';
  const end=/first|front/i.test(name) ? 'front' : /last|back/i.test(name) ? 'back' :
    front.test(description) && !back.test(description) ? 'front' :
    back.test(description) && !front.test(description) ? 'back' : null;
  return {operation,end};
}

export function queryFacets(task) {
  const plain=task.split('保留函数签名')[0];
  // Negative mutation clauses describe a preservation constraint.
  const positive=plain.replace(/(?:不能|不得|不要|不可|不应|不会|不)(?:再|被)?(?:删除|删去|移除|取走|弹出|消耗|插入|添加)/g, '只读');
  const remove=/删除|删去|移除|取走|弹出|出栈|出队|取掉/.test(positive);
  const insert=/插入|添加|放入|加入|追加|推入|入栈|入队/.test(positive);
  const walk=/遍历|逐个|枚举/.test(positive) && (up.test(positive) || down.test(positive));
  if ([remove,insert,walk].filter(Boolean).length>1) return {};
  const read=/查看|读取|查阅|只读|保持原样|保持.{0,8}不变|不改变|不修改/.test(positive);
  const operation=remove?'remove':insert?'insert':walk?'walk':read?'read':null;
  const ends=walk?[up.test(positive)&&'up',down.test(positive)&&'down'] :
    [front.test(positive)&&'front',back.test(positive)&&'back'];
  const marked=ends.filter(Boolean);
  return {operation,end:marked.length===1?marked[0]:null};
}

export function rankWithOperation(corpus,task,source) {
  const baseline=rankWithReceiver(corpus,task,source);
  const facets=queryFacets(task);
  if (!baseline.owner || !facets.operation) return {...baseline,facets};
  const own=new Map(corpus.documents.filter(d=>d.title===baseline.owner).map(d=>[d.id,documentFacets(d)]));
  const tier=row=>{
    const found=own.get(row.id);
    if(!found)return -10;
    const effect=found.operation===facets.operation?4:found.operation?-2:0;
    return effect + (facets.end && found.end ? found.end===facets.end?2:-1 : 0);
  };
  // Stable sort retains the prior ranking within each evidence tier.
  return {...baseline,facets,ranks:[...baseline.ranks].sort((a,b)=>tier(b)-tier(a))};
}
