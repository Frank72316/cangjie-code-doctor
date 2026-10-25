// Deterministic UI-state checks with a minimal DOM. These do not claim browser
// layout, Docker recovery, compilation, or candidate-execution acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initVerificationUI } from '../web/verification-ui.mjs';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const baseRecord = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
function unknownRecord() {
  const source = {name:'unknown-ui.cj', text:baseRecord.source.text.replace('"three"','3')};
  return {schemaVersion:1, kind:'doctor-revision-verification', verificationId:'a'.repeat(32),
    createdAt:'2026-10-24T00:00:01.000Z', finishedAt:null, state:'unknown',
    revision:{schemaVersion:1, kind:'doctor-manual-revision', revisionId:'b'.repeat(32), createdAt:'2026-10-24T00:00:00.000Z',
      baseRecord:structuredClone(baseRecord), recordSha256:hash(JSON.stringify(baseRecord)), source:{...source,sha256:hash(source.text)},
      origin:'manual', compileStatus:'not_run', testStatus:'not_run', execution:{attempted:false}},
    tests:[{id:'public_1',stdin:'',expectedStdout:'3\n'}], report:null,
    detail:'Only the request remains; no complete result is available.'};
}
function setup(t, health = {token:'ui-test-token', busy:false, verification:{available:false, detail:'测试环境未配置。'}}) {
  const elements = new Map();
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.dataset = {}; this.events = new Map(); this.className = ''; this._text = '';
      this.value = ''; this.checked = false; this.disabled = false; this.open = false;
    }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    prepend(...children) { for (const child of children) child.parentElement = this; this.children.unshift(...children); }
    replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
    addEventListener(event, listener) { const list = this.events.get(event) || []; list.push(listener); this.events.set(event, list); }
    async emit(event) { for (const listener of this.events.get(event) || []) await listener({target:this, preventDefault() {}}); }
    closest(selector) {
      for (let item = this; item; item = item.parentElement) if (item.className.split(' ').includes(selector.slice(1))) return item;
      return null;
    }
    querySelectorAll(selector) {
      assert.equal(selector, '[data-verification][open]');
      const visit = item => [...item.children.filter(child => child.dataset.verification && child.open), ...item.children.flatMap(visit)];
      return visit(this);
    }
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) { const item = new Element('div'); item.id = id; }
  const disclosure = new Element('details'); disclosure.className = 'verification-history-disclosure';
  disclosure.append(elements.get('verification-history'), elements.get('verification-refresh'));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:id => elements.get(id), createElement:tag => new Element(tag)}});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  let responses = [], healthRefreshes = 0;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({path, options});
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, `unexpected request: ${path}`);
    return {ok:true, json:async () => structuredClone(response)};
  });
  const ui = initVerificationUI({getHealth:() => health, refreshHealth:async () => { healthRefreshes++; }, download() {}});
  return {ui, health, calls, disclosure, get:id => elements.get(id), queue:(...items) => { responses.push(...items); }, healthRefreshes:() => healthRefreshes};
}

test('generic busy and recovery facts never claim that the old verification passed', t => {
  const env = setup(t, {token:'test', busy:true, verification:{available:true,
    recovery:{recoveredContainers:2,detail:'本次恢复检查已结束。'}}});
  const message = env.get('verification-environment').textContent;
  assert.match(message,/本机正在处理其他任务/);
  assert.doesNotMatch(message,/正在处理一个验证任务/);
  assert.match(message,/已清理 2 个已登记的残留容器/);
  assert.match(message,/旧任务结果仍待确认，清理不代表验证通过/);
  assert.equal(env.get('verification-result').children.length,0);
  env.health.verification.recovery.recoveredContainers = -1;
  env.ui.refreshControls();
  assert.doesNotMatch(env.get('verification-environment').textContent,/已清理 -1/);
});

test('manual history failure reveals the existing retry and successful retry preserves the exact test draft', async t => {
  const env = setup(t);
  const stdin = env.get('verification-input-1'), expected = env.get('verification-output-1');
  stdin.value = '待保留的输入\n'; expected.value = '空格与换行  \n';
  const checkbox = expected.parentElement.children.find(child => child.className === 'verification-newline').children[0];
  checkbox.checked = true;
  env.get('verification-revision').value = 'draft-target';
  env.queue(new Error('模拟读取失败'));
  await env.ui.refresh({userInitiated:true});
  assert.equal(env.disclosure.open,true);
  assert.equal(env.get('verification-refresh').disabled,false);
  assert.match(env.get('verification-status').textContent,/刷新验证状态.*草稿保持不变/);
  assert.equal(env.get('verification-history-count').textContent,'未能读取');
  env.queue({verifications:[],unreadable:0,busy:false});
  await env.get('verification-refresh').emit('click');
  assert.equal(env.healthRefreshes(),1);
  assert.equal(env.get('verification-input-1'),stdin);
  assert.equal(env.get('verification-output-1'),expected);
  assert.equal(stdin.value,'待保留的输入\n'); assert.equal(expected.value,'空格与换行  \n');
  assert.equal(checkbox.checked,true); assert.equal(env.get('verification-revision').value,'draft-target');
  assert.equal(env.get('verification-history-count').textContent,'0 份');
  assert.match(env.get('verification-status').textContent,/验证记录已刷新/);
  assert.ok(env.calls.every(call => !call.options.method), 'history retry must not resubmit verification');
});

test('initial background history failure does not force open a disclosure', async t => {
  const env = setup(t); env.queue(new Error('后台读取失败'));
  await env.ui.refresh();
  assert.equal(env.disclosure.open,false);
  assert.equal(env.get('verification-history-count').textContent,'未能读取');
  assert.match(env.get('verification-history').textContent,/刷新验证状态.*草稿保持不变/);
});

