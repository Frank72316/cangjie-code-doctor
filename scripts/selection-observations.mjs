import assert from 'node:assert/strict';

export function decodePool(record, inputs) {
  assert.ok(['passed','test_failed'].includes(record.status));
  const flat=record.after;
  assert.ok(record.returned===0 && Array.isArray(flat) && flat.length===inputs.length*6);
  return inputs.map((input,i)=>{
    assert.equal(input.array.length,5);
    return {returned:flat[i*6],after:flat.slice(i*6+1,i*6+6)};
  });
}
export function differs(a,b) {
  return a.returned!==b.returned || a.after.length!==b.after.length || a.after.some((v,i)=>v!==b.after[i]);
}
