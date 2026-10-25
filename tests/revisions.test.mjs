import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { RevisionStore } from '../scripts/revision-store.mjs';
import { makeServer } from '../scripts/preview.mjs';
import { lineDiff, validateRevision, validateRevisionInput, MAX_REVISION_BYTES } from '../web/revision.mjs';

const original = JSON.parse(await readFile(new URL('fixtures/type_mismatch.json',import.meta.url),'utf8'));
function input() {
  return {baseRecord:structuredClone(original),source:{name:original.source.name,
    text:original.source.text.replace('"three"','3')},confirmed:true};
}
async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(),'doctor-revision-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  return root;
}
async function service(t, revisionStore) {
  // An unavailable compiler must not disable the offline revision archive.
  const bridge = {health:{available:false},token:'revision-token',busy:false};
  const server = makeServer({bridge,revisionStore});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'Content-Type':'application/json','X-Doctor-Token':bridge.token};
  return {base,headers,post:(data,extra={}) => fetch(base+'/api/revisions',
    {method:'POST',headers:{...headers,...extra},body:JSON.stringify(data)})};
}

test('line differences preserve repeated lines and reconstruct both originals', () => {
  const before = 'a\nb\na\nc\n', after = 'a\na\nb\nc\n';
  const rows = lineDiff(before,after);
  assert.equal(rows.filter(row => row.kind !== 'add').map(row => row.text).join('\n'),before);
  assert.equal(rows.filter(row => row.kind !== 'remove').map(row => row.text).join('\n'),after);
  assert.deepEqual(rows.filter(row => row.kind !== 'add').map(row => row.beforeLine),[1,2,3,4,5]);
  assert.deepEqual(rows.filter(row => row.kind !== 'remove').map(row => row.afterLine),[1,2,3,4,5]);
  assert.equal(rows.filter(row => row.kind !== 'equal').length,2);
  assert.ok(rows.filter(row => row.kind === 'remove').every(row => row.afterLine === null));
  assert.ok(rows.filter(row => row.kind === 'add').every(row => row.beforeLine === null));
});

test('diffs preserve final newline and CR differences, with bounded input', () => {
  assert.deepEqual(lineDiff('a','a\n'),[
    {kind:'equal',beforeLine:1,afterLine:1,text:'a'},
    {kind:'add',beforeLine:null,afterLine:2,text:''}]);
  assert.deepEqual(lineDiff('a\n','a').at(-1),{kind:'remove',beforeLine:2,afterLine:null,text:''});
  assert.deepEqual(lineDiff('a\r\n','a\n').map(row => row.kind),['remove','add','equal']);
  assert.throws(() => lineDiff('a','x\n'.repeat(200)),/200 行/);
  assert.throws(() => lineDiff('a','x'.repeat(65537)),/64 KiB/);
  assert.throws(() => lineDiff(null,''),/源码文本/);
});

test('revision input rejects unchanged copies, forged status, missing confirmation and paths', async () => {
  const unchanged = input(); unchanged.source.text = original.source.text;
  await assert.rejects(validateRevisionInput(unchanged),/相同/);
  for (const forged of [{...input(),compileStatus:'compile_passed'},{...input(),confirmed:false},
    {...input(),confirmed:'true'},{...input(),revisionId:'a'.repeat(32)}])
    await assert.rejects(validateRevisionInput(forged),/确认/);
  for (const name of ['../source.cj','folder/source.cj','folder\\source.cj','a\n.cj','a'.repeat(129)+'.cj','file.txt']) {
    const candidate = input(); candidate.source.name = name;
    await assert.rejects(validateRevisionInput(candidate));
  }
  const extra = input(); extra.source.sha256 = 'a'.repeat(64);
  await assert.rejects(validateRevisionInput(extra));
  const large = input(); large.source.text = 'x'.repeat(65537);
  await assert.rejects(validateRevisionInput(large),/64 KiB/);
  const tooManyLines = input(); tooManyLines.source.text = '\n'.repeat(200);
  await assert.rejects(validateRevisionInput(tooManyLines),/200 行/);
  const oversizedBase = input(); oversizedBase.baseRecord.extra = 'x'.repeat(2 * 1024 * 1024);
  await assert.rejects(validateRevisionInput(oversizedBase),/2 MiB/);
  const executedBase = input(); executedBase.baseRecord.execution.attempted = true;
  await assert.rejects(validateRevisionInput(executedBase),/未执行/);
  const corruptBase = input(); corruptBase.baseRecord.source.sha256 = '0'.repeat(64);
  await assert.rejects(validateRevisionInput(corruptBase),/SHA-256/);
});

