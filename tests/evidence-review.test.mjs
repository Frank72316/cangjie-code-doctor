// Synthetic review cases, not execution or A/B results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sha256 } from '../web/report.mjs';
import { readEvidenceReview, reviewOutcome, reviewHTML, MAX_REVIEW_BYTES } from '../web/evidence-review.mjs';
import { initEvidenceReviewUI } from '../web/evidence-review-ui.mjs';

const base = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
const html = await readFile(new URL('../web/index.html',import.meta.url),'utf8');
async function fixture() {
  const source={name:'review.cj',text:base.source.text.replace('"three"','3')+'// <script>alert(1)</script>\n'};
  const revision={schemaVersion:1,kind:'doctor-manual-revision',revisionId:'b'.repeat(32),createdAt:'2026-11-16T00:00:00.000Z',
    baseRecord:structuredClone(base),recordSha256:await sha256(JSON.stringify(base)),source:{...source,sha256:await sha256(source.text)},
    origin:'manual',compileStatus:'not_run',testStatus:'not_run',execution:{attempted:false}};
  const verification={schemaVersion:1,kind:'doctor-revision-verification',verificationId:'c'.repeat(32),
    createdAt:'2026-11-16T00:00:01.000Z',finishedAt:null,state:'unknown',revision,
    tests:[{id:'public_1',stdin:'',expectedStdout:'3\n'}],report:null,detail:'Synthetic unfinished record; no execution.'};
  return {revision,verification};
}
async function bundle(revisions,verifications) {
  const manifest=[];
  for(const [type,records] of [['revision',revisions],['verification',verifications]])
    for(const r of records) manifest.push({type,id:r.revisionId || r.verificationId,sha256:await sha256(JSON.stringify(r))});
  return {schemaVersion:1,kind:'doctor-evidence-bundle',exportedAt:'2026-11-16T01:00:00.000Z',scope:'saved-revisions-and-verifications',
    revisions,verifications,manifest,counts:{revisions:revisions.length,verifications:verifications.length},limitations:['Synthetic test only.']};
}
test('standalone revisions and unfinished verifications keep evidence and states unchanged',async()=>{
  const seed=await fixture();
  for(const item of [seed.revision,seed.verification]){
    const text=JSON.stringify(item), result=await readEvidenceReview(text);
    assert.equal(result.entries.length,1);assert.equal(result.fileSha256,await sha256(text));
    assert.deepEqual(result.entries[0].revision,seed.revision);
    assert.equal(result.entries[0].revision.testStatus,'not_run');
    assert.equal(JSON.stringify(item),text);
  }
  assert.match(reviewOutcome((await readEvidenceReview(JSON.stringify(seed.revision))).entries[0]).label,/未附验证/);
  for(const state of ['running','unknown']){
    seed.verification.state=state;
    assert.equal(reviewOutcome((await readEvidenceReview(JSON.stringify(seed.verification))).entries[0]).label,'状态待确认');
  }
});
test('multiple verification attempts stay separate, unverified revisions stay visible, empty is valid',async()=>{
  const {revision,verification}=await fixture(),other=structuredClone(revision),attempt=structuredClone(verification);
  other.revisionId='d'.repeat(32);attempt.verificationId='e'.repeat(32);attempt.state='failed';attempt.finishedAt='2026-11-16T00:00:02.000Z';
  const result=await readEvidenceReview(JSON.stringify(await bundle([revision,other],[verification,attempt])));
  assert.equal(result.entries.length,3);assert.equal(result.entries.filter(x=>!x.verification).length,1);
  assert.equal(result.entries.filter(x=>x.verification).length,2);
  assert.equal(reviewOutcome(result.entries.find(x=>x.verification?.state==='failed')).label,'验证未完成');
  assert.equal((await readEvidenceReview(JSON.stringify(await bundle([],[])))).entries.length,0);
});
test('wrong kind, invalid JSON, oversized data and changed evidence fail closed',async()=>{
  const {verification}=await fixture();verification.revision.source.text+='tampered';
  for(const text of ['{',JSON.stringify(base),JSON.stringify(verification),'x'.repeat(MAX_REVIEW_BYTES+1)])
    await assert.rejects(readEvidenceReview(text));
});
test('same-ID embedded revisions cannot disagree even when no standalone revision is present',async()=>{
  const {verification}=await fixture(),other=structuredClone(verification);other.verificationId='d'.repeat(32);
  other.revision.createdAt='2026-11-16T00:00:00.001Z';
  await assert.rejects(readEvidenceReview(JSON.stringify(await bundle([],[verification,other]))),/同编号/);
});
test('readable report keeps history scope, original diagnosis and escapes candidate markup',async()=>{
  const {revision,verification}=await fixture();
  for(const data of [revision,verification]){
    const entry=(await readEvidenceReview(JSON.stringify(data))).entries[0],output=reviewHTML(entry);
    assert.match(output,/已有报告回看/);assert.match(output,/本次没有执行程序/);assert.match(output,/修改前的诊断/);
    assert.ok(!output.includes('<script>alert'));assert.match(output,/&lt;script&gt;/);
    assert.match(output,/Content-Security-Policy/);
  }
});

