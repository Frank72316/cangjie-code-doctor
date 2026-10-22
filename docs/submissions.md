# 提交与同步记录

建立日期：2026-10-22。以下显示时间统一为北京时间（UTC+08:00）。本文件与[开发进度](progress.md)共同保存过程：这里索引提交和平台记录，进度文件说明具体实现、检查结果、问题及下一步。

## 时间怎么核对

- **Git 提交时间**：来自提交对象的 committer date，能定位一次代码或文档改动；不是服务器上传时间。作者时间、提交者时间和本地文件修改时间不能相互替代。
- **GitHub 平台记录时间**：下表来自 Actions API 的 `created_at`，且已核对 `event=push` 与对应 `head_sha`。它能佐证该版本在那个时间已到达 GitHub，是工作流创建时间，不是精确推送完成时间。
- **GitCode 同步确认**：以 `git ls-remote origin refs/heads/main` 与本地 SHA 的核对结果为准。核对时间只能说明当时远端已经包含该版本，不能反推历史上传时间。历史服务器接收时间未留存的，明确标为未核实。
- 老师可打开提交详情查看改动、父提交与时间，再打开平台运行链接查看实际检查记录。平台显示时区可能不同，对照时应换算；GitHub API 中的 `Z` 表示 UTC。

## 历史提交索引

本表于 2026-10-22 依据真实 Git 历史和 GitHub API 补录，并在后续实际工作中追加，不表示这些文字在过去相应日期就已编写。未修改历史提交日期或内容。表内 9 次有链接的 CI 均为 push 触发且已通过；其余条目没有取得单独的平台工作流时间。

