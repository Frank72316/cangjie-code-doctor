// Minimal DOM behavior checks. Browser layout is verified separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initStorageUI } from '../web/storage-ui.mjs';

const html = await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const summary = () => ({schemaVersion:1,kind:'doctor-storage-summary',scannedAt:'2026-10-30T00:00:00.000Z',
  complete:true,files:2,bytes:2048,groups:[{name:'revisions',files:2,bytes:2048}],issues:[],limits:{maxEntries:10000,maxDepth:8}});
const bundle = () => ({schemaVersion:1,kind:'doctor-evidence-bundle',exportedAt:'2026-10-30T00:00:00.000Z',
  scope:'saved-revisions-and-verifications',revisions:[],verifications:[],manifest:[],counts:{revisions:0,verifications:0},limitations:['Not a workspace backup.']});
function setup(t,health={token:'local-test-token'}) {
  const elements = new Map();
  class Element {
    constructor(tag) { this.tagName=tag; this.children=[]; this.events=new Map(); this.dataset={}; this.open=false; this.hidden=false; this.disabled=false; this._text=''; }
    set textContent(value) { this._text=String(value); this.children=[]; }
    get textContent() { return this._text + this.children.map(child=>child.textContent).join(''); }
    set innerHTML(value) { throw new Error('Untrusted HTML rendering is forbidden'); }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children=[]; this._text=''; this.append(...items); }
    addEventListener(event,listener) { this.events.set(event,listener); }
    async emit(event) { await this.events.get(event)?.({target:this}); }
  }
  for (const [,id] of html.matchAll(/\bid="(storage-[^"]+)"/g)) elements.set(id,new Element('div'));
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)}});
  t.after(()=>{ if(previous) Object.defineProperty(globalThis,'document',previous); else delete globalThis.document; });
  const calls=[],downloads=[],responses=[];
  t.mock.method(globalThis,'fetch',async (path,options)=>{
    calls.push({path,options}); const response=await responses.shift();
    if (response instanceof Error) throw response;
    assert.notEqual(response,undefined,'unexpected fetch');
    return {ok:!response.error,text:async()=>JSON.stringify(response)};
  });
  const ui=initStorageUI({getHealth:()=>health,download:(...args)=>downloads.push(args)});
  return {ui,calls,downloads,queue:(...items)=>responses.push(...items),get:id=>elements.get(id)};
}

test('collapsed storage stays lazy, first open reads once, explicit refresh reads again',async t=>{
  const env=setup(t); await env.ui.refresh(); assert.equal(env.calls.length,0);
  env.get('storage-panel').open=true; env.queue(summary()); await env.get('storage-panel').emit('toggle');
  assert.equal(env.calls.length,1); assert.match(env.get('storage-total').textContent,/2.0 KiB.*2 个文件/);
  env.get('storage-panel').open=false; await env.get('storage-panel').emit('toggle');
  env.get('storage-panel').open=true; await env.get('storage-panel').emit('toggle'); assert.equal(env.calls.length,1);
  env.queue(summary()); await env.get('storage-refresh').emit('click'); assert.equal(env.calls.length,2);
  assert.equal(env.calls[0].options.headers['X-Doctor-Token'],'local-test-token');
});

test('partial or failed scan cannot display a complete total, and issue strings stay text',async t=>{
  const env=setup(t), partial=summary(); partial.complete=false; partial.issues=['<img src=x onerror=alert(1)>'];
  env.get('storage-panel').open=true; env.queue(partial); await env.ui.refresh();
  assert.match(env.get('storage-total').textContent,/仅已扫描部分/);
  assert.match(env.get('storage-status').textContent,/不能视为总占用/);
  assert.equal(env.get('storage-issues').children[0].textContent,partial.issues[0]);
  const bad=summary(); bad.bytes=3000; env.queue(bad); await env.ui.refresh();
  assert.equal(env.get('storage-results').hidden,true);
  assert.match(env.get('storage-status').textContent,/合计与分组不一致/);
  assert.equal(env.get('storage-refresh').disabled,false);
});

test('download is authenticated, explicitly confirmed and happens only after bundle validation',async t=>{
  const env=setup(t); env.queue(bundle()); await env.get('storage-export').emit('click');
  assert.equal(env.downloads.length,1); assert.equal(env.calls[0].path,'/api/evidence-export');
  assert.deepEqual(JSON.parse(env.calls[0].options.body),{confirmed:true});
  assert.equal(env.calls[0].options.method,'POST');
  assert.equal(env.calls[0].options.headers['X-Doctor-Token'],'local-test-token');
  assert.deepEqual(JSON.parse(env.downloads[0][1]),bundle());
  assert.match(env.get('storage-status').textContent,/导出不改变原记录或验证结论/);
  const tampered=bundle(); tampered.manifest.push({type:'revision',id:'a'.repeat(32),sha256:'b'.repeat(64)});
  env.queue(tampered); await env.get('storage-export').emit('click');
  assert.equal(env.downloads.length,1); assert.match(env.get('storage-status').textContent,/没有下载材料/);
  env.queue({error:'记录损坏，停止导出'}); await env.get('storage-export').emit('click');
  assert.equal(env.downloads.length,1); assert.match(env.get('storage-status').textContent,/记录损坏/);
});

test('missing connection never initiates a request or a download',async t=>{
  const disconnected=setup(t,{}); await disconnected.get('storage-export').emit('click');
  assert.equal(disconnected.calls.length,0); assert.equal(disconnected.downloads.length,0);
  assert.match(disconnected.get('storage-status').textContent,/尚未连接本机服务/);
});

test('export filename uses Beijing date across UTC midnight without changing evidence timestamp',async t=>{
  const env=setup(t), data=bundle(); data.exportedAt='2026-10-29T16:00:01.000Z';
  env.queue(data); await env.get('storage-export').emit('click');
  assert.equal(env.downloads[0][0],'doctor-evidence-2026-10-30.json');
  assert.equal(JSON.parse(env.downloads[0][1]).exportedAt,'2026-10-29T16:00:01.000Z');
});

test('export in flight disables both actions and ignores duplicate requests',async t=>{
  const env=setup(t); let finish;
  env.queue(new Promise(resolve=>{finish=resolve;}));
  const pending=env.get('storage-export').emit('click');
  assert.equal(env.get('storage-export').disabled,true); assert.equal(env.get('storage-refresh').disabled,true);
  await env.get('storage-export').emit('click'); assert.equal(env.calls.length,1);
  finish(bundle()); await pending;
  assert.equal(env.downloads.length,1); assert.equal(env.get('storage-export').disabled,false);
});
