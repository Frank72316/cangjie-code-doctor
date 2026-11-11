# 案例准备与变更检查

此入口落实开题计划中的案例登记和冻结前核对，只处理公开材料，不编译、不运行程序、不调用模型，也不读取参考实现或保留测试。当前登记的四例均来自原有开发样例；本轮补充的题意与公开测试是练习约定，尚未完成两人交叉复核和独立行为验证，不是正式评估数据。

## 使用方法

在项目根目录运行，使用项目现有 Node.js 环境，无需 API 密钥或仓颉运行时：

```powershell
node scripts/check-cases.mjs
node scripts/check-cases.mjs --json
node scripts/check-cases.mjs --require-complete
```

默认命令检查文件、字段、划分与摘要，列出缺口；清单合法但尚未准备齐全时仍返回0，便于逐步登记。`--require-complete` 在登记不完整时返回2，可在后续冻结前作为一道检查。无论是否齐全，结果中的 `experimentFrozen` 都为 `false`，正式冻结仍需独立验收。

报告给出开发集10例、评估集20例的目标与实际数量，评估集的语法、类型、作用域或接口误用、逻辑错误及正确程序分别以4例为目标。多于或少于计划数都会列出，不静默截取或改分母。

可将 JSON 结果存为本地基线，再检查后来是否发生变化。以下 PowerShell 命令以新的文件名保存，已有文件时拒绝覆盖：

```powershell
New-Item -ItemType Directory -Path runs/case-preparation -Force | Out-Null
$caseSnapshot = node scripts/check-cases.mjs --json
if ($LASTEXITCODE -ne 0) { throw '案例检查失败，未保存基线' }
$caseSnapshot | Out-File -LiteralPath runs/case-preparation/before-review.json -Encoding utf8 -NoClobber
node scripts/check-cases.mjs --baseline runs/case-preparation/before-review.json
```

`--baseline` 列出新增、移除、变更案例及顺序变化。题意、测试、来源、复核登记、源码摘要或案例顺序的变化都进入整体摘要；JSON空白和对象键顺序不影响摘要。变化时退出3，即使同时存在登记缺口也优先返回3；损坏材料、非法参数、越界路径或无法读取的文件退出1。程序只向标准输出写报告，不自动改写清单、源码或基线。

## 登记规则

默认清单为 [`data/cases/catalog.json`](../data/cases/catalog.json)。可通过 `--catalog data/cases/other.json` 检查同目录下另一个公开清单。所有清单都必须以 `doctor-public-case-catalog`、schemaVersion 1 和 SDK 1.0.5 声明身份，字段严格校验，未识别字段拒绝接受。

| 字段 | 内容及要求 |
| --- | --- |
| `id`、`familyId` | 小写字母开头的字母数字、下划线或短横线，最长64字符。ID唯一，同一原题和变体使用相同familyId |
| `split` | `development` 或 `evaluation`，同源题目及相同源码字节不能跨划分 |
| `category` | `syntax`、`type`、`scope-or-api`、`logic`、`correct` |
| `title`、`task` | 简明标题和明确的题意、输入输出约定，不放个人信息或未获准公开的题目 |
| `sourcePath` | 仅允许 `examples/` 或 `data/cases/sources/` 下的单个 `.cj` 文件，不接受子目录、绝对路径、链接或目录跳转 |
| `sourceSha256` | 原始UTF-8源码字节的SHA-256，最大64 KiB、200行，改动后须复核再更新摘要 |
| `initialExpectation` | 前三类为 `compile-error`；逻辑错误为 `fails-public-tests`；正确案例为 `passes-public-tests`。只是预期，不代表检查器已实测 |
| `origin` | `kind` 为 `project-example`、`student` 或 `adapted`；`reference` 登记来源；`permission` 为 `project-owned`、`permission-pending` 或 `authorized`。自有材料标识只用于自建案例 |
| `publicTests` | 公开的 `id`、`stdin`、`expectedStdout`。复用现有公开验证格式，最多8条，单条输入4 KiB、输出16 KiB。同一输入不能对应不同预期输出 |
| `review.reviewers` | 实际参与复核者，至少两人，不代填、重复填或把计划分工当作已复核 |
| `review.referenceSha256` | 独立参考实现摘要，未复核填 `null` |
| `review.initialEvidenceSha256` | 证明原程序行为与预期相符的实际记录摘要，未验证填 `null` |
| `review.holdoutCommitmentSha256` | 评估案例独立保留测试材料的承诺摘要，未准备填 `null`；禁止把内容、答案或私有路径写进公开清单 |

允许空测试和待确认复核项作为草稿保存，但报告会将其列为缺口。第三方来源授权待确认也阻止 `metadataComplete` 成立。只登记摘要不等于已经验证文件内容或授权，复核人及摘要对应的真实证据仍由团队检查；不要为使检查变绿填入虚构信息。

## 效力与后续工作

- 报告仅含案例编号、数量、缺口和摘要，不包含源码、题意、公开测试正文或复核人姓名。它仍不是签名或可信时间戳，基线应与版本控制及真实记录一起保管。
- 检查器能阻止已登记的同源题目跨划分，以及相同源码字节跨划分。它不能自动识别改名、改空白或语义相同的题目，仍须人工确定familyId，检查重复题与数据污染。
- 检查器不解析仓颉语法，不证明代码只使用标准库、不含危险操作或行为正确。任何实际编译和测试仍按既有审核样例与Linux容器边界执行。
- 清单读取有体积、数量、类型与链接检查，但本地离线文件核对不构成恶意并发写入环境的安全隔离。准备期间应停止修改待核对材料。
- `metadataComplete` 只说明本清单的数量及登记项齐全。正式实验还须确认模型与预算、固定文档和提示配置、工具验收、保留测试隔离、候选锁定与判定入口。
- `runs/case-preparation/` 继续被Git忽略；本轮不解封、不上传或读取 `data/holdout/`。冻结后新案例应另建清单单独汇总，不改原实验分母。

下一阶段按上述结构补齐开发案例、征集获授权的真实错误，独立复核题意和测试，再实现受控实验配置登记。正式实验不得使用这里的合成契约测试数据充数。
