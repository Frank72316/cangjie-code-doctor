# Windows 原生运行与回退验证

更新日期：2026-10-25。本机在用户再次卸载更新后恢复到 `26200.9457`，SDK 1.0.5 的构建、自检、审核样例 HTTP 和文档检索实测通过。以下保留 2026-10-23 再次故障及 STS 失败记录；恢复结论只对应本次环境与检查范围。

## 本次恢复与文档流程复测（2026-10-25）

用户自行卸载 KB5127648，并通过 Microsoft 的 Show or hide updates 工具隐藏该条更新。只读查询确认 Windows 11 25H2 为 `26200.9457`，已安装热修复列表中没有该 KB，CBS 没有待重启标记；Windows Update 的隐藏更新查询返回 `2026-10 安全更新(KB5127648) (26200.9711)`，`IsHidden=true`、`IsInstalled=false`。助手没有代为修改更新设置或重启系统。隐藏结果仅描述这一条更新，不保证后续累计更新的内容或兼容性。

加载原 SDK `D:\Cangjie\envsetup.ps1` 后，`cjc --version`、`cjpm --version` 和已有 Doctor 自检均退出 0。随后对当前源码进行新的实际构建和检查：

| 检查 | 本次结果 |
| --- | --- |
| `scripts/build.ps1 -SdkRoot D:\Cangjie` | 退出 0，重新构建 Doctor |
| `scripts/test-native.ps1 -SdkRoot D:\Cangjie` | 自检及 4 个真实诊断夹具共 5 组通过 |
| `test-native-http.mjs` | 2 条路径通过：真实类型错误编译、故意缺失编译器的失败留档 |
| `test-retrieval.mjs` | 8 组通过：真实引用、确定性排序、无命中、HTTP/版本拒绝，以及新增修订证据保存、跨记录拒绝、未附带与无命中区分、可读报告检查 |
| 工作台浏览器操作 | 真实审核样例编译、文档检索、编辑后附带原诊断依据保存、HTML 下载通过；修改后的源码没有在 Windows 宿主编译或执行 |

日志保存在忽略的 `tmp/native-evidence-{build,contract,http,retrieval}-20261025.log`；早期只读检查回执为 `tmp/native-after-kb5127648-removal-20261025.json`。这些是本机开发验收，不是正式实验成绩。版本变化与故障恢复的关联不能单独证明补丁的具体内部根因，也不能推广至所有机器。STS 1.2.0 本轮没有重测，项目基线仍为 1.0.5；Windows 的公开测试执行入口仍禁用，容器验证须使用已有 Linux 部署。

第十二轮历史补记（2026-10-23）：加载 SDK 环境后原有 `doctor.exe --version` 仍退出 `-1073741819 / 0xC0000005`。当轮网页已增加显式启用的 Linux 修订公开验证和报告入口，但不表示本机 Windows 当时已恢复。该轮没有卸载更新、重启系统或安装 Docker/WSL。此前“网页尚未接入”的叙述保留为当时范围，实现与实际验收见[进度](progress.md)。

## 历史复测：回退后恢复（2026-10-22）

用户自行卸载 KB5127648 并重启后，系统由 Windows 11 25H2 `26200.9711` 变为 `26200.9457`。本次查询确认 KB5127648 不再安装，Windows Update 与 CBS 均无待重启标记。助手未继续卸载更新、修改系统编码或重启电脑。

| 本轮检查 | 结果 |
| --- | --- |
| SDK 1.0.5 的 cjc 与 cjpm 版本命令 | 均退出 0 |
| 新建最小 hello 程序 | 编译退出 0，运行输出预期文字并退出 0 |
| Doctor 重建及基础自检 | 通过 |
| 四份真实诊断夹具解析 | 通过 |
| 四个审核样例实时编译、快照与历史 | 通过；原件不变，产物未执行 |
| HTTP→仓颉→cjc→诊断→历史 | 通过；缺失编译器的故障记录也通过 |
| 前端与接口检查 | 34 项通过 |

首次复测另外发现中文命令行参数导致 `Invalid utf8 byte sequence`，与原先启动访问冲突不同。将仓库路径放在子进程 `cwd`、仓库参数传 `.` 后，当前中文目录内的实时编译通过；解析脚本也改用相对 ASCII 路径。SDK 保持原有 ASCII 安装目录，未宣称任意 Unicode 命令行参数已获支持。

