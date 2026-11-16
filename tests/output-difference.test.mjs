import test from 'node:test';
import assert from 'node:assert/strict';
import { outputDifference } from '../web/output-difference.mjs';
const explain=(expected,actual,status='failed')=>outputDifference({expectedStdout:expected},{status,process:{stdout:actual}});
test('points at the first different displayed character without changing the verdict',()=>{
  assert.match(explain('3\n','4\n'),/第 1 行、第 1 个字符，期望 "3"，实际 "4"/);
  assert.match(explain('ok\nabc','ok\naxc'),/第 2 行、第 2 个字符/);
  assert.match(explain('猫😀a','猫😀b'),/第 1 行、第 3 个字符/);
});
test('trailing newline, spaces, CRLF, tabs and end-of-text are explicit',()=>{
  assert.match(explain('a\n','a'),/期望 换行（LF，\\n），实际 文本结束/);
  assert.match(explain('a','a '),/期望 文本结束，实际 空格（SPACE）/);
  assert.match(explain('a\n','a\r\n'),/实际 回车（CR，\\r）/);
  assert.match(explain('a\t','a '),/期望 制表符（TAB，\\t）/);
  assert.match(explain('','x'),/期望 文本结束/);
});
test('never turns identical display text into a passed byte verdict',()=>{
  assert.match(explain('�','�'),/原生判定为输出字节不符/);
  assert.match(explain('',''),/不能据此改判通过/);
});
test('does not invent output differences for missing, passed or abnormal runs',()=>{
  for(const status of ['passed','runtime_error','timeout','output_limit','tool_error','not_run'])
    assert.equal(explain('3','4',status),null);
  assert.equal(outputDifference({expectedStdout:'3'},{status:'failed',process:null}),null);
  assert.equal(outputDifference(null,null),null);
});
