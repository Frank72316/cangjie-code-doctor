import assert from 'node:assert/strict';

export function parseArray(text) {
  const rows = [];
  const pattern = /let (q\d+): Array<Int64> = (Array<Int64>\(\)|\[[^\]]*\])\s+let r(\d+)=repair\(\1, (-?\d+)\)\s+println\(r\3 == (-?\d+) && \1 == (Array<Int64>\(\)|\[[^\]]*\])\)/g;
  const values = literal => literal.startsWith('[') ? JSON.parse(literal) : [];
  for (const [, , array, , t, returned, after] of text.matchAll(pattern)) {
    rows.push({input:[values(array),Number(t)], value:Number(returned), after:values(after)});
  }
  return rows;
}

export function arrayOracle(id,[input,t]) {
  const [kind,variant] = id.split('_'), after = [...input];
  if (kind === 'streak') {
    const runs = input.map(x => Number(variant === 'strict' ? x > t : x >= t)).join('').split('0');
    return [Math.max(...runs.map(r=>r.length)),after];
  }
  if (kind === 'prefix') {
    const end = input.findIndex(x => variant === 'equal' ? x >= t : x > t);
    return [input.slice(0,end < 0 ? input.length : end).reduce((a,b)=>a+b,0),after];
  }
  assert.ok(['index','cap'].includes(kind));
  const match = x => kind === 'index' ? x >= t : x > t;
  const i = variant === 'first' ? input.findIndex(match) : input.findLastIndex(match);
  if (kind === 'cap' && i >= 0) after[i] = t;
  return [i,after];
}
