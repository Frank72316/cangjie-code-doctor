// Build an offline presentation index from already captured evidence. Never executes candidates.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readEvidenceReview,reviewHTML} from '../web/evidence-review.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/package-midterm.mjs <captured-evidence-directory> <new-output-directory>');
const from=resolve(input),to=resolve(output);
const hash=b=>createHash('sha256').update(b).digest('hex');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const manifestBytes=await readFile(join(from,'manifest.json'));
const manifest=JSON.parse(manifestBytes);
if(manifest.status!=='passed'||manifest.platform!=='linux'||!Array.isArray(manifest.files)||!/^[a-f0-9]{40}$/.test(manifest.commit))throw Error('Expected a completed Linux development capture');
const name='08-outcomes-bundle.json',entry=manifest.files.filter(f=>f.name===name);
if(entry.length!==1)throw Error('Missing or ambiguous bundle manifest entry');
const bundle=await readFile(join(from,name));
if(hash(bundle)!==entry[0].sha256)throw Error('Bundle digest does not match capture manifest');
const review=await readEvidenceReview(bundle.toString('utf8'));
if(review.entries.length!==2)throw Error('Expected exactly two development paths');
const passed=review.entries.find(e=>e.verification?.report?.status==='passed');
const failed=review.entries.find(e=>e.verification?.report?.status==='test_failed');
if(!passed||!failed)throw Error('Expected one passed and one failed public verification');
if(JSON.stringify(passed.verification.tests)!==JSON.stringify(failed.verification.tests))throw Error('The two paths must retain the same public requirement');
if(passed.verification.tests.length!==1||passed.verification.tests[0].expectedStdout!=='3\n'
  ||passed.verification.report.tests[0].process.stdout!=='3\n'||failed.verification.report.tests[0].process.stdout!=='4\n'
  ||!passed.revision.baseRecord.source.text.includes('"three"')
  ||passed.revision.source.text!==passed.revision.baseRecord.source.text.replace('"three"','3')
  ||failed.revision.source.text!==passed.revision.baseRecord.source.text.replace('"three"','4'))throw Error('This presentation requires the reviewed type-mismatch 3/4 demonstration');
const cases=JSON.parse(execFileSync(process.execPath,['scripts/check-cases.mjs','--json'],{encoding:'utf8'}));
const experiment=JSON.parse(execFileSync(process.execPath,['scripts/check-experiment.mjs','--json'],{encoding:'utf8'}));
const packageCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// mkdir without recursive: refuse an existing output directory and never overwrite prior captures.
await mkdir(to);
const files=[];
async function save(name,bytes){await writeFile(join(to,name),bytes,{flag:'wx'});files.push({name,sha256:hash(bytes)});}
await save('public-evidence.json',bundle);
await save('capture-manifest.json',manifestBytes);
await save('passed.html',reviewHTML(passed));await save('failed.html',reviewHTML(failed));
await save('case-readiness.json',JSON.stringify(cases,null,2)+'\n');
await save('experiment-readiness.json',JSON.stringify(experiment,null,2)+'\n');
await save('speaking-notes.md',await readFile('docs/midterm-speaking-notes.md'));
const time=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium',hour12:false}).format(new Date(v));
await save('index.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Doctor · 中期答辩材料</title><style>body{margin:0;background:#eef1e7;color:#26382b;font:16px/1.8 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1080px;margin:auto;padding:40px 24px}h1{font-size:34px;margin:8px 0}h2{font-size:21px;margin:0 0 12px}p{margin:10px 0}small,.muted{color:#5d695c}section{background:#fffef8;border:2px solid #a7b499;padding:24px;margin:22px 0;box-shadow:4px 4px #d1d9c8}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.grid section{margin:0}.tag{display:inline-block;padding:3px 10px;background:#e2edd9;font-size:13px}.bad{background:#f5e8cf}a{color:#315f2c;font-weight:650;text-underline-offset:4px}code{overflow-wrap:anywhere}ol,ul{padding-left:24px}.boundary{border-left:4px solid #ac8548;background:#faf0db;padding:12px 18px}@media(max-width:650px){.grid{grid-template-columns:1fr}main{padding:22px 16px}h1{font-size:27px}}@media print{section{break-inside:avoid;box-shadow:none}body{background:white}}</style><main><small>仓颉课程第14组 · 组长 张宇宸 · 中期答辩材料</small><h1>从报错定位，到修改验证</h1><p>核心问题：加入同版本官方文档检索，是否改变程序修复成功率？</p><p class="boundary">本页回看真实 Linux 开发记录，不在当前电脑执行程序。两个案例为人工预设修改，不是 A/B 对照，也不代表 AI 修复成功率。</p><section><h2>01 · 先说清做什么</h2><p>本组关注“报错 → 文档依据 → 用户确认修改 → 测试验证 → 可追溯报告”。第3组仓颉程序学习助手关注知识点、练习与学习闭环。双方可以共享获授权样本，各自回答不同问题。</p></section><div class="grid"><section><span class="tag">真实公开测试通过</span><h2>02 · 修改后输出符合要求</h2><p>将字符串改为整数 3，编译后输出与公开期望一致。</p><p>结束时间：${esc(time(passed.verification.finishedAt))}</p><a href="passed.html">打开成功路径完整报告 →</a></section><section><span class="tag bad">真实公开测试未通过</span><h2>03 · 能编译，也可能做错</h2><p>另一人工候选改为整数 4；期望保持为 3。编译通过，输出不符，保留失败结论。</p><p>结束时间：${esc(time(failed.verification.finishedAt))}</p><a href="failed.html">打开失败路径完整报告 →</a></section></div><section><h2>04 · 中期结论与后续计划</h2><p><strong>已验收：</strong>开发样例诊断、同版本文档检索、人工修改存档、Linux 容器公开验证、报告回看及内容一致性检查。</p><p><strong>仍待完成：</strong>模型调用与候选生成、案例扩充和交叉复核、保留测试隔离与候选锁定、正式 A/B 和真实学生试用。本机 Windows 运行时故障尚未解决。</p><ol><li>先扩案例、补公开测试与授权，完成交叉复核。</li><li>确定模型与预算，完成两轮候选流程、独立保留测试和冻结。</li><li>同模型同参数进行配对 A/B；如未观察到优势或出现下降，照实报告计数、失败及成本。</li></ol><p>小案例集仅支持探索性结论。工具可用性与检索增益分别评价。</p></section><section><h2>05 · 核对原始材料</h2><p>原运行提交：<code>${esc(manifest.commit)}</code><br>原采集完成：${esc(time(manifest.finishedAt))}（北京时间）</p><p><a href="public-evidence.json">原字节材料包 JSON</a> · <a href="capture-manifest.json">原运行清单</a> · <a href="case-readiness.json">案例准备检查</a> · <a href="experiment-readiness.json">实验配置检查</a></p><p><a href="speaking-notes.md">查看答辩讲稿与追问准备</a></p><small>哈希检查内容是否一致，不是来源数字签名。当前准备检查和历史执行记录分别留存，不改写原来的时间和结论。</small></section></main></html>`);
await save('package-receipt.json',JSON.stringify({kind:'doctor-midterm-offline-package',generatedAt:new Date().toISOString(),packageCommit,packageScriptSha256:hash(await readFile('scripts/package-midterm.mjs')),captureCommit:manifest.commit,captureRunUrl:manifest.ciRunUrl,captureManifestSha256:hash(manifestBytes),developmentOnly:true,files:[...files]},null,2)+'\n');
console.log(JSON.stringify({output:to,files:files.length,captureCommit:manifest.commit}));
