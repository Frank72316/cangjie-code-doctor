import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../scripts/preview.mjs';

async function listen(t, options) {
  const server = makeServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('starting a voxel preview does not change the default workbench or expose its assets there', async t => {
  const workbench = await listen(t);
  const preview = await listen(t, {previewTheme:'voxel'});
  const themed = await fetch(preview + '/tutorial');
  assert.equal(themed.status, 200);
  assert.match(await themed.text(), /data-theme="voxel"/);

  for (const path of ['/tutorial', '/tutorial?previewTheme=voxel']) {
    const response = await fetch(workbench + path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.doesNotMatch(html, /data-theme="voxel"|voxel-preview\.css/);
    assert.match(html, /\/assets\/sketch\/hero-desk\.svg/);
  }
  for (const path of ['/voxel-preview.css', '/assets/voxel/credits.html']) {
    const response = await fetch(workbench + path);
    assert.equal(response.status, 404, path);
    await response.text();
  }
});

test('voxel preview keeps six direct page entries and serves its isolated stylesheet', async t => {
  const preview = await listen(t, {previewTheme:'voxel'});
  for (const page of ['tutorial', 'diagnostics', 'documents', 'ai', 'records', 'history']) {
    const response = await fetch(`${preview}/${page}`);
    assert.equal(response.status, 200, page);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const html = await response.text();
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, /data-theme="voxel"/);
    assert.match(html, /<link[^>]+href="\/voxel-preview\.css"/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  }
  const stylesheet = await fetch(preview + '/voxel-preview.css');
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /^text\/css/);
  assert.ok((await stylesheet.text()).trim().length > 0);

  for (const path of ['/assets/voxel/not-allowlisted.png', '/runs/', '/scripts/voxel-theme.mjs']) {
    const response = await fetch(preview + path);
    assert.equal(response.status, 404, path);
    await response.text();
  }
});

test('voxel preview has no write token and refuses workbench operations even with a supplied token', async t => {
  const preview = await listen(t, {previewTheme:'voxel'});
  const healthResponse = await fetch(preview + '/api/health');
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.available, false);
  assert.equal(health.busy, false);
  assert.equal(health.verification.available, false);
  assert.equal('token' in health, false);

  for (const [method, path, input] of [
    ['POST', '/api/compile-example', {caseId:'hello'}],
    ['POST', '/api/revisions', {}],
    ['POST', '/api/verifications', {}],
    ['POST', '/api/retrieve', {}],
    ['POST', '/api/probe', {}],
    ['POST', '/api/evidence-export', {}],
    ['GET', '/api/history'],
    ['GET', '/api/storage']
  ]) {
    const response = await fetch(preview + path, {
      method,
      headers:{'Origin':preview, 'Content-Type':'application/json', 'X-Doctor-Token':'not-a-workbench-token'},
      ...(method === 'POST' ? {body:JSON.stringify(input)} : {})
    });
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(typeof (await response.json()).error, 'string');
  }
});

test('visual preview rejects unknown themes and every workbench service attachment', () => {
  for (const previewTheme of ['unknown', '']) {
    assert.throws(() => makeServer({previewTheme}), /Unknown preview theme/);
  }
  for (const service of ['bridge', 'revisionStore', 'verificationService', 'storageService']) {
    assert.throws(() => makeServer({previewTheme:'voxel', [service]:{}}), /cannot connect to workbench services/, service);
  }
});

test('formal voxel styling preserves runtime health and requires the same local API token', async t => {
  const bridge={health:{available:false,code:'runtime_unavailable',detail:'Native runtime unavailable'},token:'synthetic-test-token',busy:false,history:async()=>({tasks:[]})};
  const base=await listen(t,{bridge,workbenchTheme:'voxel'});
  const html=await (await fetch(base+'/tutorial')).text();
  assert.match(html,/data-theme="voxel"/);
  assert.match(html,/正式工作台 · 本地服务/);
  assert.doesNotMatch(html,/设计试稿|编译与保存请回到原工作台/);
  assert.equal((await fetch(base+'/assets/voxel/grass-top.png')).status,200);
  const health=await (await fetch(base+'/api/health')).json();
  assert.equal(health.available,false);
  assert.equal(health.code,'runtime_unavailable');
  assert.equal((await fetch(base+'/api/history')).status,403);
  assert.equal((await fetch(base+'/api/history',{headers:{'X-Doctor-Token':bridge.token,Origin:'https://example.invalid'}})).status,403);
  assert.equal((await fetch(base+'/api/history',{headers:{'X-Doctor-Token':bridge.token,Origin:base}})).status,200);
  assert.throws(()=>makeServer({workbenchTheme:'unknown'}),/Unknown workbench theme/);
  assert.throws(()=>makeServer({workbenchTheme:'voxel',previewTheme:'voxel'}),/Choose preview or workbench/);
});
