# Challenge-v1 来源与材料状态

2026-11-26：24个评估题+6个独立开发题，三类各8+2；每题两处植入错误。当前为材料验收版本，不是已经证实具有区分度的新模型成绩。旧pilot数据、成绩、提示与官方快照均保留。

| 分层 | 来源 | 使用方式 |
| --- | --- | --- |
| 类/状态及跨方法错误 | [CangjieBench](https://github.com/cjhCoder7/CangjieBench)，提交68ed8f1cd96d5139a10de8da55561dcf7fd82dc3 | 从ClassEval仓颉参考实现适配8评估+2开发题，明确局部输入约定；新植入双故障、新公开与保留测试。源ID、版本、URL、适配说明逐题登记。 |
| 算法和边界错误 | [QuixBugs](https://github.com/jkoppel/QuixBugs) | 参考算法任务族，新写仓颉实现与独立JS测试oracle，加入双故障；不是原始QuixBugs错误或其排行榜成绩。版本逐题登记。 |
| 仓颉类型/API/引用语义 | 本项目自建 | Option、命名参数、引用别名、Unicode码点、集合等；代码与测试由Codex辅助编写。 |

原始CangjieBench包含164个HumanEval与84个ClassEval任务，主要评估代码生成/翻译；此处是改编的修复任务，不等于原benchmark。其公开题及参考答案可能被模型训练见过，不能声称零污染。QuixBugs原始任务以单行缺陷为主，本次双缺陷适配须单列结果，不能与原榜单直接比较。

代码来源附MIT许可原件：[CangjieBench](licenses/CangjieBench-MIT.txt)、[QuixBugs](licenses/QuixBugs-MIT.txt)。原作者版权归原作者；适配、故障、约束和测试不冒称官方。没有复制SWE-bench或DebugBench的题目代码。

参考实现也需验证：开发题BalancedBrackets补上上游空栈访问和重复调用状态清理；Hotel按明确的本地任务约定改为重复预约累加。以上改动先于错误注入和任何模型调用，并逐题登记。所有参考、保留输入、测试oracle构造脚本、单故障版本均封存在holdout.enc.json；解密钥匙及明文在本机data/holdout/challenge-v1/，不提供给生成进程。

材料入口：catalog.json为公开题和公开测试；scripts/verify-challenge-materials.mjs在现有受限Linux容器中验证参考程序公开/保留全过、错误原件失败、两种单故障版本各自被保留测试识别。未通过时修正材料并保留验收记录，不提前收费测试模型。主实验冻结、难度校准及检索证据见随后登记的独立协议。
