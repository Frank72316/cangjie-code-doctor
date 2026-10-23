// HTTP transport checks use controlled service doubles and disabled real services.
// No Docker daemon or candidate execution is involved; real acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { makeServer } from '../scripts/preview.mjs';
import { VerificationService } from '../scripts/verification-service.mjs';

const verificationId = 'a'.repeat(32), revisionId = 'b'.repeat(32);
const publicRequest = () => ({revisionId, tests:[{id:'sample',stdin:'',expectedStdout:'3\n'}], confirmed:true});
function fakeService(overrides = {}) {
  const calls = {list:0, get:[], verify:[], probe:0};
  return {calls, health:{available:false,code:'not_configured',detail:'Execution is off in this transport test.'},
    async probe() { calls.probe++; return this.health; },
    async list() { calls.list++; return {verifications:[{verificationId, state:'failed'}],unreadable:0}; },
    async get(id) { calls.get.push(id); return {verificationId:id, state:'failed', detail:'Archived test stand-in.'}; },
    async verify(input, signal) { calls.verify.push({input,signal}); return {verificationId,state:'failed',detail:'Synthetic transport response.'}; },
    ...overrides};
}
async function serve(t, verificationService = fakeService()) {
  const bridge = {token:'http-verification-test-token',busy:false,
    health:{available:false,code:'native_unavailable',detail:'Host native compiler is unavailable in this test.'},
    async probe() { return this.health; }};
  const server = makeServer({bridge,verificationService});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  const headers = {'Content-Type':'application/json','X-Doctor-Token':bridge.token};
  const post = (body, extra = {}) => fetch(base+'/api/verifications',
    {method:'POST',headers:{...headers,...extra},body:typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)});
  // node:http preserves the raw path and permits a deliberate invalid Host header.
  const raw = (path, {method='GET', body, extra={}} = {}) => new Promise((resolve,reject) => {
    const req = request({hostname:'127.0.0.1',port,path,method,headers:{...headers,...extra}}, res => {
      const chunks = []; res.on('data',chunk => chunks.push(chunk));
      res.on('end',() => resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks).toString('utf8')}));
    }); req.on('error',reject); req.end(body);
  });
  return {server,port,base,headers,bridge,verificationService,post,raw};
}

test('verification availability is independent of native sample compilation and health remains local-only', async t => {
  const service = fakeService({health:{available:true,code:'ready',image:'sha256:'+'c'.repeat(64)}});
  const env = await serve(t,service);
  const response = await fetch(env.base+'/api/health'), health = await response.json();
  assert.equal(response.status,200); assert.equal(health.available,false); assert.equal(health.verification.available,true);
  assert.equal(health.token,env.bridge.token); assert.equal(health.busy,false);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await env.raw('/api/health',{extra:{Host:'foreign.example'}})).status,403);
  const probed = await (await fetch(env.base+'/api/probe',{method:'POST',headers:env.headers})).json();
  assert.equal(probed.available,false); assert.equal(probed.verification.available,true); assert.equal(service.calls.probe,1);
  env.bridge.busy = true;
  assert.equal((await fetch(env.base+'/api/probe',{method:'POST',headers:env.headers})).status,409);
  assert.equal(service.calls.probe,1);
});

test('saved report metadata and content remain readable with execution disabled but require local token and origin', async t => {
  const env = await serve(t), service = env.verificationService;
  for (const path of ['/api/verifications','/api/verifications/'+verificationId]) {
    assert.equal((await fetch(env.base+path)).status,403);
    assert.equal((await fetch(env.base+path,{headers:{...env.headers,'X-Doctor-Token':'wrong'}})).status,403);
    assert.equal((await fetch(env.base+path,{headers:{...env.headers,Origin:'https://foreign.example'}})).status,403);
    assert.equal((await env.raw(path,{extra:{Host:'foreign.example'}})).status,403);
  }
  assert.equal(service.calls.list,0); assert.deepEqual(service.calls.get,[]);
  const listResponse = await fetch(env.base+'/api/verifications',{headers:{...env.headers,Origin:env.base}});
  const listed = await listResponse.json(); assert.equal(listResponse.status,200); assert.equal(listed.verifications[0].verificationId,verificationId);
  const detailResponse = await fetch(env.base+'/api/verifications/'+verificationId,{headers:env.headers});
  const detail = await detailResponse.json(); assert.equal(detailResponse.status,200); assert.equal(detail.verificationId,verificationId);
  assert.equal(service.health.available,false); assert.equal(service.calls.list,1); assert.deepEqual(service.calls.get,[verificationId]);
});