function setup(t) {
  const elements=new Map(),downloads=[];
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.events=new Map();this.dataset={};this.value='';this.hidden=false;this.disabled=false;this._text='';}
    set textContent(value){this._text=String(value);this.children=[];}
    get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
    set innerHTML(value){throw Error('unsafe HTML');}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[];this._text='';this.append(...children);}
    addEventListener(type,handler){this.events.set(type,handler);}
    async emit(type){await this.events.get(type)?.({target:this});}
  }
  for(const [,id] of html.matchAll(/\bid="(evidence-review-[^"]+)"/g))elements.set(id,new Element('div'));
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document;});
  t.mock.method(globalThis,'fetch',()=>{throw Error('Review must not make network requests');});
  const ui=initEvidenceReviewUI({download:(...args)=>downloads.push(args)});
  return {ui,downloads,get:id=>elements.get('evidence-review-'+id)};
}
const encoded = data => new TextEncoder().encode(JSON.stringify(data)).buffer;
const file = data => {const bytes=encoded(data);return {size:bytes.byteLength,arrayBuffer:async()=>bytes};};
test('offline UI shows unknown, exports only valid selection, and discards old success on invalid input',async t=>{
  const env=setup(t),{verification}=await fixture();
  await env.ui.openFile(file(verification));
  assert.match(env.get('result').textContent,/状态待确认/);assert.match(env.get('result').textContent,/第 2 行/);
  assert.match(env.get('result').textContent,/未附带文档/);assert.equal(env.get('download').disabled,false);
  await env.get('download').emit('click');assert.equal(env.downloads.length,1);
  await env.ui.openFile({size:2,arrayBuffer:async()=>new TextEncoder().encode('{!').buffer});
  assert.equal(env.get('result').hidden,true);assert.equal(env.get('download').disabled,true);
  await env.get('download').emit('click');assert.equal(env.downloads.length,1);
  assert.match(env.get('status').textContent,/打开失败/);
});
test('late file completion cannot replace newer selection or undo clearing',async t=>{
  const env=setup(t),{revision,verification}=await fixture();let finish;
  const pending=env.ui.openFile({size:encoded(revision).byteLength,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})});
  await env.ui.openFile(file(verification));finish(encoded(revision));await pending;
  assert.match(env.get('result').textContent,/状态待确认/);
  const clearing=env.ui.openFile({size:encoded(verification).byteLength,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})});
  await env.get('clear').emit('click');finish(encoded(verification));await clearing;
  assert.equal(env.get('result').hidden,true);assert.equal(env.get('download').disabled,true);
  assert.match(env.get('status').textContent,/已清空/);
});
test('UI rejects oversized file before reading and switches between all imported attempts',async t=>{
  const env=setup(t);await env.ui.openFile({size:MAX_REVIEW_BYTES+1,arrayBuffer:()=>{throw Error('must not read');}});
  assert.match(env.get('status').textContent,/32 MiB/);
  await env.ui.openFile({size:2,arrayBuffer:async()=>new Uint8Array([0xc0,0xff]).buffer});
  assert.match(env.get('status').textContent,/UTF-8/);
  await env.ui.openFile({size:3,arrayBuffer:async()=>new Uint8Array([0x7b,0x7d]).buffer});
  assert.match(env.get('status').textContent,/大小发生变化/);
  const {revision,verification}=await fixture(),other=structuredClone(revision);other.revisionId='d'.repeat(32);
  await env.ui.openFile(file(await bundle([other],[verification])));
  assert.equal(env.get('picker').hidden,false);assert.equal(env.get('select').children.length,2);
  env.get('select').value='1';await env.get('select').emit('change');
  assert.match(env.get('result').textContent,/仅保存修改/);
});
