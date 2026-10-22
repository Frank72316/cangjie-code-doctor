# 同版本官方文档快照

核验日期：2026-10-22（北京时间）。本页记录实际文档来源和可复现的摘录方式，不代表完成了修复实验或证明了检索效果。

## 版本与来源

- SDK 基线：**1.0.5**。
- 原始作者及仓库：仓颉官方文档仓库 [cangjielanguage/cangjie_docs](https://github.com/cangjielanguage/cangjie_docs)。官方组织将 GitHub 仓库标为镜像；未使用第三方教程、模型改写文档或滚动的 `main` 分支。
- 官方版本标签：[v1.0.5](https://github.com/cangjielanguage/cangjie_docs/releases/tag/v1.0.5)。实际执行 `git ls-remote --tags` 并克隆该标签，核实它指向 `f8f8cd75a336e23785a4c57bd6091b2adf1e0302`。
- 固定上游提交：[f8f8cd75a336e23785a4c57bd6091b2adf1e0302](https://github.com/cangjielanguage/cangjie_docs/commit/f8f8cd75a336e23785a4c57bd6091b2adf1e0302)，上游提交时间 `2025-12-10T18:03:38+08:00`。该时间是上游文档修订时间，不是本项目开发或上传时间。
- 官网的 [1.0.5 发布说明](https://docs.cangjie-lang.cn/docs/1.0.5/)同时明确标注版本 `1.0.5`。在线阅读入口在清单中保留；实际摘录以固定提交的 Markdown 为准，避免官网以后更新影响本地复现。
- 本地快照 ID：`cangjie-1.0.5-f8f8cd75a336-zh-cn-core-01`。

## 文件、许可与归属

| 文件 | 作用 |
| --- | --- |
| [`data/docs/cangjie-1.0.5.json`](../data/docs/cangjie-1.0.5.json) | 15 个文档片段，UTF-8、LF、25,949 字节；每段最多 1,909 个 JavaScript 字符单元 |
| [`data/docs/manifest.json`](../data/docs/manifest.json) | 版本、上游提交、核验时间、完整源文件 SHA-256、片段 SHA-256、原文行号和快照 SHA-256 |
| [`data/docs/LICENSE-CC-BY-4.0.txt`](../data/docs/LICENSE-CC-BY-4.0.txt) | 固定提交中的许可证原文 |
| [`data/docs/COPYRIGHT.txt`](../data/docs/COPYRIGHT.txt) | 固定提交中的版权声明原文 |
| [`data/docs/build-snapshot.mjs`](../data/docs/build-snapshot.mjs) | 从已克隆的固定官方提交重新生成同一快照；不联网、不读取案例或测试 |

原文版权声明：Copyright (c) Huawei Technologies Co., Ltd. 2025. All rights reserved.

上游文档以 [Creative Commons Attribution 4.0 International（CC BY 4.0）](https://creativecommons.org/licenses/by/4.0/)许可发布，依据为固定提交下的 [LICENSE](https://github.com/cangjielanguage/cangjie_docs/blob/f8f8cd75a336e23785a4c57bd6091b2adf1e0302/LICENSE)。本项目保留作者、许可、原文链接和修改说明；引用不意味着上游作者认可或担保本工具。

处理方式仅为选择连续段落、裁去片段首尾空白、将换行规范为 LF，并封装为 JSON；未翻译或改写正文。Markdown 标记、原文代码示例和相对链接保持原样。片段的 `title`、`section` 用于导航，其中“拥有默认值的命名参数”是从原文段首提取的定位说明，不是新增语言规则。每段的 `url` 指向上游固定提交及精确行号，可以回看完整上下文。

快照 SHA-256：

```text
aea5e1dd984f73f607a41555ac590ffc4d1ce6627149b660f03fd449c40325c2
```

该哈希识别本次确定的字节内容，不是数字签名；更新正文或分块规则后必须生成新的快照标识及清单。

## 当前覆盖与边界

当前片段覆盖变量初始化及类型一致性、不可变变量、标识符、作用域、整数类型及字面量、字符串字面量、函数定义与参数、调用与命名参数默认值、返回类型、局部变量作用域、数值转换及 `Unit`。这是用于接通文档依据展示的小型语料快照，不能声称覆盖整个语言或所有编译错误。

片段中保留的例子是上游官方教学示例，不是本项目的评测案例。构建脚本仅读取明列的官方文档和许可，不读取 `cases/`、测试、保留测试或运行产物。文档快照固定也不等于 A/B 案例集已经冻结；今后开展实验时仍需分别冻结案例、提示词、模型参数和文档检索配置。

目前选择了与待支持错误领域相关的文档章节，因此不能将“这些章节可被检索出来”当作独立评测结果。检索是否提高修复成功率仍需后续受控实验。不同 SDK 版本应另建快照，不得把本快照重新标成其他版本。

## 复现与检查

在项目根目录执行（临时克隆位于已忽略的 `tmp/`）：

```powershell
git clone --depth 1 --branch v1.0.5 https://github.com/cangjielanguage/cangjie_docs.git tmp/upstream-docs-1.0.5
node data/docs/build-snapshot.mjs tmp/upstream-docs-1.0.5
Get-FileHash data/docs/cangjie-1.0.5.json -Algorithm SHA256
```

已有临时克隆时跳过 `git clone`。也可把另一处官方克隆的绝对路径作为构建脚本参数。脚本核实 `v1.0.5` 对应的提交必须精确一致，再用 `git show <commit>:<path>` 读取原始 Git 字节，避免工作目录自动换行干扰源文件哈希。

脚本会拒绝缺失的摘录边界、非原文片段、超过 2,500 字符的单段，以及超过 256 KiB 的语料文件。它输出实际文档数、大小和哈希。清单中 `sourceVerifiedAt` 记录本次核验时间，重建固定快照不会伪造新的采集时间。真正重新核验或升级版本时，应记录当次事实并生成新快照，而不是修改旧记录的时间。

本轮实际检查：从固定官方提交生成了 15 段；所有摘录均为该提交源文件的连续原文；标题、URL、段 ID 无缺失，ID 无重复；重复构建的语料及清单哈希一致。生成文件不包含密钥、用户代码或保留测试。
