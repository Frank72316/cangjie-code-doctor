# Windows 原生运行与回退验证

更新日期：2026-10-22。下方保留回退前的原始故障，避免把历史失败和当前状态混淆。

## 当前结果：回退后恢复（2026-10-22）

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

## 对进度的影响

- 本机 Windows 经回退及路径兼容修复后，原生与审核样例 HTTP 链路已通过；与此前失败分开记录，不覆盖原始故障证据。
- 已有真实 cjc 诊断可用于只读页面展示和前端契约检查；它们不是程序运行或测试成功的证据。
- 按开题计划继续验证 Linux 容器隔离。不能以本机可运行、网页预览或 CI 的托管虚拟机代替应用级隔离验收。
- 安装 WSL/容器与切换验收 SDK 尚未开展。Windows 更新回退由用户操作；后续系统兼容性问题应继续保留最小复现、回溯及版本变更记录。