test('saved manual revisions reload intact while the compiler record remains unchanged', async t => {
  const root = await temporary(t), store = new RevisionStore(root), before = input();
  assert.deepEqual(await store.list(),{revisions:[],unreadable:0});
  const saved = await store.save(before);
  assert.deepEqual(saved.baseRecord,original);
  assert.equal(saved.origin,'manual'); assert.equal(saved.compileStatus,'not_run');
  assert.equal(saved.testStatus,'not_run'); assert.equal(saved.execution.attempted,false);
  assert.deepEqual(before,input());
  assert.equal(await validateRevision(saved),saved);
  assert.deepEqual(await new RevisionStore(root).get(saved.revisionId),saved);
  assert.deepEqual(await store.list(),{revisions:[{revisionId:saved.revisionId,createdAt:saved.createdAt,
    sourceName:saved.source.name,sourceSha256:saved.source.sha256,baseName:original.source.name,documentEvidenceCount:null}],unreadable:0});
  const another = await store.save(input());
  assert.notEqual(another.revisionId,saved.revisionId);
  assert.deepEqual(await store.get(saved.revisionId),saved);
});

test('CRLF baseline bytes and hashes survive saving an edited LF candidate', async t => {
  const root = await temporary(t), store = new RevisionStore(root), request = input();
  const digest = text => createHash('sha256').update(text,'utf8').digest('hex');
  request.baseRecord.source.text = original.source.text.replace(/\n/g,'\r\n');
  request.baseRecord.source.sha256 = digest(request.baseRecord.source.text);
  const expectedBase = JSON.stringify(request.baseRecord), expectedBytes = Buffer.from(request.baseRecord.source.text,'utf8');
  const expectedCandidate = request.source.text, saved = await store.save(request);
  assert.notEqual(saved.baseRecord.source.sha256,original.source.sha256);
  const disk = JSON.parse(await readFile(join(root,'runs/revisions',saved.revisionId,'revision.json'),'utf8'));
  const reloaded = await new RevisionStore(root).get(saved.revisionId);
  for (const revision of [saved,disk,reloaded]) {
    assert.deepEqual(Buffer.from(revision.baseRecord.source.text,'utf8'),expectedBytes);
    assert.equal(JSON.stringify(revision.baseRecord),expectedBase);
    assert.equal(revision.baseRecord.source.sha256,digest(expectedBytes));
    assert.equal(revision.recordSha256,digest(expectedBase));
    assert.equal(revision.source.text,expectedCandidate);
    assert.equal(revision.source.sha256,digest(expectedCandidate));
    assert.ok(!revision.source.text.includes('\r'));
    assert.notEqual(revision.source.sha256,revision.baseRecord.source.sha256);
  }
});

test('revision index returns only the newest twenty with deterministic timestamp ties', async t => {
  const root = await temporary(t), store = new RevisionStore(root), seed = await store.save(input());
  const ids = [seed.revisionId,...Array.from({length:21},(_,index) => (index+1).toString(16).padStart(32,'0'))];
  for (const [index,revisionId] of ids.entries()) {
    const directory = join(root,'runs/revisions',revisionId);
    if (index) await mkdir(directory);
    const record = {...seed,revisionId,createdAt:new Date(Date.UTC(2026,0,1,0,0,Math.min(index,20))).toISOString()};
    await writeFile(join(directory,'revision.json'),JSON.stringify(record));
  }
  const listed = await new RevisionStore(root).list();
  assert.equal(listed.unreadable,0);
  assert.deepEqual(listed.revisions.map(revision => revision.revisionId),[ids[20],ids[21],...ids.slice(2,20).reverse()]);
  assert.equal(listed.revisions.length,20);
  assert.ok(listed.revisions.every(revision => !Object.hasOwn(revision,'baseRecord') && !Object.hasOwn(revision,'source')));
  // Older records are omitted from the summary, not deleted from storage.
  assert.equal((await store.get(ids[0])).revisionId,ids[0]);
});

test('revision hashes and fixed unverified status cannot be bypassed', async t => {
  const saved = await new RevisionStore(await temporary(t)).save(input());
  for (const change of [r => r.source.text += '//changed',r => r.recordSha256 = '0'.repeat(64),
    r => r.baseRecord.compiler.version += '-modified',r => r.source.sha256 = '0'.repeat(64),
    r => r.compileStatus = 'compile_passed',r => r.testStatus = 'passed',r => r.execution.attempted = true,
    r => r.origin = 'ai',r => r.execution.testStatus = 'not_run',r => r.createdAt = 'yesterday',
    r => r.revisionId = '../record',r => r.source.extra = true]) {
    const corrupted = structuredClone(saved); change(corrupted);
    await assert.rejects(validateRevision(corrupted));
  }
});

