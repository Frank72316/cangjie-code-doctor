// Independent of cases: fixed complete chapters, deterministic contiguous chunks.
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './pilot-common.mjs';
const upstream=resolve(process.argv[2]||'tmp/upstream-docs-1.0.5'),revision='f8f8cd75a336e23785a4c57bd6091b2adf1e0302',repository='https://github.com/cangjielanguage/cangjie_docs';
if(execFileSync('git',['-C',upstream,'rev-parse','v1.0.5^{commit}'],{encoding:'utf8'}).trim()!==revision)throw Error('Official tag mismatch');
const chapters=[
 'basic_data_type/array.md','basic_data_type/strings.md','basic_data_type/characters.md','basic_data_type/range.md','basic_data_type/tuple.md',
 'collections/collection_arraylist.md','collections/collection_hashmap.md','collections/collection_hashset.md','collections/collection_overview.md',
 'enum_and_pattern_match/option_type.md','enum_and_pattern_match/match.md','error_handle/use_option.md','error_handle/handle.md',
 'function/define_functions.md','function/call_functions.md','function/lambda.md',
 'class_and_interface/class.md','class_and_interface/interface.md','class_and_interface/typecast.md'
];
const sources=[],excerpts=[],documents=[];
for(const chapter of chapters){
 const path='docs/dev-guide/source_zh_cn/'+chapter,raw=execFileSync('git',['-C',upstream,'show',`${revision}:${path}`],{encoding:'utf8',maxBuffer:1024*1024}),lines=raw.replace(/\r\n/g,'\n').split('\n'),title=lines.find(l=>/^# /.test(l))?.slice(2)||chapter;
 sources.push({path,sha256:sha(raw),url:`${repository}/blob/${revision}/${path}`});
 let start=0,section=title;
 while(start<lines.length){
  let end=start,length=0;while(end<lines.length&&length+lines[end].length+1<=1600){length+=lines[end].length+1;end++;}
  if(end===start)throw Error('Overlong source line');
  // Prefer paragraph/heading boundaries, keeping source bytes otherwise verbatim.
  if(end<lines.length){for(let i=end-1;i>start+3;i--)if(lines[i]===''||/^#{1,4} /.test(lines[i])){end=i;break;}}
  const text=lines.slice(start,end).join('\n').trim();
  const heading=lines.slice(start,end).find(l=>/^#{1,4} /.test(l));if(heading)section=heading.replace(/^#+ /,'');
  if(text){const id='ch-'+chapter.split('/').at(-1).replace('.md','')+'-'+(start+1),url=`${repository}/blob/${revision}/${path}#L${start+1}-L${end}`;
   documents.push({id,title,section,url,text});excerpts.push({id,sourcePath:path,startLine:start+1,endLine:end,sha256:sha(text)});}
  start=end;
 }
}
const corpus={schemaVersion:1,sdkVersion:'1.0.5',snapshotId:'cangjie-1.0.5-f8f8cd75a336-challenge-01',sourceRevision:revision,documents};
const raw=JSON.stringify(corpus,null,2)+'\n';if(Buffer.byteLength(raw)>262144||documents.length>256)throw Error('Corpus exceeds existing bounded native interface');
await writeFile('data/experiments/challenge-v1/corpus.json',raw);
await writeFile('data/experiments/challenge-v1/corpus-manifest.json',JSON.stringify({schemaVersion:1,sdkVersion:'1.0.5',sourceRevision:revision,repository,selection:'19 fixed complete general-purpose language chapters; no case/test input to builder; contiguous <=1600-character verbatim chunks',corpusSha256:sha(raw),bytes:Buffer.byteLength(raw),license:{spdx:'CC-BY-4.0',local:'../../docs/LICENSE-CC-BY-4.0.txt',copyright:'Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.'},sources,excerpts},null,2)+'\n');
console.log(JSON.stringify({chapters:chapters.length,documents:documents.length,bytes:Buffer.byteLength(raw),sha256:sha(raw)}));
