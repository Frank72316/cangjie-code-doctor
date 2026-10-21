import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRecord, compileView, validateSource, sourceIsCurrent, lineRange, sha256 } from '../web/report.mjs';
import { makeServer } from '../scripts/preview.mjs';
const names = ['type_mismatch', 'undefined_name', 'argument_count', 'hello'];
const records = await Promise.all(names.map(async name => readRecord(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'))));
const changed = () => structuredClone(records[0]);
test('four real captures retain the reviewed original bytes and expected compiler positions', async () => {
  const expected = [[2,24],[2,13],[6,16],null];
  for (const [i, r] of records.entries()) {
    const source = await readFile(new URL(`../examples/${r.source.name}`, import.meta.url), 'utf8');
    assert.equal(r.source.text, source); assert.equal(await sha256(source), r.source.sha256);
    const view = compileView(r);
    assert.equal(view.status, i === 3 ? 'compile_passed' : 'compile_failed');
    if (expected[i]) assert.deepEqual([view.diagnostics[0].line, view.diagnostics[0].column], expected[i]);
    assert.equal(r.execution.attempted, false); assert.equal(r.execution.testStatus, 'not_run');
  }
});
test('hash mismatch rejects a modified or corrupt record', async () => {
  const r = changed(); r.source.text += '// altered';
  await assert.rejects(readRecord(JSON.stringify(r)), /SHA-256/);
});
test('record contract refuses behavior-test claims', async () => {
  const r = changed(); r.execution.testStatus = 'passed';
  await assert.rejects(readRecord(JSON.stringify(r)), /未执行/);
});
test('native crash cannot be classified as a source error or pass', () => {
  const r = changed(); r.compiler.exitCode = -1073741819;
  assert.equal(compileView(r).status, 'tool_error');
});
test('timeout and empty failed output remain tool errors', () => {
  const r = changed(); r.compiler.timedOut = true;
  assert.equal(compileView(r).status, 'tool_error');
  r.compiler.timedOut = false; r.compiler.stderr = ''; r.compiler.stdout = '';
  assert.equal(compileView(r).status, 'tool_error');
});
test('clean compiler needs an actual artifact, and does not assert correct behavior', () => {
  const r = structuredClone(records[3]); r.compiler.artifactCreated = false;
  assert.equal(compileView(r).status, 'tool_error');
  assert.match(compileView(records[3]).detail, /尚未运行/);
});
test('contradictory counts, missing fields, overflow and noisy streams fail closed', () => {
  for (const output of ['{}', '{', '{"Diags":[],"Num":{"Errors":9999999999999999999}}',
    '{"Diags":[{"Severity":"error","Message":"oops"}],"Num":{"Errors":0}}']) {
    const r = changed(); r.compiler.stderr = output; assert.equal(compileView(r).status, 'tool_error');
  }
  const r = changed(); r.compiler.stdout = 'unexpected stdout'; assert.equal(compileView(r).status, 'tool_error');
});
test('truncated diagnostic lists remain partial evidence', () => {
  const r = changed(); const raw = JSON.parse(r.compiler.stderr); raw.Num.Errors = 2; r.compiler.stderr = JSON.stringify(raw);
  assert.equal(compileView(r).parseState, 'partial'); assert.equal(compileView(r).status, 'compile_failed');
});
test('missing, out-of-range and foreign-file locations cannot navigate the source', () => {
  for (const location of [{}, {File:'input.cj',Line:999,Column:1}, {File:'library.cj',Line:1,Column:1}]) {
    const r = changed(); const raw = JSON.parse(r.compiler.stderr); raw.Diags[0].Location = location;
    r.compiler.stderr = JSON.stringify(raw); assert.equal(compileView(r).diagnostics[0].canLocate, false);
  }
});
test('source edits and renamed imports invalidate old locations; restoring restores them', () => {
  const r = records[0]; assert.equal(sourceIsCurrent(r, r.source.name, r.source.text), true);
  assert.equal(sourceIsCurrent(r, r.source.name, r.source.text + '\n'), false);
  assert.equal(sourceIsCurrent(r, 'other.cj', r.source.text), false);
  assert.deepEqual(lineRange(r.source.text, 2), {start:9, end:39});
  assert.equal(lineRange(r.source.text, 0), null);
});
test('local import enforces single-file preview limits', () => {
  assert.throws(() => validateSource('a.txt', 'hello'), /\.cj/);
  assert.throws(() => validateSource('a.cj', 'x\n'.repeat(200)), /200/);
  assert.throws(() => validateSource('a.cj', '仓'.repeat(22000)), /64 KiB/);
  assert.throws(() => validateSource('a.cj', 'x\0y'), /空字符/);
  assert.equal(validateSource('a.cj', 'main() {}'), 'main() {}');
});
test('static preview serves only listed assets and has no compile or upload endpoint', async t => {
  const server = makeServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /编译诊断工作台/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(base + '/fixtures/type_mismatch.json')).status, 200);
  for (const path of ['/../../README.md', '/%2e%2e/.git/config', '/runs/', '/compile', '/.env'])
    assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(base + '/', {method:'POST', body:'main() {}'})).status, 405);
});
