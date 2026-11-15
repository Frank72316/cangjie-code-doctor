import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAIFields } from '../web/ai-settings.mjs';
import { makeServer } from '../scripts/preview.mjs';

const draft={baseURL:'https://api.example.com/v1',model:'example-model',apiKey:'synthetic-key-only'};
test('AI form checks syntax only and never returns key or a connection success',()=>{
  assert.deepEqual(validateAIFields(draft),{valid:true,errors:{}});
  for (const baseURL of ['http://localhost:1234/v1','http://127.0.0.1:1234/v1','http://[::1]:1234/v1']) {
    assert.equal(validateAIFields({...draft,baseURL}).valid,true);
  }
});
test('AI service address refuses remote HTTP, URL credentials, query secrets and fragments',()=>{
  for (const baseURL of ['http://api.example.com/v1','https://user:secret@example.com/v1',
    'https://api.example.com/v1?key=synthetic-private','https://example.com/#synthetic-private',
    'javascript:alert(1)','file:///private','https://example.com/\n','']) {
    const result=validateAIFields({...draft,baseURL});
    assert.equal(result.valid,false); assert.ok(result.errors.baseURL);
    assert.ok(!JSON.stringify(result).includes('synthetic-private'));
  }
});
test('AI form rejects empty, oversized and whitespace secrets without echoing them',()=>{
  for (const apiKey of ['', ' synthetic-key-only', 'synthetic-key-only\n','密钥', 'a'.repeat(4097)]) {
    const result=validateAIFields({...draft,apiKey});
    assert.equal(result.valid,false); assert.ok(result.errors.apiKey);
    assert.ok(!JSON.stringify(result).includes('synthetic-key-only'));
  }
  for (const model of ['', 'model name','a'.repeat(161),'<script>']) assert.ok(validateAIFields({...draft,model}).errors.model);
});
test('AI page serves module in both themes without opening cross-origin connections or model APIs',async t=>{
  for (const previewTheme of [null,'voxel']) {
    const server=makeServer({previewTheme});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}`;
    const page=await fetch(base+'/ai'); assert.equal(page.status,200);
    assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
    assert.match(await page.text(),/模型待接入/);
    const module=await fetch(base+'/ai-settings.mjs'); assert.equal(module.status,200);
    assert.match(module.headers.get('content-type'),/javascript/);
    assert.equal((await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  }
});
