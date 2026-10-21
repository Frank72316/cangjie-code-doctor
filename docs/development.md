# 当前实现与复现

更新：2026-10-21，0.3 开发版。固定 Linux SDK 1.0.5 下审核样例的基础诊断链路已实际运行；本机 Windows 原生启动仍失败。任意源码及程序执行尚未开放。

## 组件职责

| 路径 | 当前职责 |
| --- | --- |
| `src/json.cj`、`diagnostics.cj` | 有界诊断读取、统一结果、原始日志与编译/工具异常区分 |
| `src/compiler.cj`、`trusted_examples.cj` | 审核样例校验、任务目录、输入快照、SDK 核对、真实 cjc 调用和记录写入 |
| `src/contract_checks.cj` | 原生确定性自检；Linux 已通过，Windows 尚不能启动 |
| `scripts/native-bridge.mjs`、`preview.mjs` | HTTP 与 CLI 之间的轻量传输；健康探测、请求约束、取消/超时终止、已有记录读取 |
| `scripts/task-store.mjs`、`web/task.mjs` | 外层进程任务的接收、结束及故障记录；与仓颉诊断结论分别保存 |
| `web/` | 副本编辑与定位、样例编译入口、历史、原始日志和导出；不解析或执行任意命令 |
| `tests/fixtures/` | 第一轮 Windows cjc 真实采集记录，保留原有来源 |
| `scripts/test-native*.mjs`、`test-compiler.mjs` | 原生 CLI、自检、真实编译及 HTTP 联调检查 |
| `tests/*.test.mjs` | 33 项前端/接口契约检查，包含明确标识的合成故障数据 |
| `.github/workflows/native-check.yml` | 固定 Ubuntu 22.04 和 SDK 1.0.5 的自动检查 |

新产生的记录由仓颉输出 `normalized` 诊断，页面直接使用。旧夹具保留只读 JavaScript 兼容适配，不能把它当成原生验证。编译业务不在 Node 中重写；当前 HTTP 传输层仍使用 Node，完整实验调度尚未实现。

## Windows 查看界面

仓库 PowerShell：

```powershell
./scripts/build.ps1 -SdkRoot 'D:\Cangjie'
./scripts/preview.ps1 -SdkRoot 'D:\Cangjie'
```

打开 `http://127.0.0.1:8765`，Ctrl+C 停止。脚本支持 `-NodePath`，优先使用系统 Node，其次使用本机 Codex 已有依赖。Node.js 要求 22 或更新版本。

本机目前会显示“本机编译暂不可用”，并禁用重新编译按钮；记录查看、编辑、定位和导出仍可使用。加载 SDK 环境后重启服务，才能让服务继承新的 PATH/DLL 设置。“检查环境”会重新探测已配置的核心与编译器。不能把历史编译结果当作当前副本的实时结果。

## Linux 构建与运行

在已有 Linux 环境中执行，以下不会自动安装 WSL 或修改 Windows：

```bash
bash scripts/install-ci-sdk.sh tmp/sdk-linux-1.0.5
source tmp/sdk-linux-1.0.5/cangjie/envsetup.sh
mkdir -p target/debug
cjc -p src -o target/debug/doctor --diagnostic-format=noColor
node scripts/test-native.mjs target/debug/doctor
node scripts/test-compiler.mjs target/debug/doctor "$(command -v cjc)"
node scripts/test-native-http.mjs target/debug/doctor "$(command -v cjc)"
node --test tests/*.test.mjs
node scripts/preview.mjs
```

SDK 安装脚本要求目的目录为空；只下载官方固定包，核对 SHA-256 后解压到该目录。已有 SDK 时直接加载其环境，不必重复下载。

服务默认在 `target/debug/` 查找 Doctor，在 `CANGJIE_HOME/bin/` 查找 cjc；可通过 `DOCTOR_BINARY`、`DOCTOR_COMPILER` 明确指定。端口可用 `DOCTOR_PREVIEW_PORT` 调整；始终只监听 `127.0.0.1`，不提供局域网访问。

## 原生 CLI 与记录

```text
doctor --version
doctor --self-test
doctor parse <编译器原始JSON文件> <编译器退出码>
doctor compile-example <仓库根目录> <cjc绝对路径> <样例编号> <32位小写十六进制任务编号> <UTC时间>
```

样例编号只能为 `type_mismatch`、`undefined_name`、`argument_count` 或 `hello`。核心内置逐份审核的精确原文及对应 SHA-256，要求磁盘源文件与原文一致；修改 JSON 清单不能授权新代码。这里的固定哈希仅对应这四个已知样例，并非已实现任意源码的摘要业务。测试另用标准 SHA-256 核对其一致性。

仓颉入口创建 `runs/native/<任务编号>/`，保存 `input.cj`、SDK 版本及编译器的 stdout/stderr、编译产物和 `record.json`。已有目录拒绝覆盖。完整诊断先写入临时文件，再重命名发布；编译前后核对原件及快照。外层任务状态另存于 `runs/tasks/`，仓颉启动失败时也有接收记录。

统一结果区分 `compile_passed`、`compile_failed`、`tool_error`，一直保持 `testStatus: not_run`。CLI 正常处理返回 0，参数用法错误返回 2，读取/任务失败返回 3；`compile-example` 处理出一个工具异常记录时仍可返回 0，因此调用者必须读取记录中的状态。

