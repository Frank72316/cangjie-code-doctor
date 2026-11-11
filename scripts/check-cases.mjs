import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { checkCaseCatalog, compareCaseSnapshots, readCaseBaseline } from './case-catalog.mjs';

// Resolve the project independently of the caller's current working directory.
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
const usage='用法：node scripts/check-cases.mjs [--json] [--require-complete] [--catalog data/cases/catalog.json] [--baseline runs/case-preparation/before.json]';
try {
  let json=false, complete=false, catalogPath, baseline;
  const seen=new Set();
  for (let i=0;i<args.length;i++) {
    const option=args[i];
    if (seen.has(option)) throw new Error(usage);
    seen.add(option);
    if (option==='--json') json=true;
    else if (option==='--require-complete') complete=true;
    else if (option==='--catalog' || option==='--baseline') {
      const value=args[++i];
      if (!value || value.startsWith('--')) throw new Error(usage);
      if (option==='--catalog') catalogPath=value; else baseline=value;
    } else throw new Error(usage);
  }
  const report=await checkCaseCatalog({root,catalogPath});
  if (baseline) report.comparison=compareCaseSnapshots(await readCaseBaseline(root,baseline),report);
  if (json) console.log(JSON.stringify(report,null,2));
  else {
    console.log('案例准备检查（离线，未执行实验）');
    console.log(`开发案例 ${report.counts.development}/10；评估案例 ${report.counts.evaluation}/20。`);
    console.log(`公开材料摘要：${report.datasetSha256}`);
    console.log(report.metadataComplete ? '登记项齐全，仍须独立验收与冻结。' : '登记尚未齐全，不能据此启动正式实验。');
    for (const gap of report.gaps) console.log(`  ${gap.field}：${gap.actual}/${gap.expected}`);
    for (const item of report.blockers) console.log(`  ${item.caseId}：${item.reasons.join('；')}`);
    if (report.comparison) console.log(`与基线比对：${JSON.stringify(report.comparison)}`);
    for (const line of report.limitations) console.log(line);
  }
  if (complete && !report.metadataComplete) process.exitCode=2;
  if (report.comparison && !report.comparison.unchanged) process.exitCode=3;
} catch (error) {
  console.error(`案例检查失败：${error.message}`);
  process.exitCode=1;
}
