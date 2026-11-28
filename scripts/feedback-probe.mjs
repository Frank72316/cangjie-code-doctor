import assert from 'node:assert/strict';
import {harnessSource} from './pilot-holdout.mjs';

export function probeRequest(source, probe) {
  const {returned, after} = probe.expected;
  const expectedStdout = [returned, after.length, ...after].join('\n') + '\n';
  return {source: harnessSource(source, probe.harness), tests: [{id:'diagnostic', stdin:'', expectedStdout}]};
}

export function observation(report) {
  assert.notEqual(report.status, 'tool_error');
  const test = report.tests[0];
  if (!test?.process || test.process.exitCode !== 0) return {status: report.status};
  const lines = test.process.stdout.trim().split(/\r?\n/);
  if (!lines.every(line => /^-?\d+$/.test(line))) return {status:report.status};
  const [returned, size, ...after] = lines.map(Number);
  if (size !== after.length || ![returned, ...after].every(Number.isSafeInteger)) return {status:report.status};
  return {status:report.status, returned, after};
}
