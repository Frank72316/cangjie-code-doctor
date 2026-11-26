import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,verifyPack,summarize,plan,SCOPE} from './pilot-common.mjs';
import {verificationRequestText} from '../web/process-evidence.mjs';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('Usage: node scripts/pilot-report.mjs <downloaded-results-directory> <new-report-directory>');
const read=name=>readFile(resolve(directory,name+'.json'),'utf8').then(JSON.parse);
const [freeze,pack,result,referenceChecks]=await Promise.all(['freeze','candidates','results','reference-checks'].map(read));
verifyPack(pack,freeze);
if(!result.complete||result.scope!==SCOPE||result.freezeSha256!==sha(freeze)||result.rows.length!==20||sha(result.rows.map(r=>r.caseId))!==sha(freeze.cases.map(c=>c.id))||sha(result.summary)!==sha(summarize(result.rows)))throw Error('Incomplete or inconsistent result');
if(referenceChecks.length!==20||referenceChecks.some(r=>r.publicStatus!=='passed'||r.holdoutStatus!=='passed')||referenceChecks.filter(r=>r.originalLogicDefectDetected).length!==4)throw Error('Missing reference validation');
const reportHashes={};
for(const row of result.rows){
 const c=freeze.cases.find(c=>c.id===row.caseId);
 for(const arm of (row.category==='correct'?['regression']:['A','B'])){
  const score=row[arm];
  if(!score)throw Error('Missing arm');
  const generated=arm==='regression'?null:pack.results.find(r=>r.caseId===c.id&&r.group===arm);
  if(generated&&generated.status!=='generated'){if(score.status!==generated.status)throw Error('Missing generation incorrectly scored');continue;}
  for(const kind of ['public','holdout']){
   if(kind==='holdout'&&!score.holdoutReportId)continue;
   const name=`${c.id}-${arm}-${kind}`,raw=await readFile(resolve(directory,name+'.json'),'utf8'),report=JSON.parse(raw);
   reportHashes[name]=sha(raw);
   if(report.image!==freeze.image||report.id!==(kind==='public'?score.reportId:score.holdoutReportId)||report.status!==score[kind+'Status']||!report.containers.length||report.containers.some(x=>!x.cleanup?.removed))throw Error('Score/report mismatch');
   if(kind==='public'&&report.source.sha256!==sha(generated?generated.code:c.source.text))throw Error('Scored source mismatch');
   if(kind==='public'&&report.requestSha256!==sha(verificationRequestText({name:c.source.name,text:generated?generated.code:c.source.text},c.publicTests)))throw Error('Public tests changed');
   if(sha(report.source.text)!==report.source.sha256)throw Error('Report source corruption');
  }
  const expected=score.publicStatus==='passed'?(score.holdoutStatus==='passed'?'passed':'holdout_failed'):score.publicStatus;
  if(score.status!==expected)throw Error('Incorrect final verdict');
 }
}
const byArm={};for(const arm of ['A','B']){
 const jobs=pack.results.filter(r=>r.group===arm),scores=result.rows.filter(r=>r.category!=='correct').map(r=>r[arm]);
 byArm[arm]={calls:jobs.filter(r=>r.reservationCNY!=null).length,inputTokens:jobs.reduce((n,r)=>n+(r.usage?.prompt_tokens??0),0),outputTokens:jobs.reduce((n,r)=>n+(r.usage?.completion_tokens??0),0),missingUsage:jobs.filter(r=>r.reservationCNY!=null&&!r.usage).length,estimatedPeakCNY:jobs.reduce((n,r)=>n+(r.estimatedPeakCNY??r.reservationCNY??0),0),generated:jobs.filter(r=>r.status==='generated').length,compiled:scores.filter(r=>r.compile==='compile_passed').length,publicPassed:scores.filter(r=>r.publicStatus==='passed').length,allPassed:scores.filter(r=>r.status==='passed').length};
}
const categories=['syntax','type','scope-or-api','logic'].map(category=>({category,...summarize(result.rows.filter(r=>r.category===category))}));
const summary={kind:'doctor-pilot-results',scope:SCOPE,freezeSha256:sha(freeze),holdoutSha256:freeze.holdoutSha256,candidatePackSha256:sha(pack),startedAt:pack.startedAt,generatedAt:pack.finishedAt,finishedAt:result.finishedAt,toolCommit:freeze.commit,image:freeze.image,byArm,summary:result.summary,categories,rows:result.rows,reportHashes,referenceChecks};
await mkdir(output);await writeFile(resolve(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');
const s=result.summary,status=x=>x==='passed'?'通过':x??'未运行';
const lines=['# 首轮 A/B 实验结果','',`生成时间：${pack.startedAt} 至 ${pack.finishedAt}（UTC）。验证完成：${result.finishedAt}。`,'',`**A：${s.A}/16；B：${s.B}/16；B−A：${s.differencePoints} 个百分点。** 成功要求编译、公开测试、冻结保留测试全部通过。`,
'',s.B===s.A?'本轮未观察到加入文档后的通过率提升。':s.B>s.A?'本轮观察到 B 通过数较高，但仅限本案例集和单次采样。':'本轮 B 通过数较低，完整保留不利结果。','',
`配对结果：两组均成功 ${s.paired.both}；仅 A 成功 ${s.paired.onlyA}；仅 B 成功 ${s.paired.onlyB}；均失败 ${s.paired.neither}。正确程序回归 ${s.regression.passed}/${s.regression.total}，不计修复率分母。`,
'','## 调用与费用','', '| 项目 | A（不提供文档） | B（提供文档） |','| --- | ---: | ---: |',
...Object.entries({calls:'调用次数',generated:'有效候选',compiled:'编译通过',publicPassed:'公开测试通过',allPassed:'公开及保留全过',inputTokens:'输入 tokens',outputTokens:'输出 tokens',missingUsage:'用量缺失次数',estimatedPeakCNY:'按高峰非缓存单价估算上界/元'}).map(([k,label])=>`| ${label} | ${k==='estimatedPeakCNY'?byArm.A[k].toFixed(6):byArm.A[k]} | ${k==='estimatedPeakCNY'?byArm.B[k].toFixed(6):byArm.B[k]} |`),
'',`费用估算合计 ${pack.reservedOrEstimatedCNY.toFixed(6)} 元，预算上限20元；不是服务商账单实扣。无自动重试。模型返回标识：${[...new Set(pack.results.map(r=>r.responseModel).filter(Boolean))].join('、')}。`,
'','## 每例结果','', '| 案例 | A公开 | A保留 | A最终 | B公开 | B保留 | B最终 |','| --- | --- | --- | --- | --- | --- | --- |',
...result.rows.filter(r=>r.category!=='correct').map(r=>`| ${r.caseId} | ${status(r.A.publicStatus)} | ${status(r.A.holdoutStatus)} | ${status(r.A.status)} | ${status(r.B.publicStatus)} | ${status(r.B.holdoutStatus)} | ${status(r.B.status)} |`),
'','## 分类结果','', '| 类别 | A | B |','| --- | ---: | ---: |',...categories.map(c=>`| ${c.category} | ${c.A}/${c.denominator} | ${c.B}/${c.denominator} |`),
'','## 证据与边界','',
'- 20例参考实现均在公开及保留测试通过，112次保留调用/断言；4个原始逻辑缺陷均被保留测试捕获。7题先改为参数化新版本，旧案例未覆盖改写。',
'- 全部候选锁定后才运行保留评分，没有以隐藏结果再次调用模型或人工修补候选。正确案例只检查原程序，不让模型改写。',
'- 16个配对案例、单轮请求不支持普遍有效性或稳定优势；32次调用不是32个独立案例。每变化1例即6.25个百分点。',
'- 测试由Codex辅助编写，未完成两名成员交叉复核或学生试用；小型自建案例与有限官方快照可能限制外推。Bool用例两种输入均已公开，保留测试只改变调用顺序。',
'- 通过测试不等于证明所有输入正确。候选题意/硬编码复核另见后续分析；自动计分口径保持冻结。',
`- 工具提交：${freeze.commit}；输入摘要：${sha(freeze)}；保留材料承诺：${freeze.holdoutSha256}；候选包摘要：${sha(pack)}。`,
'','[预登记协议](../../pilot-protocol.md)；原始评分摘要与逐报告SHA-256见同目录summary.json。',''];
await writeFile(resolve(output,'report.md'),lines.join('\n'));
console.log(JSON.stringify({summary:s,byArm,verifiedReports:Object.keys(reportHashes).length}));
