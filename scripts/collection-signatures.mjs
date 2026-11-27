import {receiverOwner} from './rank-api-receiver.mjs';

// A receiver can contribute only declarations already in the pinned SDK corpus.
// Preserve overloads and document order. Task wording never enters this selector.
export function collectionSignatures(corpus, source) {
  const owner=receiverOwner(corpus,source);
  if(!owner) return null;
  const entries=corpus.documents.filter(d=>d.title===owner);
  const declarations=entries.map(doc=>{
    const block=doc.text.match(/^\x60{3}cangjie[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\x60{3}/m);
    if(!block?.[1].trim())throw Error('Missing SDK declaration: '+doc.id);
    return block[1].trim();
  });
  const page=entries[0].url.split('#')[0];
  if(entries.some(d=>d.url.split('#')[0]!==page))throw Error('Expected one source page for receiver');
  return {sources:entries.map(d=>d.id),document:{id:'signatures-'+owner,title:owner+' 成员签名',
    url:page,text:declarations.join('\n')}};
}