这组前后结果支持本机问题与系统版本变化相关；没有重新安装补丁复现，不能单独证明具体 Windows 内部改动的因果，也不能推广为所有机器或 SDK 版本的问题。1.2.0 对照包本轮没有复测，项目基线保持 1.0.5。

## 回退前的故障记录（2026-10-21）

用户反馈这台电脑以前能运行仓颉、最近没有再试。当时没有足够证据确定故障从何时开始，也不能认定是某次 Windows 更新导致。

### 回退前实测结果

| 检查 | 结果 |
| --- | --- |
| 当前系统 | Windows x64，系统报告版本 `10.0.26200` |
| 已安装编译器 | Cangjie 1.0.5，目标 `x86_64-w64-mingw32` |
| cjc 版本与编译 | 正常；最小程序、Doctor 核心及正确样例可编译 |
| 三个错误样例 | cjc 正常退出 1，并输出 JSON 诊断 |
| 最小程序、Doctor、cjpm | 启动失败，退出 `-1073741819`，即 `0xC0000005` |
| 官方便携 SDK 1.2.0 对照 | 编译可用；其最小程序和 cjpm 也启动失败。此检查不代表项目升级 SDK |
| Docker / Podman / WSL | 本次未发现可用容器环境，WSL 未安装；尚未验证 Linux 隔离基线 |

在当前 shell 加载 SDK 环境、改用 ASCII 工作目录、使用最小进程环境和不同终端方式均未解决。没有全局替换 SDK，没有修改系统设置，没有重启电脑。

### 回退前最小复现

```cangjie
main() {
    println("Cangjie Code Doctor SDK probe")
}
```

保存后，在 SDK 环境中用 `cjc hello.cj -o hello.exe` 编译，再执行该程序。回退前结果为：编译退出 0，程序启动即访问冲突，尚未进入业务代码。

SDK 自带 LLDB 对这个自建最小程序的回溯显示：

```text
msvcrt.dll!wcslen
libcangjie-runtime.dll!MapleRuntime::WinModuleManager::ReadWinModuleAtInit
libcangjie-runtime.dll!MapleRuntime::CangjieRuntime::Init
libcangjie-runtime.dll!MapleRuntime::CangjieRuntime::CreateAndInit
libcangjie-runtime.dll!CJ_MRT_CjRuntimeInit
hello.exe!main
```

