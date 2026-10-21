// Native compiler integration on individually reviewed sources; no candidate execution.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, stat, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readRecord, compileView } from '../web/report.mjs';
const executable = resolve(process.argv[2]);
const compiler = resolve(process.argv[3]);
const id = () => randomUUID().replaceAll('-', '');
function run(root, name, taskId, expected = 0) {
  const p = spawnSync(executable, ['compile-example', root, compiler, name, taskId, new Date().toISOString()],
    {encoding:'utf8', timeout:45000, maxBuffer:3 * 1024 * 1024});
  assert.ifError(p.error); assert.equal(p.signal, null);
  assert.equal(p.status, expected, p.stdout + p.stderr);
  return JSON.parse(p.stdout);
}
await mkdir('runs', {recursive:true});
for (const name of ['type_mismatch', 'undefined_name', 'argument_count', 'hello']) {
  const original = await readFile(`examples/${name}.cj`);
  const taskId = id();
  const r = run(process.cwd(), name, taskId);
  const record = await readRecord(JSON.stringify(r));
  assert.equal(record.producer, 'cangjie-core');
  assert.equal(record.taskId, taskId);
  const expected = name === 'hello' ? 'compile_passed' : 'compile_failed';
  assert.equal(record.normalized.status, expected);
  assert.equal(compileView(record).status, expected);
  assert.equal(record.source.sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(await readFile(`examples/${name}.cj`), original);
  assert.deepEqual(await readFile(`runs/native/${taskId}/input.cj`), original);
  const saved = await readFile(`runs/native/${taskId}/record.json`, 'utf8');
  assert.deepEqual(JSON.parse(saved), record);
  assert.equal(record.execution.attempted, false);
  run(process.cwd(), name, taskId, 3);
  assert.equal(await readFile(`runs/native/${taskId}/record.json`, 'utf8'), saved, 'Existing task must not be overwritten');
  if (name === 'hello') assert.ok((await stat(`runs/native/${taskId}/program.exe`)).size > 0);
  console.log(`PASS native compilation, snapshot and exclusive history: ${name}`);
}
run(process.cwd(), '../hello', id(), 3);
run(process.cwd(), 'hello', '../outside', 3);
const changedRoot = await mkdtemp('runs/changed-example-');
await mkdir(join(changedRoot, 'examples'));
await writeFile(join(changedRoot, 'examples/hello.cj'), 'main() { println("changed") }');
const rejected = run(resolve(changedRoot), 'hello', id(), 3);
assert.match(rejected.detail, /changed since review/);
console.log('PASS changed source, unknown case and invalid task ID rejected before compiling');
