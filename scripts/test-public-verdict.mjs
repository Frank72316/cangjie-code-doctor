// Exercise the real Cangjie comparator. This script does not execute candidates.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const executable = resolve(process.argv[2] ?? 'target/debug/doctor');
await mkdir('runs', { recursive: true });
// Relative ASCII arguments avoid the Windows SDK's non-ASCII argument limitation.
const directory = await mkdtemp('runs/public-verdict-check-');
const actualFile = join(directory, 'actual.stdout');
const expectedFile = join(directory, 'expected.stdout');

function invoke(args, expectedExit = 0) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 65536, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, expectedExit, `Unexpected native exit: ${result.stdout} ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function compare(name, actual, expected, exitCode, status, matches) {
  actual = Buffer.from(actual);
  expected = Buffer.from(expected);
  await writeFile(actualFile, actual);
  await writeFile(expectedFile, expected);
  const result = invoke(['check-output', actualFile, expectedFile, String(exitCode)]);
  assert.deepEqual(result, {
    status, comparison: 'exact_bytes', exitCode, stdoutMatches: matches,
    actualBytes: actual.length, expectedBytes: expected.length,
  });
  console.log(`PASS native public verdict: ${name}`);
}

await compare('hello matches', 'Hello, Doctor!\n', 'Hello, Doctor!\n', 0, 'passed', true);
await compare('wrong output', 'Hello, Doctor!\n', 'Goodbye!\n', 0, 'failed', false);
await compare('nonzero exit with matching output', 'OK\n', 'OK\n', 7, 'runtime_error', true);
await compare('nonzero exit with mismatching output', 'bad\n', 'OK\n', 1, 'runtime_error', false);
await compare('empty output', '', '', 0, 'passed', true);
await compare('trailing newline is significant', 'OK', 'OK\n', 0, 'failed', false);
await compare('CRLF is not normalized', 'OK\r\n', 'OK\n', 0, 'failed', false);
await compare('NUL is preserved', Buffer.from([65, 0, 66]), Buffer.from([65, 0, 67]), 0, 'failed', false);
await compare('UTF-8 byte lengths', '仓颉😀\n', '仓颉😀\n', 0, 'passed', true);
await compare('invalid UTF-8 is not replaced', Buffer.from([0xff]), '\ufffd', 0, 'failed', false);
await compare('same invalid bytes compare exactly', Buffer.from([0xff]), Buffer.from([0xff]), 0, 'passed', true);
await compare('expected size boundary', Buffer.alloc(16384, 65), Buffer.alloc(16384, 65), 0, 'passed', true);
await compare('actual size boundary', Buffer.alloc(65536, 65), '', 0, 'failed', false);

for (const [name, actual, expected] of [
  ['actual over limit', Buffer.alloc(65537), Buffer.alloc(0)],
  ['expected over limit', Buffer.alloc(0), Buffer.alloc(16385)],
]) {
  await writeFile(actualFile, actual);
  await writeFile(expectedFile, expected);
  assert.equal(invoke(['check-output', actualFile, expectedFile, '0'], 3).status, 'tool_error');
  console.log(`PASS native public verdict rejects: ${name}`);
}
await writeFile(actualFile, 'OK\n');
await writeFile(expectedFile, 'OK\n');
for (const [name, args] of [
  ['missing actual file', ['check-output', join(directory, 'missing.stdout'), expectedFile, '0']],
  ['missing expected file', ['check-output', actualFile, join(directory, 'missing.stdout'), '0']],
  ['invalid exit code', ['check-output', actualFile, expectedFile, 'not-a-number']],
  ['overflow exit code', ['check-output', actualFile, expectedFile, '999999999999999999999999']],
  ['missing arguments', ['check-output']],
  ['extra arguments', ['check-output', actualFile, expectedFile, '0', 'extra']],
]) {
  assert.equal(invoke(args, 3).status, 'tool_error');
  console.log(`PASS native public verdict rejects: ${name}`);
}
console.log('PASS native public-output exact-byte contract; no candidate was executed');
