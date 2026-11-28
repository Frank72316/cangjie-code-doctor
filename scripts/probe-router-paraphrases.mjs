import assert from 'node:assert/strict';
import {read, directory, dump, setting} from './api-evidence-common.mjs';
import {routeNodeEvidence} from './route-node-evidence.mjs';

assert.equal(setting.generation,'api-router');
// Replace only the scope/direction preamble used by the selector.
// The original request sent to the model and the operation contract stay fixed.
const openings={
  seek:['把指着的那一格当起点。','把指针先放一边，'],
  twin:['以当前卡片为起点。','从头到尾都检查，'],
  alternating:['从游标所在格起步。','忽略光标，'],
  paint:['以给定下标所指的那格为起点。','从整个序列的端点出发，'],
  invert:['以游标所在项为起点。','整表统计，从端点出发，'],
  stamp:['以书签所在项为起点。','本题覆盖整列，']
};
const firstWord={seek:'报告第一个',twin:'寻找连续',alternating:'在第一次',paint:'只把最先',invert:'遇到第一个',stamp:'找到第一个'};
const tasks=read('transfer'), design=read('design');
const variants=design.cases.filter(c=>c.panel==='new').map(c=>{
  const task=tasks.find(t=>t.id===c.id),start=task.task.indexOf(firstWord[c.kind]);
  assert.ok(start>0);
  const right=c.id.includes('_right_'), local=c.context==='position';
  const beginning=openings[c.kind][local?0:1];
  const direction=local ? '跳过起点，由它的'+(right?'右':'左')+'边紧邻的一格开始往同一侧看。没有有效起点就视为没有可看的项。'
    : '即使没给有效位置，也从'+(right?'左端向右端':'右端向左端')+'依次看完。';
  const text=beginning+direction+task.task.slice(start);
  const {combined,sourceOnly}=routeNodeEvidence(task.source.text,text);
  assert.equal(sourceOnly,c.policy.S==='A');
  return {caseId:c.id,scope:c.context,original:task.task,alternate:text,before:c.policy.J,after:combined?'A':'L'};
});
assert.equal(variants.length,24);
if(process.argv.includes('--verify'))assert.deepEqual(variants,read('scope-paraphrases'));
else dump(directory+'/scope-paraphrases.json',variants);
console.log('Changed choices:',variants.filter(v=>v.before!==v.after).length,'of',variants.length);
