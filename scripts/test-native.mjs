// Portable native checks. A failed startup is a failure, never a skipped pass.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const executable = resolve(process.argv[2] ?? 'target/debug/doctor');
function run(args, expectedExit = 0) {
  const r = spawnSync(executable, args, {encoding:'utf8', timeout:15000, maxBuffer:2 * 1024 * 1024});
  assert.ifError(r.error);
  assert.equal(r.signal, null, `Native signal: ${r.signal}`);
  assert.equal(r.status, expectedExit, `Native exit ${r.status}: ${r.stderr} ${r.stdout}`);
  return r.stdout;
}
assert.match(run(['--version']), /Cangjie Code Doctor/);
assert.match(run(['--self-test']), /PASS:/);
mkdirSync('runs', {recursive:true});
const directory = await mkdtemp('runs/native-check-');
for (const name of ['type_mismatch', 'undefined_name', 'argument_count', 'hello']) {
  const record = JSON.parse(await readFile(`tests/fixtures/${name}.json`, 'utf8'));
  const input = join(directory, `${name}.json`);
  await writeFile(input, record.compiler.stderr + record.compiler.stdout, 'utf8');
  const result = JSON.parse(run(['parse', input, String(record.compiler.exitCode)]));
  assert.equal(result.status, name === 'hello' ? 'compile_passed' : 'compile_failed');
  assert.equal(result.testStatus, 'not_run');
  assert.equal(result.rawDiagnostics, record.compiler.stderr + record.compiler.stdout);
  if (name !== 'hello') {
    const raw = JSON.parse(record.compiler.stderr).Diags[0];
    assert.equal(result.diagnostics[0].line, raw.Location.Line);
    assert.equal(result.diagnostics[0].column, raw.Location.Column);
    assert.equal(result.diagnostics[0].message, raw.Message);
  }
  console.log(`PASS native capture: ${name}`);
}
const broken = join(directory, 'invalid.json');
await writeFile(broken, '{}');
assert.equal(JSON.parse(run(['parse', broken, '0'], 3)).status, 'tool_error');
run([], 2);
console.log('PASS native CLI, self-tests, real captures and error exits');