test('corrupt, oversized and pending-only revisions are omitted with unreadable evidence', async t => {
  const root = await temporary(t), store = new RevisionStore(root);
  const valid = await store.save(input()), corrupt = await store.save(input());
  const corrupted = {...corrupt,recordSha256:'0'.repeat(64)};
  await writeFile(join(root,'runs/revisions',corrupt.revisionId,'revision.json'),JSON.stringify(corrupted));
  for (const [id,filename,text] of [['a'.repeat(32),'revision.pending.json','{}'],
    ['b'.repeat(32),'revision.json',' '.repeat(MAX_REVISION_BYTES+1)],
    ['d'.repeat(32),'revision.json',JSON.stringify(valid)]]) {
    const directory = join(root,'runs/revisions',id); await mkdir(directory);
    await writeFile(join(directory,filename),text);
  }
  const listed = await store.list();
  assert.equal(listed.revisions.length,1); assert.equal(listed.revisions[0].revisionId,valid.revisionId);
  assert.equal(listed.unreadable,4);
  await assert.rejects(store.get(corrupt.revisionId),error => error.status === 400);
  await assert.rejects(store.get('a'.repeat(32)),error => error.status === 404);
  await assert.rejects(store.get('b'.repeat(32)),error => error.status === 400);
  await assert.rejects(store.get('d'.repeat(32)),error => error.status === 400 && /编号不一致/.test(error.message));
  await assert.rejects(store.get('../revisions'),error => error.status === 400);
});

test('revision storage refuses linked directories outside the project', async t => {
  const root = await temporary(t), outside = await temporary(t), store = new RevisionStore(root);
  await mkdir(join(root,'runs'));
  await symlink(outside,join(root,'runs/revisions'),process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.save(input()),/链接|路径/);
  await assert.rejects(store.list(),/链接|路径/);
});

test('revision reads reject linked record files instead of following them', async t => {
  const root = await temporary(t), store = new RevisionStore(root), saved = await store.save(input());
  const directory = join(root,'runs/revisions','c'.repeat(32)); await mkdir(directory);
  try { await symlink(join(root,'runs/revisions',saved.revisionId,'revision.json'),join(directory,'revision.json'),'file'); }
  catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows does not permit file symlinks for this account.'); return; }
    throw error;
  }
  await assert.rejects(store.get('c'.repeat(32)),error => error.status === 400);
  assert.equal((await store.list()).unreadable,1);
});

test('revision HTTP accepts offline saves and authenticates both metadata and source reads', async t => {
  const {base,headers,post} = await service(t,new RevisionStore(await temporary(t)));
  assert.equal((await post(input(),{'X-Doctor-Token':''})).status,403);
  assert.equal((await post(input(),{Origin:'https://example.com'})).status,403);
  const foreignHost = await new Promise((resolve,reject) => {
    const req = request(base+'/api/revisions',{method:'POST',headers:{...headers,Host:'example.com'}},res => {
      res.resume(); resolve(res.statusCode);
    }); req.on('error',reject); req.end(JSON.stringify(input()));
  });
  assert.equal(foreignHost,403);
  const response = await post(input()); assert.equal(response.status,200);
  const revision = await response.json(); await validateRevision(revision);
  assert.equal((await fetch(base+'/api/revisions')).status,403);
  assert.equal((await fetch(base+'/api/revisions/'+revision.revisionId)).status,403);
  const history = await (await fetch(base+'/api/revisions',{headers})).json();
  assert.equal(history.revisions[0].revisionId,revision.revisionId);
  assert.deepEqual(await (await fetch(base+'/api/revisions/'+revision.revisionId,{headers})).json(),revision);
  assert.equal((await fetch(base+'/revision.mjs')).status,200);
});

test('revision HTTP rejects bad JSON, content type, excessive bodies, extra fields and paths', async t => {
  const {base,headers,post} = await service(t,new RevisionStore(await temporary(t)));
  assert.equal((await post(input(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await fetch(base+'/api/revisions',{method:'POST',headers,body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/revisions',{method:'POST',headers,body:Buffer.from([0xff])})).status,400);
  assert.equal((await post({...input(),testStatus:'passed'})).status,400);
  assert.equal((await post({...input(),confirmed:false})).status,400);
  assert.equal((await fetch(base+'/api/revisions',{method:'POST',headers,body:' '.repeat(MAX_REVISION_BYTES+1)})).status,413);
  for (const suffix of ['/../file','/%2e%2e%2fsecret','/'+('A'.repeat(32)),'/'+('a'.repeat(32))+'?path=secret'])
    assert.equal((await fetch(base+'/api/revisions'+suffix,{headers})).status,404);
  assert.equal((await fetch(base+'/api/revisions/'+'a'.repeat(32),{headers})).status,404);
});

test('archive write failures produce HTTP failure without an accepted revision', async t => {
  const root = await temporary(t); await writeFile(join(root,'runs'),'not a directory');
  const store = new RevisionStore(root), {post} = await service(t,store);
  await assert.rejects(store.save(input()));
  assert.notEqual((await post(input())).status,200);
  const unavailable = await service(t,null);
  assert.equal((await unavailable.post(input())).status,503);
});
