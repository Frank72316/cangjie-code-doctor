// Controlled transport tests: these never compile or execute candidate programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { makeServer } from '../scripts/preview.mjs';

async function serve(t, overrides = {}) {
  const calls = {summary:0,export:0,save:0};
  const storageService = {
    async summary() { calls.summary++; return {kind:'test-summary'}; },
    async exportEvidence() { calls.export++; return {kind:'test-bundle'}; },
    ...overrides.storage,
  };
  const bridge = {token:'storage-test-token',busy:false,health:{available:false}};
  const revisionStore = {async save() { calls.save++; return {saved:true}; },...overrides.revision};
  const server = makeServer({bridge,revisionStore,storageService});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=> {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));});
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {'X-Doctor-Token':bridge.token,'Content-Type':'application/json'};
  const foreignHost = (path,method) => new Promise((resolve,reject)=> {
    const req=request(base+path,{method,headers:{...headers,Host:'foreign.invalid'}},res=> {
      res.resume(); res.on('end',()=>resolve(res.statusCode));
    }); req.on('error',reject); req.end(method==='POST' ? '{"confirmed":true}' : undefined);
  });
  const get = (path, extra={})=>fetch(base+path,{headers:{...headers,...extra}});
  const post = (path, input={confirmed:true}, extra={})=>fetch(base+path,{method:'POST',headers:{...headers,...extra},
    body:typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input)});
  return {base,bridge,calls,get,post,foreignHost};
}

test('storage and export require local token, host and origin without CORS',async t=> {
  const e=await serve(t);
  for (const extra of [{'X-Doctor-Token':''},{Origin:'https://foreign.invalid'}]) {
    assert.equal((await e.get('/api/storage',extra)).status,403);
    assert.equal((await e.post('/api/evidence-export',{confirmed:true},extra)).status,403);
  }
  assert.equal(await e.foreignHost('/api/storage','GET'),403);
  assert.equal(await e.foreignHost('/api/evidence-export','POST'),403);
  assert.deepEqual(e.calls,{summary:0,export:0,save:0});
  const result=await e.get('/api/storage');
  assert.equal(result.status,200); assert.equal(result.headers.get('cache-control'),'no-store');
  assert.equal(result.headers.get('access-control-allow-origin'),null);
  assert.equal((await e.post('/api/evidence-export')).status,200);
  assert.equal((await e.get('/api/evidence-export')).status,404);
  assert.equal((await e.post('/api/storage')).status,404);
});

test('export request accepts only explicit confirmation with bounded valid UTF-8 JSON',async t=> {
  const e=await serve(t);
  for (const value of [{},{confirmed:false},{confirmed:true,path:'../'},{confirmed:true,limit:20},[],null,'{',Buffer.from([0xff])])
    assert.equal((await e.post('/api/evidence-export',value)).status,400);
  assert.equal((await e.post('/api/evidence-export',{confirmed:true},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await e.post('/api/evidence-export',' '.repeat(1025))).status,413);
  assert.equal(e.calls.export,0);
  assert.equal((await e.post('/api/evidence-export')).status,200,'bad requests must release export admission');
});

test('export blocks new local writes and duplicate exports but leaves reads available',async t=> {
  let release, entered;
  const started=new Promise(resolve=>entered=resolve);
  const pending=new Promise(resolve=>release=resolve);
  const e=await serve(t,{storage:{async exportEvidence(){entered(); await pending; return {kind:'test-bundle'};}}});
  t.after(()=>release());
  const exporting=e.post('/api/evidence-export'); await started;
  for (const path of ['/api/revisions','/api/probe','/api/compile-example','/api/retrieve','/api/verifications','/api/evidence-export'])
    assert.equal((await e.post(path)).status,409,path);
  assert.equal((await e.get('/api/storage')).status,200);
  release(); assert.equal((await exporting).status,200);
  assert.equal((await e.post('/api/revisions')).status,200); assert.equal(e.calls.save,1);
});

test('an in-flight revision save or native task prevents export; failure releases admission',async t=> {
  let release, entered;
  const started=new Promise(resolve=>entered=resolve), pending=new Promise(resolve=>release=resolve);
  const e=await serve(t,{revision:{async save(){entered(); await pending; throw new Error('simulated save failure');}}});
  t.after(()=>release());
  const saving=e.post('/api/revisions'); await started;
  assert.equal((await e.post('/api/evidence-export')).status,409);
  release(); assert.equal((await saving).status,500);
  e.bridge.busy=true; assert.equal((await e.post('/api/evidence-export')).status,409);
  e.bridge.busy=false; assert.equal((await e.post('/api/evidence-export')).status,200);
});

test('failed export and inventory scan release their slots; scan cannot overlap itself',async t=> {
  let release, entered;
  const started=new Promise(resolve=>entered=resolve), pending=new Promise(resolve=>release=resolve);
  let scanCount=0, exportCount=0;
  const e=await serve(t,{storage:{
    async summary(){ if (++scanCount===1) {entered(); await pending; throw new Error('simulated scan failure');} return {};},
    async exportEvidence(){ if (++exportCount===1) throw Object.assign(new Error('corrupt record'),{status:400}); return {};},
  }});
  t.after(()=>release());
  const scanning=e.get('/api/storage'); await started;
  assert.equal((await e.get('/api/storage')).status,409); release(); assert.equal((await scanning).status,500);
  assert.equal((await e.get('/api/storage')).status,200);
  assert.equal((await e.post('/api/evidence-export')).status,400);
  assert.equal((await e.post('/api/evidence-export')).status,200);
});