test('verification POST rejects cross-origin, wrong-host and missing-token requests before dispatch', async t => {
  const env = await serve(t), body = publicRequest();
  for (const extra of [{'X-Doctor-Token':''},{'X-Doctor-Token':'wrong'},{Origin:'https://foreign.example'}])
    assert.equal((await env.post(body,extra)).status,403);
  assert.equal((await env.raw('/api/verifications',{method:'POST',body:JSON.stringify(body),extra:{Host:'foreign.example'}})).status,403);
  const preflight = await fetch(env.base+'/api/verifications',{method:'OPTIONS',headers:{Origin:'https://foreign.example',
    'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'x-doctor-token'}});
  assert.equal(preflight.status,403); assert.equal(preflight.headers.get('access-control-allow-origin'),null);
  assert.equal(env.verificationService.calls.verify.length,0);
});

test('request transport rejects malformed UTF-8/JSON, wrong media type and excessive actual bytes', async t => {
  const env = await serve(t);
  for (const contentType of ['text/plain','application/json; charset=utf-8',''])
    assert.equal((await env.post(publicRequest(),{'Content-Type':contentType})).status,415);
  for (const body of ['{','',Buffer.from([0xff]),Buffer.concat([Buffer.from('{"x":"'),Buffer.from([0xc3,0x28]),Buffer.from('"}')])])
    assert.equal((await env.post(body)).status,400);
  // Fewer than 1 MiB characters but more than 1 MiB UTF-8 bytes must be rejected.
  const multibyte = JSON.stringify({text:'中'.repeat(350000)});
  assert.ok(multibyte.length < 1024*1024); assert.ok(Buffer.byteLength(multibyte) > 1024*1024);
  assert.equal((await env.post(multibyte)).status,413);
  assert.equal(env.verificationService.calls.verify.length,0);
});

test('decoded request validation excludes code, image, command and hidden fields even when execution is disabled', async t => {
  const real = new VerificationService({root:process.cwd(),platform:'win32'});
  const env = await serve(t,real);
  for (const body of [{...publicRequest(),source:{name:'input.cj',text:'main() {}'}},
    {...publicRequest(),command:'cjc input.cj'}, {...publicRequest(),image:'sha256:'+'d'.repeat(64)},
    {...publicRequest(),confirmed:false}, {...publicRequest(),confirmed:'true'},
    {...publicRequest(),revisionId:'../outside'}, {...publicRequest(),tests:[]},
    {...publicRequest(),tests:[{...publicRequest().tests[0],heldout:true}]},
    {...publicRequest(),tests:[publicRequest().tests[0],publicRequest().tests[0]]},
    {...publicRequest(),tests:[{...publicRequest().tests[0],stdin:'中'.repeat(1366)}]},
    {...publicRequest(),tests:[{...publicRequest().tests[0],expectedStdout:'x'.repeat(16385)}]},
    {...publicRequest(),tests:[{...publicRequest().tests[0],stdin:'\ud800'}]}, null, []]) {
    const response = await env.post(body); assert.equal(response.status,400,JSON.stringify(body).slice(0,200));
  }
  assert.equal((await env.post(publicRequest())).status,503);
  assert.equal(real.active.size,0); assert.equal(real.busy,false);
});

test('unknown paths, traversal, queries and unsupported methods never expose record files or invoke service methods', async t => {
  const env = await serve(t);
  for (const path of ['/api/verifications/../request.json','/api/verifications/%2e%2e%2frequest.json',
    '/api/verifications/'+verificationId+'/request.json','/api/verifications/'+verificationId+'?path=request.json',
    '/api/verifications/'+verificationId.toUpperCase(),'/api/verifications/?id='+verificationId,
    '/runs/revision-verifications/'+verificationId+'/request.json','/scripts/verification-service.mjs'])
    assert.equal((await env.raw(path)).status,404,path);
  for (const method of ['PUT','DELETE','HEAD','OPTIONS'])
    assert.equal((await env.raw('/api/verifications',{method})).status,404,method);
  assert.equal(env.verificationService.calls.list,0); assert.deepEqual(env.verificationService.calls.get,[]);
  assert.equal(env.verificationService.calls.verify.length,0);
  assert.equal((await fetch(env.base+'/verification.mjs')).status,200);
  assert.equal((await fetch(env.base+'/verification-ui.mjs')).status,200);
});

test('valid POST forwards only decoded body and AbortSignal, and normal response completion does not cancel it', async t => {
  const env = await serve(t), input = publicRequest();
  const response = await env.post(input,{Origin:env.base});
  assert.equal(response.status,200); assert.equal((await response.json()).verificationId,verificationId);
  const call = env.verificationService.calls.verify[0];
  assert.deepEqual(call.input,input); assert.ok(call.signal instanceof AbortSignal); assert.equal(call.signal.aborted,false);
  await nextTurn(); assert.equal(call.signal.aborted,false);
});

test('service storage errors retain verification identity without falsely returning a report', async t => {
  const service = fakeService({async verify() {
    throw Object.assign(new Error('Synthetic publication failure'),{status:500,verificationId,verificationState:'unknown'});
  }});
  const env = await serve(t,service), response = await env.post(publicRequest()), body = await response.json();
  assert.equal(response.status,500); assert.equal(body.verificationId,verificationId); assert.equal(body.verificationState,'unknown');
  assert.equal(Object.hasOwn(body,'report'),false); assert.match(body.error,/publication failure/);
});

test('client disconnection after dispatch aborts the running verification signal', {timeout:5000}, async t => {
  let entered, observed, release;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { observed = resolve; });
  let signalSeen;
  const service = fakeService({async verify(input, signal) {
    signalSeen = signal; entered();
    await new Promise(resolve => {
      release = resolve;
      if (signal.aborted) { observed(); resolve(); }
      else signal.addEventListener('abort',() => { observed(); resolve(); },{once:true});
    });
    return {verificationId,state:'failed',detail:'Synthetic cancellation result.'};
  }});
  const env = await serve(t,service);
  t.after(() => release?.());
  const req = request({hostname:'127.0.0.1',port:env.port,path:'/api/verifications',method:'POST',headers:env.headers});
  req.on('error',() => {}); req.end(JSON.stringify(publicRequest()));
  await started;
  assert.equal(signalSeen.aborted,false);
  req.destroy(); await aborted;
  assert.equal(signalSeen.aborted,true);
});
