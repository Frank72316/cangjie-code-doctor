import assert from 'node:assert/strict';
import {read,directory,dump,familyStudy} from './api-evidence-common.mjs';
import {rankWithReceiver} from './rank-api-receiver.mjs';

// Post-hoc diagnostic: the two requests share the same receiver and source.
// The explicit English name is an oracle positive control used only in this probe.
const pairs=[
 ['ArrayDeque','查看哪一端',[['队列中查看最早到达的那项，保持队列不变。',28,'first'],['队列中查看最后到达的那项，保持队列不变。',38,'last']]],
 ['ArrayDeque','移走哪一端',[['从队列头部取走一项，并返回这项。',138,'removeFirst'],['从队列尾部取走一项，并返回这项。',150,'removeLast']]],
 ['ArrayStack','查看或弹出',[['查看最上面一项，保留这项记录。',1189,'peek'],['取走最上面一项，返回这项记录。',1201,'remove']]],
 ['TreeMap','向上或向下遍历',[['按键从门槛起往大的方向逐个读取。',2989,'forward'],['按键从门槛起往小的方向逐个读取。',2904,'backward']]],
 ['TreeMap','取掉哪一端',[['取走键最小的一项并返回键值对。',3058,'removeFirst'],['取走键最大的一项并返回键值对。',3070,'removeLast']]],
 ['TreeSet','向上或向下遍历',[['从给定分数往高分逐个枚举成员。',3451,'forward'],['从给定分数往低分逐个枚举成员。',3382,'backward']]],
 ['TreeSet','取掉哪一端',[['取走最小的成员并返回。',3492,'removeFirst'],['取走最大的成员并返回。',3504,'removeLast']]],
];
assert.ok(familyStudy);
const corpus=read('corpus'),rows=[];
for(const [type,contrast,items] of pairs){
 const source='func pick(q: '+type+(type==='TreeMap'?'<Int64, Int64>':'<Int64>')+'): Int64 { q.size }';
 const descriptions=items.map(([query,n,method])=>{
   const gold='collections-'+n, doc=corpus.documents.find(d=>d.id===gold);
   assert.equal(doc.title,type);assert.ok(doc.section.includes(method));
   const rank=q=>{const result=rankWithReceiver(corpus,q,source);assert.equal(result.owner,type);return result.ranks.map(d=>d.id);};
   const natural=rank(query), named=rank(query+' 方法名称 '+method+'。');
   return {query,method,gold,natural:natural.slice(0,3),named:named.slice(0,3),
     naturalPosition:natural.indexOf(gold)+1,namedPosition:named.indexOf(gold)+1};
 });
 rows.push({type,contrast,source,descriptions});
}
const all=rows.flatMap(r=>r.descriptions);
const result={purpose:'exploratory contrast pairs, not repair outcomes',rows,
 naturalHit1:all.filter(d=>d.naturalPosition===1).length,namedHit1:all.filter(d=>d.namedPosition===1).length,
 naturalBoth:rows.filter(r=>r.descriptions.every(d=>d.naturalPosition===1)).length,
 sameNaturalFirst:rows.filter(r=>r.descriptions[0].natural[0]===r.descriptions[1].natural[0]).length,
 namedBoth:rows.filter(r=>r.descriptions.every(d=>d.namedPosition===1)).length};
if(process.argv.includes('--write'))dump(directory+'/intent-probe.json',result);
if(process.argv.includes('--verify'))assert.deepEqual(result,read('intent-probe'));
console.log(JSON.stringify(result,null,2));