test('recovered resources leave unknown history unknown without asserting tests never ran or rerunning them', async t => {
  const env = setup(t, {token:'test', busy:false, verification:{available:true,
    recovery:{recoveredContainers:1,detail:'已核对并清理本工作区登记的资源。'}}});
  const record = unknownRecord(), original = structuredClone(record);
  env.queue({verifications:[{verificationId:record.verificationId, revisionId:record.revision.revisionId,
    sourceName:record.revision.source.name, createdAt:record.createdAt, state:'unknown', active:false, status:'not_run'}], unreadable:0, busy:false});
  await env.ui.refresh();
  assert.match(env.get('verification-history-count').textContent,/1 份待确认/);
  assert.match(env.get('verification-history').textContent,/不能补出原来的编译与测试结论/);
  const entry = env.get('verification-history').children.find(child => child.dataset.verification);
  entry.open = true; env.queue(record); await entry.emit('toggle');
  assert.match(entry.textContent,/状态待确认/);
  assert.match(entry.textContent,/公开测试 1 · 未取得结果/);
  assert.match(entry.textContent,/不会自动重跑/);
  assert.match(entry.textContent,/原诊断文档依据 · 未附带/);
  assert.deepEqual(record,original);
  assert.ok(env.calls.every(call => !call.options.method), 'viewing unknown history must not run anything');
});

function attachDocumentFixture(record, results=[]) {
  const evidence = {schemaVersion:1,sdkVersion:'1.0.5',snapshotId:'synthetic-ui-snapshot',sourceRevision:'synthetic-ui-revision',
    algorithm:'bm25',parameters:{k1:1.2,b:0.75},query:'Int64',effectiveQuery:'Int64',queryExpansion:'compiler-glossary-v1',
    tokenizer:'ascii-lower-identifier+cjk-unigram-bigram-v1',topK:3,results,kind:'doctor-document-evidence',retrievalId:'e'.repeat(32),
    createdAt:'2026-10-23T23:59:59.000Z',sourceName:baseRecord.source.name,sourceSha256:baseRecord.source.sha256,
    recordSha256:record.revision.recordSha256,compilerVersion:baseRecord.compiler.version,corpusSha256:'f'.repeat(64),queryOrigin:'manual'};
  Object.assign(record.revision,{schemaVersion:2,documentEvidence:evidence,documentEvidenceSha256:hash(JSON.stringify(evidence))});
  return record;
}
const descendants = item => item.children.flatMap(child => [child,...descendants(child)]);
async function openHistory(env, record) {
  env.queue({verifications:[{verificationId:record.verificationId,revisionId:record.revision.revisionId,
    sourceName:record.revision.source.name,createdAt:record.createdAt,state:record.state,active:false,status:'not_run'}],unreadable:0,busy:false});
  await env.ui.refresh();
  const entry = env.get('verification-history').children.find(child => child.dataset.verification);
  entry.open = true; env.queue(record); await entry.emit('toggle');
  return entry;
}

test('selected saved source and history show the same original references without executing a test',async t => {
  const env = setup(t), payload = '</pre><script>alert(1)</script><img src=x onerror=alert(1)>';
  const record = attachDocumentFixture(unknownRecord(),[{id:'synthetic-ui',title:payload,section:'Reference only',
    text:payload,url:'https://docs.cangjie-lang.cn/docs/1.0.5/',score:1}]), before = structuredClone(record);
  env.get('verification-revision').value = record.revision.revisionId;
  env.queue(record.revision); await env.get('verification-revision').emit('change');
  const selected = env.get('verification-source');
  assert.equal(selected.hidden,false);
  assert.match(selected.textContent,/原诊断文档依据 · 1 条摘录/);
  assert.ok(selected.textContent.includes(record.revision.documentEvidenceSha256));
  const entry = await openHistory(env,record);
  assert.match(entry.textContent,/状态待确认/);
  assert.match(entry.textContent,/不是对修改后代码的验证/);
  assert.match(entry.textContent,/SDK 1.0.5 · 文档快照：synthetic-ui-snapshot/);
  for (const container of [selected,entry]) {
    const nodes = descendants(container);
    assert.ok(nodes.some(item => item.tagName === 'PRE' && item.textContent === payload));
    assert.ok(nodes.some(item => item.tagName === 'A' && item.href === record.revision.documentEvidence.results[0].url && item.rel === 'noopener noreferrer'));
    assert.ok(nodes.every(item => !['SCRIPT','IMG','IFRAME','OBJECT'].includes(item.tagName)));
  }
  assert.deepEqual(record,before);
  assert.equal(record.revision.compileStatus,'not_run'); assert.equal(record.revision.testStatus,'not_run');
  assert.ok(env.calls.every(call => !call.options.method));
});

test('zero-match history has a specific boundary and invalid source links prevent evidence rendering',async t => {
  const env = setup(t), record = attachDocumentFixture(unknownRecord());
  let entry = await openHistory(env,record);
  assert.match(entry.textContent,/本次检索没有命中。没有匹配不说明代码正确/);
  assert.match(entry.textContent,/原诊断文档依据 · 0 条摘录/);
  record.revision.documentEvidence.results = [{id:'bad-url',title:'Synthetic',section:'Synthetic',text:'Untrusted',score:1,url:'javascript:alert(1)'}];
  record.revision.documentEvidenceSha256 = hash(JSON.stringify(record.revision.documentEvidence));
  entry = await openHistory(env,record);
  assert.match(entry.textContent,/无效的官方文档链接/);
  assert.ok(descendants(entry).every(item => item.tagName !== 'A'));
  assert.doesNotMatch(entry.textContent,/原诊断文档依据 · 1 条摘录/);
});
