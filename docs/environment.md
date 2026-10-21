# Windows 原生运行阻塞记录

记录日期：2026-10-21。用户反馈：这台电脑以前能运行仓颉，最近没有再试。当前没有足够证据确定故障从何时开始，也不能认定是某次 Windows 更新导致。

## 实测结果

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

## 最小复现

```cangjie
main() {
    println("Cangjie Code Doctor SDK probe")
}
```

保存后，在 SDK 环境中用 `cjc hello.cj -o hello.exe` 编译，再执行该程序。当前结果为：编译退出 0，程序启动即访问冲突，尚未进入业务代码。

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

- 本机 Windows 只能完成编译检查，原生运行仍不得登记为通过；Linux 的上述真实检查已通过，应分平台记录。
- 已有真实 cjc 诊断可用于只读页面展示和前端契约检查；它们不是程序运行或测试成功的证据。
- Linux CI 解决了核心验证途径，但本机交互环境仍需处理；按开题计划继续验证容器隔离。不能以网页预览或 CI 的托管虚拟机代替应用级隔离验收。
- 安装 WSL/容器、切换验收 SDK 或修改系统配置均尚未开展。若继续排查 Windows，应保留这份最小复现和实际回溯，再核对官方兼容性及系统变更记录。
