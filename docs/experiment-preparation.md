# 实验配置登记与变更检查

这个离线入口回答“正式 A/B 还缺哪些登记”和“上次核对后哪些材料变了”。它把模型配置、预算、环境、案例、同版本文档和提示模板关联成可比对摘要，服务开题方案第六周的冻结准备。它不运行模型或仓颉程序，不读取保留测试，也不签发冻结证明。

## 运行检查

在项目根目录使用现有 Node.js，无需密钥、Docker 或可运行的仓颉 SDK：

```powershell
node scripts/check-experiment.mjs
node scripts/check-experiment.mjs --json
node scripts/check-experiment.mjs --require-complete
```

默认读取 `data/experiments/config.json`，列出缺少的模型、预算、模板、环境证据和案例复核材料。草稿中未确定的内容保留 `null`，不擅自选择服务或伪造验收证据。开发案例仍为4/10，评估案例为0/20；此功能不增加案例或实验成绩。

| 退出码 | 含义 |
| --- | --- |
| 0 | 配置和所引用材料合法；默认允许存在待办 |
| 1 | 参数、配置、文件、摘要或基线无效 |
| 2 | 加了 `--require-complete`，但登记仍不齐全 |
| 3 | 与 `--baseline` 的材料不同，优先于缺项退出2 |

`metadataComplete` 只表示登记项齐全。`experimentFrozen` 和 `executionAuthorized` 始终为 `false`。即使退出0，也不能直接启动正式实验；本入口没有运行或付费能力。

## 怎么填写配置

| 字段 | 登记内容 |
| --- | --- |
| `sharedModel` | 两组共用的服务名、具体模型标识、temperature、topP、输出token上限和seed。除seed可因服务不支持而保留null，其余缺少均列待办；须另行验证服务是否实际支持这些参数 |
| `budget` | CNY或USD及正数费用上限。只是计划预算登记，不是运行时计费或扣费限制 |
| `environment` | 固定Linux Docker平台、不可变镜像ID、完整40位工具提交、工具验收和保留测试隔离证据的SHA-256。检查格式，不读取或证明这些证据真实、对应、有效 |
| `templates.sharedPrompt` | 两组共用的公开提示骨架，登记path和原始UTF-8文件字节的sha256；实际B组注入文档的适配器待实现 |
| `templates.publicFeedback` | 两组共用的公开反馈模板，登记方式同上 |
| `retrieval` | 与当前实现一致的BM25参数、topK=3、分词与查询扩展版本，不允许只改登记却不改实现 |
| `protocol` | 本版开题约定：A无文档、B加文档、最多两轮、交替先后、固定初次检索、仅自身公开反馈、最近有效候选、服务故障整对重跑最多一次、全候选锁定后独立保留测试 |

模型温度允许0至2，topP大于0且不超过1，输出上限为1至131072的整数；这些是登记范围，不保证某个服务支持全部取值。服务确定后须核对实际能力，无法支持的参数需统一调整协议和适配实现，不得两组各自改变。

提示文件只允许 `data/experiments/prompts/` 下的单层 `.txt`，最多32 KiB，拒绝空内容、无效UTF-8、空字符、链接或摘要不符。配置文件最多32 KiB；未知字段拒绝，不能加入第二套组别参数、API密钥或私有路径。不要把密钥填入服务名等文本字段；格式检查不能识别所有秘密。配置准备期间停止修改所引用文件。

两组共用配置可减少误配，但不能证明实验公平。提示骨架及反馈模板的语义、文档之外是否存在额外提示、是否混入答案，仍由成员复核。禁止将保留测试复制到公开模板或案例中；本检查不会自动识别语义泄露。

固定协议登记16个错误案例、4个正确回归案例，主实验计划最多64次生成，故障重跑另计。正确案例单独检查，默认不调用模型，不进入修复率分母。这些字段约束计划，不表示批量调度、费用控制或保留测试入口已实现。

## 保存基线并检查变化

先检查成功，再保存到被Git忽略的本地目录。以下命令拒绝覆盖同名文件：

```powershell
New-Item -ItemType Directory -Path runs/experiment-preparation -Force | Out-Null
$experimentSnapshot = node scripts/check-experiment.mjs --json
if ($LASTEXITCODE -ne 0) { throw '检查失败，未保存基线' }
$experimentSnapshot | Out-File -LiteralPath runs/experiment-preparation/before-review.json -Encoding utf8 -NoClobber
node scripts/check-experiment.mjs --baseline runs/experiment-preparation/before-review.json
```

报告分别比对四部分：

- `config`：配置内容，包括模型、预算、环境声明、协议及模板引用；JSON缩进和对象键顺序不影响摘要。
- `cases`：完整公开案例登记及顺序，源码另按登记摘要核验。详细逐例变化继续使用 `check-cases.mjs --baseline`。
- `documents`：固定官方文档清单和语料的原始字节摘要，清单格式改变也会显示变化；语料同时通过已有版本、片段和来源检查。
- `templates`：实际模板字节摘要，内容修改后必须复核并更新配置中的摘要，否则直接报错，不生成部分成功报告。

配置与基线可分别通过 `--config data/experiments/other.json`、`--baseline runs/experiment-preparation/other.json` 选择。任意目录、目录跳转、保留测试路径均不接受。基线验证身份和内部摘要一致性；人为重写基线并重新计算摘要仍可能造假，因此它不是数字签名或可信时间戳，须与真实Git提交和原始验收记录一起保存。

## 后续验收

接下来补齐案例及真实复核材料，确定模型、预算和公开模板；核实工具提交、隔离限制和证据，再实现正式冻结、模型适配、批量两轮修复及候选锁定后的独立评估。本配置目前只供准备检查使用，尚未被运行器消费，不会改变现有网页编译、检索或公开验证行为。