Windows 应用错误事件也记录了 msvcrt.dll 访问冲突。以上证据将当前故障定位在运行时初始化阶段；不支持把它归因于 Doctor 的诊断逻辑。官方运行时的[Windows 模块初始化源文件](https://github.com/cangjielanguage/cangjie_runtime/blob/main/runtime/src/os/Windows/WinModuleManager.cpp)可作为进一步定位入口；根因和修复方案仍未确认，不直接修改运行时 DLL 或系统文件。

## 对照 SDK 与复现材料

对照包来自[官方 SDK 1.2.0 下载页](https://cangjie-lang.cn/download/1.2.0)，Windows x64 包 SHA-256：

```text
7bd5088ad56fb03c1214e73ea076de5ac08580cc419a8cbd46a524ee1ca250bf
```

本地对照包、提取目录和最小程序位于仓库忽略的 `tmp/sdk-probe/` 与 `tmp/sdk-1.2.0/`，不上传 SDK 二进制。项目基线仍为 1.0.5。

## Linux 对照验证更新（2026-10-21）

同版本官方 Linux SDK 1.0.5 在 GitHub Actions 的 Ubuntu 22.04 环境中已通过：原生自检、真实夹具解析、四个审核样例的实时编译，以及 HTTP 接口和历史读取。可核验[运行记录 39534258780](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39534258780)。这证明相应代码在该 Linux 环境可运行，不代表本机 Windows 故障已解决。

Linux SDK 从[官方 1.0.5 下载页](https://cangjie-lang.cn/download/1.0.5)提供的地址获取，SHA-256 固定为 `bacad84df8e0281c5395bab4c40e481e3ea6cc712eed5c953903b0d561a14562`。CI 先校验再解压使用，配置和安装脚本在仓库中保存。

## 2026-10-23 再次运行检查

本轮 SDK 1.0.5 编译新增 `check-output` 核心成功，但新程序 `--version`、`--self-test` 和原有 `target/debug/doctor.exe --version` 都在启动时退出 `-1073741819 / 0xC0000005`。测试在同一 PowerShell 调用中先加载 `D:\Cangjie\envsetup.ps1`；尚未执行到新增比较逻辑，不能记录为本地原生测试通过。

只读核查系统为 Windows 11 25H2、`26200.9711`，此前用户回退后记录是 `26200.9457`。这只是版本与失败重新出现的关联，未重新确定具体补丁或根因。本轮没有卸载更新、关闭安全设置或要求重启。旧的成功与失败证据均保留。

本机未找到 Docker/Podman；`wsl --status` 和列表命令退出 1，未获得可用 WSL 环境。新增容器验证先在已有 Linux CI 执行，未安装本机虚拟化环境，网页暂未接入任意源码编译和运行。具体隔离范围见[容器说明](sandbox.md)。

## 2026-10-23 STS 1.2.0 独立复测

用户提出尝试 STS。官方[下载中心](https://cangjie-lang.cn/download/1.2.0)当前列出 1.2.0 STS，发布日期为 2026-09-22。本轮重新获取官方页面引用的版本元数据，核对先前留存的 Windows x64 ZIP，SHA-256 仍为 `7bd5088ad56fb03c1214e73ea076de5ac08580cc419a8cbd46a524ee1ca250bf`，与官方一致；没有把旧的试验结果当成本次结果。

将已验证 ZIP 重新解压至独立英文路径 `D:\Cangjie-STS-1.2.0\cangjie`，使用新建英文目录和当前 Doctor 源码副本重新编译。单独 PowerShell 进程清除旧 SDK 的 PATH 项，再加载新 SDK 环境，产物与原项目二进制分开。实际结果如下，完整脱敏记录见 [STS 对照 JSON](sdk-sts-probe-20261023.json)。

| 检查 | 结果 |
| --- | --- |
| `cjc --version` | 退出 0，显示 1.2.0、Windows x64 |
| 新建最小 hello 编译 | 退出 0 |
| 新编译 hello 运行 | 无输出，退出 `0xC0000005` |
| STS 自带 `cjpm --version` | 无输出，退出 `0xC0000005` |
| 当前 Doctor 源码用 STS 重新编译 | 退出 0 |
| 新编译 Doctor `--version` | 无输出，退出 `0xC0000005`，没有进入后续自检 |

因此，STS 1.2.0 本轮试用没有恢复这台机器的仓颉运行能力。这不说明所有 Windows 系统或 STS 都有同样问题；也不将“编译成功”写成“运行成功”。保留 STS 独立目录供继续排查，机器级 `CANGJIE_HOME` 仍为原来的 `D:\Cangjie`，未修改系统环境变量、IDE 配置、正式文档语料或项目 SDK 1.0.5 基线。没有卸载更新或重启。

另补记上轮只读查询取得的 Windows 更新证据：系统事件记录 2026-10-22 21:41:50 开始安装 KB5127648（26200.9711），2026-10-23 04:51:24 记录安装成功；当前该补丁再次存在，系统构建回到 26200.9711。上述时间为北京时间。日志确认重新安装，但不能据此确定是自动还是用户触发，也不能单独证明具体运行时根因。

## 对进度的影响

- 本机 Windows 曾在回退及路径兼容修复后通过原生与审核样例 HTTP 检查；2026-10-23 再次启动失败，2026-10-25 用户再次回退后恢复。各次结果分别保留，后续版本变化仍需复测。
- 已有真实 cjc 诊断可用于只读页面展示和前端契约检查；它们不是程序运行或测试成功的证据。
- Linux CI 已实际运行 Docker 的 7 项资源/权限/清理探针及 3 条仓颉公开行为路径，[39932727970](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39932727970) 通过。该证据只限此次开发容器与公开输入，不是安全认证或正式 A/B。
- 安装 WSL/容器与切换验收 SDK 尚未开展。Windows 更新回退由用户操作；后续系统兼容性问题应继续保留最小复现、回溯及版本变更记录。
