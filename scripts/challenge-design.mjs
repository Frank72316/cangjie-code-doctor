import {readFile} from 'node:fs/promises';
import {sha,SYSTEM} from './pilot-common.mjs';
import {officialUrl} from './retrieval.mjs';
export const CHALLENGE_SETTINGS={model:'deepseek-flash',thinking:{type:'disabled'},temperature:0,top_p:1,max_tokens:4096,response_format:{type:'json_object'},stream:false};
const orders=[['A','B','C'],['B','C','A'],['C','A','B'],['A','C','B'],['C','B','A'],['B','A','C']];
export function challengeSchedule(cases,split='evaluation',repeats=3){
 const strata=['language-api','algorithm','stateful'],selected=strata.map(s=>cases.filter(c=>c.split===split&&c.stratum===s).sort((a,b)=>a.id.localeCompare(b.id,'en'))),interleaved=[];
 for(let i=0;i<selected[0].length;i++)for(const list of selected)if(list[i])interleaved.push(list[i]);
 return Array.from({length:repeats},(_,repeat)=>interleaved.flatMap((c,i)=>{
  const block=i%6<3?0:3,order=orders[block+((i%3+repeat)%3)];
  return order.map(group=>({caseId:c.id,repeat:repeat+1,group,maxRounds:2}));
 })).flat();
}
export function challengeQuery(c,feedback){
 const stop=new Set('func public private var let return if else while for in import std main Int64 Float64 String Bool Unit Array ArrayList HashMap println true false this new class override static'.toLowerCase().split(' '));
 const identifiers=[...new Set((c.source.text.match(/[A-Za-z_][A-Za-z0-9_]*/g)||[]).filter(w=>!stop.has(w.toLowerCase())))].slice(0,100);
 const diagnostics=(feedback?.diagnostics||[]).map(d=>`${d.code??''} ${d.message??''} ${d.hint??''}`).join('\n');
 return (diagnostics+'\n'+identifiers.join(' ')+'\n'+c.task).trim().slice(0,2000);
}
export async function challengeCorpus(root=process.cwd()){
 const folder=root+'/data/experiments/challenge-v1/',raw=await readFile(folder+'corpus.json','utf8'),manifest=JSON.parse(await readFile(folder+'corpus-manifest.json','utf8')),corpus=JSON.parse(raw);
 if(sha(raw)!==manifest.corpusSha256||Buffer.byteLength(raw)>262144||corpus.sdkVersion!=='1.0.5'||corpus.sourceRevision!==manifest.sourceRevision)throw Error('Challenge corpus identity mismatch');
 if(corpus.documents.length!==manifest.excerpts.length||new Set(corpus.documents.map(d=>d.id)).size!==corpus.documents.length)throw Error('Corpus document identity mismatch');
 for(const d of corpus.documents){const entry=manifest.excerpts.find(e=>e.id===d.id);if(!entry||sha(d.text)!==entry.sha256||d.text.length>1600||!officialUrl(d.url))throw Error('Excerpt integrity mismatch');}
 return {corpus,manifest,sha256:sha(raw)};
}
export function fixedDocuments(corpus){
 // Fixed before model calibration; the same three contiguous source chunks for every case.
 return ['ch-collection_arraylist-1','ch-option_type-1','ch-call_functions-1'].map(id=>{const d=corpus.documents.find(d=>d.id===id);if(!d)throw Error('Fixed-sheet excerpt missing');return d;});
}
export function challengeMessages(c,feedback,group,retrieval,corpus){
 if(!['A','B','C'].includes(group))throw Error('Unknown condition');
 const docs=group==='A'?[]:group==='B'?retrieval.results:fixedDocuments(corpus);
 // No fault location, benchmark answer, topic labels, private tests or cross-arm messages.
 return [{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify({sdkVersion:'1.0.5',task:c.task,source:c.source,publicTests:c.publicTests,initial:feedback,documents:docs.map(({id,title,url,text})=>({id,title,url,text}))})}];
}