cjc 1.0.5 的正常样例成功编译时输出为空，错误 JSON 位于 stderr。只把退出 1 且存在错误证据判为编译错误；POSIX 信号编号、Windows 崩溃码、矛盾证据、超时和缺少产物都不能计为通过。底层 `parse` 命令只处理提供的诊断和退出码，产物存在性由编译任务入口检查。

## 页面与接口约束

页面选择样例后，在本机环境就绪且副本未改变时可重新编译。接口只接受一个样例编号，不接受源码、路径或命令。新结果显示之前会检查副本是否仍与请求时相同；有后续编辑则只把结果留在历史中，不覆盖编辑。

- `GET /api/health`：当前环境状态与本次服务启动的操作 token。
- `POST /api/probe`：重新探测配置中的核心与 SDK。
- `POST /api/compile-example`：仅接受 `{"caseId":"hello"}` 形式的请求。
- `GET /api/history`：`{tasks, unreadable, busy}`，按接收时间返回最近 20 次任务及可验证的诊断；`unreadable` 表示不能完整读取的任务或诊断数量。0.3 接口已替代 0.2 的 `records` 数组。

除健康读取外，API 要求本次服务 token；验证本地主机和来源，不允许跨来源预检授权。编译请求最多 1 KiB，同一服务同时只运行一个编译任务。所有进程使用独立参数数组，禁止 shell 拼接；浏览器中源码或诊断文本仅以文本方式展示。

导入限 UTF-8、`.cj`、64 KiB、200 行；单个导入记录最大 2 MiB。编辑器可以暂存超行数内容，下载前再次检查。导出诊断记录保留采集时的源码，当前副本要单独下载。哈希验证一致性，不是数字签名，导入文件中的生产者字段也不是来源认证。

## 任务状态与失败记录

在启动仓颉前，传输层先创建唯一的 `runs/tasks/<任务编号>/start.json`；保存失败就不启动任务。进程结束后写 `finish.pending.json`，再重命名为 `finish.json`。接收时间与结束时间分别保留。写盘失败不能返回任务成功；未完成的记录可在历史中显示为“状态待确认”。这些记录描述外层进程生命周期，编译诊断仍由仓颉生成。

| 任务状态 | 含义 |
| --- | --- |
| `running` | 当前服务确认正在处理 |
| `completed` | 核心正常返回，返回值与磁盘诊断一致且通过记录校验；仍须读取编译状态，不能等同于源码正确 |
| `failed` | 启动、进程退出、输出上限或记录校验异常 |
| `cancelled` / `timed_out` | 收到取消或达到总时限，已终止请求对应的进程树 |
| `interrupted` | 没有结束记录，且原服务 PID 已不存在；实际编译结果与结束时间不作推断 |
| `unknown` | 原服务可能仍在运行，或记录缺失、损坏，无法确认结果 |

进程日志和编译器日志分别标明，每路仅保留前 16 KiB，截断有提示；原生目录的原文件继续保留。读取诊断上限为 2 MiB，任务状态上限为 256 KiB，在读取期间也检查大小。损坏项给出数量提示，不拖垮其他历史条目；存在损坏任务记录时，不退回早期记录格式来宣称成功。

历史可展开详情、导出整个任务 JSON，存在有效诊断时也可单独载入源码副本。任务导出格式是 `doctor-task`，与可导入的 `trusted-development-capture` 诊断格式不同；任务 JSON 用于留档排查，当前没有任务导入功能。日志可能包含本机路径，公开分享前应检查；`runs/` 始终忽略，不会自动推送。

服务重启后的恢复是保守判读：不会凭 PID 对其他服务或遗留进程执行终止操作；PID 复用或进程存活但失去响应时显示“状态待确认”。未实现跨服务的独占锁和遗留进程自动清理。原子重命名避免读取半份结束记录，但不承诺断电情况下的持久化保证。环境不可用、输入非法及并发拒绝属于未接收的请求，不生成编译任务。

## 超时与取消的实际边界

仓颉入口对版本检查和编译分别等待最多 30 秒，结果读取有大小上限；输出重定向到任务文件，避免管道堵塞。HTTP 传输另有总时限、输出上限和进程树终止；用户取消会关闭请求并终止相应进程树。页面会继续确认最终状态。进程已经退出后到达的取消不改写完成结果；取消中若诊断已写入，仍保留“已取消”状态，可查看当时保存的诊断，不能把它算作完成。取消不承诺撤销已落盘的数据。

这些属于开发故障保护。日志文件在进程存活期间尚无操作系统级磁盘配额，独立 CLI 的直接子进程终止也不等于完整的后代清理。当前仅允许审核样例，不执行产物；不能称为任意源码的安全沙箱。

## 验证与后续

Linux 的原生运行及完整 HTTP 链路已在[检查记录 39534258780](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39534258780)通过。自动检查只运行公开的自建开发输入，不访问保留测试或任何密钥，也不是 A/B 实验。

0.3 本地增加了失败持久化、取消竞态、服务中断、损坏与超大记录、写盘失败、HTTP 断连和目录边界检查；浏览器中也验证了一次真实 Windows 启动失败的详情展开与 JSON 导出。故障注入输入明确标识为测试，均不计入 A/B。

下一步：解决本机交互运行环境；验证 Linux 的进程、资源、网络及权限隔离；随后开放任意源码受限编译、公开测试、同版本文档及用户确认修改。详情持续记录在[进度文件](progress.md)。
