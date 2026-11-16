// Explanation of the displayed UTF-8 text only. Never replaces the native
// exact-byte verdict or infers correctness from a readable log excerpt.
const character = value => value === undefined ? '文本结束'
  : ({' ':'空格（SPACE）','\n':'换行（LF，\\n）','\r':'回车（CR，\\r）','\t':'制表符（TAB，\\t）'}[value] || JSON.stringify(value));

export function outputDifference(test, result) {
  if (result?.status !== 'failed' || typeof result.process?.stdout !== 'string'
    || typeof test?.expectedStdout !== 'string') return null;
  const expected=Array.from(test.expectedStdout), actual=Array.from(result.process.stdout);
  let index=0, line=1, column=1;
  while(index<expected.length && index<actual.length && expected[index]===actual[index]) {
    if(expected[index]==='\n'){line++;column=1;}else column++;
    index++;
  }
  if(index===expected.length && index===actual.length)
    return '显示文本相同，但原生判定为输出字节不符。请核对原始输出文件与字节哈希；不能据此改判通过。';
  return `显示文本首个差异：第 ${line} 行、第 ${column} 个字符，期望 ${character(expected[index])}，实际 ${character(actual[index])}。位置按 Unicode 字符计数；最终结论以原生字节判定为准。`;
}