| Git 提交时间 | 提交与改动 | GitHub 工作流创建时间及检查记录 |
| --- | --- | --- |
| 2026-10-07 14:44:03 | [d7a90f5](https://github.com/Frank72316/cangjie-code-doctor/commit/d7a90f55e0321363666beda2aecf1c4958f95a39)：初始化项目说明 | 未留存独立 CI 时间 |
| 2026-10-07 15:22:43 | [7850061](https://github.com/Frank72316/cangjie-code-doctor/commit/785006111a2df8eaeb85eda638742763b64b0650)：说明 GitHub / AtomGit 同步方式 | 未留存独立 CI 时间 |
| 2026-10-07 21:04:31 | [2cd6914](https://github.com/Frank72316/cangjie-code-doctor/commit/2cd69144d15c395b4d8b3efd1f3d1378d48de5e7)：确定主协作仓库 | 未留存独立 CI 时间 |
| 2026-10-21 09:16:28 | [f72a477](https://github.com/Frank72316/cangjie-code-doctor/commit/f72a477619177e596619bd0b09f877db67dfcd64)：根据教师意见修订开题和实验计划 | 未留存独立 CI 时间 |
| 2026-10-21 10:19:49 | [0def5a6](https://github.com/Frank72316/cangjie-code-doctor/commit/0def5a62af8ab431134b7de5d74a6e6942190e1f)：诊断核心及记录预览初版 | 未留存独立 CI 时间 |
| 2026-10-21 10:26:04 | [8ab8dc6](https://github.com/Frank72316/cangjie-code-doctor/commit/8ab8dc63a6dd64210549f17dec5d4231bb68b70f)：固定 Linux SDK 的自动检查 | [2026-10-21 10:26:14](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39533002512) |
| 2026-10-21 10:31:28 | [d8fb09d](https://github.com/Frank72316/cangjie-code-doctor/commit/d8fb09dddea909f8a1c3a8d315fda9996f57ccbd)：原生核心编译审核样例 | [2026-10-21 10:34:29](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39533771991) |
| 2026-10-21 10:39:43 | [d64b80d](https://github.com/Frank72316/cangjie-code-doctor/commit/d64b80d166ee7bb754bc396fd94d45fee96d713d)：界面接入原生编译和历史 | [2026-10-21 10:39:49](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39534258780) |
| 2026-10-21 10:54:08 | [9efacbb](https://github.com/Frank72316/cangjie-code-doctor/commit/9efacbbceb55bd9e3a0d911efc68841fca93b28a)：记录集成验证及局限 | [2026-10-21 10:54:26](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39535607559) |
| 2026-10-21 11:07:06 | [882a53d](https://github.com/Frank72316/cangjie-code-doctor/commit/882a53d213973108b0317507b196511568b1c970)：失败、取消和中断任务留档 | [2026-10-21 11:07:11](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39536799153) |
| 2026-10-21 11:16:17 | [89c030c](https://github.com/Frank72316/cangjie-code-doctor/commit/89c030c9be4a5f1238ca17d1511980ac6645c68d)：防止不确定结果误标成功 | 同批推送内未取得独立工作流；下一条检查覆盖其后续版本 |
| 2026-10-21 11:16:59 | [9b1d435](https://github.com/Frank72316/cangjie-code-doctor/commit/9b1d4356b945927457b425320fa9e7cef82bc712)：生命周期与浏览器验收记录 | [2026-10-21 11:17:11](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39537730607) |
| 2026-10-22 16:31:00 | [6b898f6](https://github.com/Frank72316/cangjie-code-doctor/commit/6b898f6ba7a11e4b032b21deafe54682e0f16a69)：工作台设计和响应式布局 | [2026-10-22 16:31:09](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39748335010) |
| 2026-10-22 19:51:19 | [27af77f](https://github.com/Frank72316/cangjie-code-doctor/commit/27af77fb412427d4399e4afbf12d5d9d983a791a)：Windows 恢复后的中文目录兼容修复 | [2026-10-22 19:51:28](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39773742071) |
| 2026-10-22 20:00:22 | [6337adc](https://github.com/Frank72316/cangjie-code-doctor/commit/6337adc63ae7a752b0737ba00fd4c083cdc5ee49)：建立提交同步日志、仓库过程约定及 CI 提交身份摘要 | [2026-10-22 20:00:31](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39774893217)；检查成功 |

截至首次建档前，已通过远端分支查询确认 GitCode 和 GitHub 的 `main` 均为 `27af77fb412427d4399e4afbf12d5d9d983a791a`，当时的 14 个提交均包含于两边历史。GitCode 各历史版本的服务器接收时间未核实，不套用 GitHub 的时间。

后续补记（2026-10-22）：过程记录机制提交 `6337adc63ae7a752b0737ba00fd4c083cdc5ee49` 已确认包含于 GitCode、GitHub 两端，核对时两边 `main` SHA 相同。上表的 `20:00:22` 是 Git 提交者时间，`20:00:31` 是 GitHub 工作流创建时间，均不是精确上传完成时间；未留存两平台服务器收到该次推送的准确时刻。

## 本次建立记录机制（2026-10-22）

- 工作：建立本表、仓库协作约定与 CI 提交身份摘要；入口加入 README，开发进度同步更新。
- 版本定位：包含本节的提交；完整 SHA 和检查结果由该次 GitHub Actions 的“Record submission identity”步骤自动记录，后续一轮工作再补齐本表索引。
- CI 摘要会标明提交 SHA、Git 提交者时间、触发方式、运行次数、运行器记录时间及链接。摘要的生成不等于全部测试通过，需一并查看整体运行结果。
- 本地检查：已实际执行摘要生成脚本的本地演练，核对 14 个历史提交链接均对应存在的提交对象，`git diff --check` 通过；本地演练标为 `local-validation-only`，未当作平台上传证据。
- 同步：按正常流程分别推送两平台并核对远端 SHA，本轮具体结果在交付回复中报告。若失败，后续补记失败及恢复过程。

## 本轮离线文档依据（2026-10-22，提交前记录）

- 目标与改动：按“先完成离线功能”接通仓颉原生 BM25、SDK 1.0.5 官方文档固定快照、引用核对、HTTP 检索、证据保存与导出界面；补记上一轮 `6337adc` 的提交和平台记录。
- 实际实现及协作：本轮由 Codex 辅助完成代码、来源核验、检查与文档更新，尚未记录队员个人评审；计划中的团队分工不能直接记为已完成的个人贡献。
- 本地检查：原生自检和夹具、四份真实编译及改源拒绝、编译 HTTP、三个公开开发诊断的离线检索、重复排序、无命中、版本不符拒绝通过；`node --test tests/*.test.mjs` 为 42 项通过。官方语料和来源清单重复重建一致。
- 新增界面实际验收：用户确认外部浏览器能打开；自动化预览停在旧连接失败页，被浏览器协议策略拦截，交互和响应式验收待补。本轮发布后的 CI：待提交后核验。本地通过不替代平台当前提交的检查结果。
- 提交与同步：本节随实际离线实现提交；提交时间、最终 SHA、两平台远端核对和对应 CI 尚待发生后登记，当前不声明已经上传或同步。
- 限制与下一步：15 段原文属于小型开发语料，三个报错来自公开开发样例；没有生成修复或使用保留测试，不计修复成功率或正式 A/B。先补齐离线操作与证据验收，再继续隔离和确认修改流程；模型服务及预算未选定。

## 后续每轮登记内容

每个实际完成阶段及时提交，不等期末集中上传。每轮留下以下信息：

| 字段 | 要求 |
| --- | --- |
| 日期、目标、实际负责人 | 按实际工作填写，不直接把计划分工当作完成贡献 |
| 本轮改动 | 对应可查看的文件与提交，说明用户或实验上的实际变化 |
| 实际检查 | 命令或操作、结果、CI 链接；失败与限制也保留 |
| 提交与同步 | 完整 SHA、两平台确认状态；明确各类时间的来源 |
| 问题及下一步 | 未完成项、试用反馈、后续修复或验证计划 |

当前同版本离线文档检索已实现基础链路，新增界面验收、Linux 隔离、模型接入、确认修改、行为测试与 A/B 仍应按[进度文件](progress.md)的里程碑逐步实现并验收。进展以实际成果和证据判断，不按提交次数判断；没有实质改动的日子不制造提交。

本机制不建立定时上传任务，也不改变历史日期。平台日志可能受保留期限和删除操作影响；课程检查前应导出所需过程材料，并保留提交 SHA 与来源说明。

参考：[GitHub 工作流上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)、[CI 运行摘要](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#adding-a-job-summary)。
