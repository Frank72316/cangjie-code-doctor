import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { checkExperimentConfig, compareExperimentSnapshots, readExperimentBaseline } from './experiment-config.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const usage='用法：node scripts/check-experiment.mjs [--json] [--require-complete] [--config data/experiments/config.json] [--baseline runs/experiment-preparation/before.json]';
try {
  const args=process.argv.slice(2),seen=new Set();
  let json=false,complete=false,configPath,baseline;
  for (let i=0;i<args.length;i++) {
    const option=args[i];
    if (seen.has(option)) throw new Error(usage);
    seen.add(option);
    if (option==='--json') json=true;
    else if (option==='--require-complete') complete=true;
    else if (option==='--config' || option==='--baseline') {
      const value=args[++i];
      if (!value || value.startsWith('--')) throw new Error(usage);
      if (option==='--config') configPath=value; else baseline=value;
    } else throw new Error(usage);
  }
  const report=await checkExperimentConfig({root,configPath});
  if (baseline) report.comparison=compareExperimentSnapshots(await readExperimentBaseline(root,baseline),report);
  if (json) console.log(JSON.stringify(report,null,2));
  else {
    console.log('实验准备检查（离线，未冻结、未执行）');
    console.log(`开发案例 ${report.counts.development}/10；评估案例 ${report.counts.evaluation}/20。`);
    console.log('A/B 共用模型和参数；最多两轮；计划生成上限64次，服务故障重跑另计。');
    console.log(`材料摘要：${report.snapshotSha256}`);
    console.log(report.metadataComplete?'登记齐全，仍须独立验收与冻结。':'登记尚未齐全：');
    for (const item of report.blockers) console.log(`  ${item.field}：${item.reason}`);
    for (const gap of report.caseGaps) console.log(`  ${gap.field}：${gap.actual}/${gap.expected}`);
    for (const item of report.caseBlockers) console.log(`  ${item.caseId}：${item.reasons.join('；')}`);
    if (report.comparison) console.log(`与基线比对：${report.comparison.unchanged?'材料一致':report.comparison.changed.join('、')+' 已变化'}`);
    for (const line of report.limitations) console.log(line);
  }
  if (complete && !report.metadataComplete) process.exitCode=2;
  if (report.comparison && !report.comparison.unchanged) process.exitCode=3;
} catch (error) {
  // Do not echo parser input (which might contain mistakenly pasted secrets).
  console.error(`实验准备检查失败：${error.code ? '无法读取材料，请检查路径、权限及文件是否存在。' : error.message}`);
  process.exitCode=1;
}
