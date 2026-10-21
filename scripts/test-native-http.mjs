import assert from 'node:assert/strict';
import { NativeBridge } from './native-bridge.mjs';
import { makeServer } from './preview.mjs';
import { readRecord, compileView } from '../web/report.mjs';
import { resolve } from 'node:path';
const bridge = new NativeBridge({root:process.cwd(),executable:resolve(process.argv[2]),compiler:resolve(process.argv[3])});
assert.equal((await bridge.probe()).available,true,'Native runtime and pinned compiler must work');
const server = makeServer({bridge}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await (await fetch(base+'/api/health')).json();
  const response = await fetch(base+'/api/compile-example',{method:'POST',headers:{'Content-Type':'application/json','X-Doctor-Token':health.token},body:JSON.stringify({caseId:'type_mismatch'})});
  assert.equal(response.status,200);
  const record = await readRecord(await response.text());
  assert.equal(record.producer,'cangjie-core'); assert.equal(compileView(record).status,'compile_failed');
  assert.equal(record.normalized.diagnostics[0].line,2);
  const history = await (await fetch(base+'/api/history',{headers:{'X-Doctor-Token':health.token}})).json();
  assert.ok(history.records.some(r=>r.taskId===record.taskId));
  console.log('PASS HTTP → Cangjie → cjc → native normalization → browser record contract → persisted history');
} finally { await new Promise(r=>server.close(r)); }
