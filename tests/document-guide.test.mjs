import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {documentGuide, appendDocumentText} from '../web/document-guide.mjs';
import {compileView} from '../web/report.mjs';
const corpus=JSON.parse(await readFile(new URL('../data/docs/cangjie-1.0.5.json',import.meta.url),'utf8'));
const evidence={queryOrigin:'diagnostics',results:corpus.documents};
async function fixture(name) {return JSON.parse(await readFile(new URL(`fixtures/${name}.json`,import.meta.url),'utf8'));}
test('type reading aid explains actual types and only cites exact retrieved text',async()=>{
  const record=await fixture('type_mismatch');
  const [g]=documentGuide(evidence,compileView(record).diagnostics,record.source.text);
  assert.match(g.title,/Int64.*String/); assert.equal(g.line,2); assert.match(g.code,/three/);
  assert.equal(g.quotes.length,2); assert.equal(g.quotes[0].id,'variables-initialization');
  for(const q of g.quotes) assert.ok(evidence.results.find(r=>r.id===q.id).text.includes(q.quote));
  assert.ok(!g.check.includes('改成 3')); assert.match(g.check,/不能直接套/);
});
test('no-hit and changed excerpts never invent official rules',async()=>{
  const r=await fixture('type_mismatch'),d=compileView(r).diagnostics;
  assert.equal(documentGuide({...evidence,results:[]},d,r.source.text)[0].quotes.length,0);
  const changed=evidence.results.map(x=>({...x,text:'different excerpt'}));
  assert.equal(documentGuide({...evidence,results:changed},d,r.source.text)[0].quotes.length,0);
  assert.deepEqual(documentGuide({...evidence,queryOrigin:'manual'},d,r.source.text),[]);
});
test('type error outside a declaration does not misapply the initialization rule',async()=>{
  const r=await fixture('type_mismatch'),d=compileView(r).diagnostics;
  const [g]=documentGuide(evidence,d,'main() {\n    return "three"\n}');
  assert.ok(!g.quotes.some(q=>q.id==='variables-initialization'));
  assert.match(g.check,/返回值/);
});
test('argument count and undeclared name explain diagnostic data without hardcoded answers',async()=>{
  for(const [name,title] of [['argument_count',/2 个参数.*1 个/],['undefined_name',/total/]]) {
    const r=await fixture(name),[g]=documentGuide(evidence,compileView(r).diagnostics,r.source.text);
    assert.match(g.title,title); assert.ok(g.quotes.length); assert.ok(g.check);
  }
});
test('unknown diagnostics and missing locations remain honest, all errors are retained',()=>{
  const ds=[{code:'new_error',message:'unknown',hint:'',severity:'error',canLocate:false,line:99},
    {code:'warning',message:'warning',hint:'',severity:'warning',canLocate:false}];
  const gs=documentGuide(evidence,ds,'');
  assert.equal(gs.length,1); assert.equal(gs[0].line,null); assert.equal(gs[0].meaning,'unknown');
  assert.equal(gs[0].check,''); assert.deepEqual(gs[0].quotes,[]);
});
test('Markdown reader creates only text nodes and code blocks, never executable HTML or links',()=>{
  const doc={createElement(tag){return {tag,textContent:'',children:[],append(...xs){this.children.push(...xs);}};}};
  const root=doc.createElement('div');
  appendDocumentText(root,'# Heading\n<!-- compile -->\n**rule** with `String`\n<script>alert(1)</script>\n```cangjie\nlet x = "<img>"\n```\n[link](javascript:alert(1))',doc);
  const tags=[]; const walk=n=>{tags.push(n.tag);n.children.forEach(walk);};walk(root);
  assert.ok(tags.includes('strong'));assert.ok(tags.includes('code'));
  assert.ok(!tags.includes('script'));assert.ok(!tags.includes('a'));assert.ok(!tags.includes('img'));
  assert.ok(!JSON.stringify(root).includes('compile -->'));
  assert.ok(JSON.stringify(root).includes('<script>'));
});
