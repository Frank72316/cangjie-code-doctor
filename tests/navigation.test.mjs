import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../scripts/preview.mjs';

test('workspace pages support direct entry and refresh without exposing arbitrary files', async t => {
  const server = makeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, page] of [['/', 'diagnostics'], ['/diagnostics', 'diagnostics'], ['/documents', 'documents'], ['/records', 'records'], ['/history', 'history']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), new RegExp(`<body data-page="${page}">`), path);
    const refreshed = await fetch(base + path + '?refresh=1');
    assert.equal(refreshed.status, 200, `${path} refresh`);
    assert.match(await refreshed.text(), new RegExp(`<body data-page="${page}">`));
  }
  const module = await fetch(base + '/navigation.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /^text\/javascript/);
  assert.match(await module.text(), /export function initNavigation/);
  for (const path of ['/unknown', '/documents/', '/runs/private.json', '/data/docs/cangjie-1.0.5.json', '/AGENTS.md', '/%2e%2e%2fAGENTS.md']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const head = await fetch(base + '/history', {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(base + '/documents', {method:'POST'})).status, 405);
});
