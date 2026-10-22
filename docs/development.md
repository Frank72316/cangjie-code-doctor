# 当前实现与复现

更新：2026-10-22，0.3 开发版。固定 SDK 1.0.5 下审核样例的基础诊断链路已在 Linux 和本机 Windows 实际运行；Windows 回退复测见[环境记录](environment.md)。仓颉原生离线文档检索和引用证据保存已接通。上一轮四个功能页面拆分已通过检查，本轮新增独立的使用教程与首页指引，具体检查结果见[进度记录](progress.md)。任意源码、程序执行、模型修复和正式 A/B 尚未开放。

## 组件职责

| 路径 | 当前职责 |
| --- | --- |
| `src/json.cj`、`diagnostics.cj` | 有界诊断读取、统一结果、原始日志与编译/工具异常区分 |
| `src/compiler.cj`、`trusted_examples.cj` | 审核样例校验、任务目录、输入快照、SDK 核对、真实 cjc 调用和记录写入 |
| `src/retrieval.cj`、`retrieval_checks.cj` | 原生 BM25、分词、固定中英术语扩展、排序及确定性自检 |
| `src/contract_checks.cj` | 原生确定性自检；Linux 与回退后的 Windows 均通过 |
| `scripts/native-bridge.mjs`、`preview.mjs` | HTTP 与 CLI 之间的轻量传输；健康探测、请求约束、取消/超时终止、已有记录读取 |
| `scripts/task-store.mjs`、`web/task.mjs` | 外层进程任务的接收、结束及故障记录；与仓颉诊断结论分别保存 |
| `scripts/retrieval.mjs` | 检索输入、版本、语料哈希和原生引用校验；保存请求、快照、结果及失败记录，不在 JavaScript 重算排名 |
| `data/docs/` | 固定 SDK 1.0.5 官方文档的 15 段摘录、来源清单、许可证及离线重建脚本 |
| `web/` | 独立使用教程与四个功能页面、会话内导航、副本编辑与定位、样例编译入口、历史、原始日志、文档依据与导出；不解析或执行任意命令 |
| `tests/fixtures/` | 第一轮 Windows cjc 真实采集记录，保留原有来源 |
| `scripts/test-native*.mjs`、`test-compiler.mjs`、`test-retrieval.mjs` | 原生 CLI、自检、真实编译、离线检索及 HTTP 联调检查 |
| `tests/*.test.mjs` | 前端/接口契约检查，包含明确标识的合成故障数据及页面路由检查；各轮实际数量与结果见进度记录 |
| `.github/workflows/native-check.yml` | 固定 Ubuntu 22.04 和 SDK 1.0.5 的自动检查 |

新产生的记录由仓颉输出 `normalized` 诊断，页面直接使用。旧夹具保留只读 JavaScript 兼容适配，不能把它当成原生验证。编译业务不在 Node 中重写；当前 HTTP 传输层仍使用 Node，完整实验调度尚未实现。

## Windows 查看界面

仓库 PowerShell：

```powershell
./scripts/build.ps1 -SdkRoot 'D:\Cangjie'
./scripts/preview.ps1 -SdkRoot 'D:\Cangjie'
```

打开 `http://127.0.0.1:8765`，首页进入“使用教程”；Ctrl+C 停止服务。脚本支持 `-NodePath`，优先使用系统 Node，其次使用本机 Codex 已有依赖。Node.js 要求 22 或更新版本。

回退后的本机环境已可编译审核样例。加载 SDK 环境后重启服务，才能让服务继承新的 PATH/DLL 设置。“检查环境”会重新探测已配置的核心与编译器；失败时仍禁用编译并保留记录查看。不能把历史编译结果当作当前副本的实时结果。

本机 SDK 1.0.5 对中文命令行参数存在解码问题。服务通过进程工作目录传递仓库位置，CLI 的仓库参数使用 `.`，所以仓库可以留在中文目录；SDK 安装路径暂使用 ASCII 字符。单独调用 `parse` 时，从仓库目录传相对 ASCII 文件路径。完整 Windows 复测命令：

```powershell
. 'D:\Cangjie\envsetup.ps1'
./scripts/test-native.ps1 -SdkRoot 'D:\Cangjie'
node scripts/test-native.mjs target/debug/doctor.exe
node scripts/test-compiler.mjs target/debug/doctor.exe D:/Cangjie/bin/cjc.exe
node scripts/test-native-http.mjs target/debug/doctor.exe D:/Cangjie/bin/cjc.exe
node scripts/test-retrieval.mjs target/debug/doctor.exe D:/Cangjie/bin/cjc.exe
node --test tests/*.test.mjs
```

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
node scripts/test-retrieval.mjs target/debug/doctor "$(command -v cjc)"
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
doctor retrieve <文档语料JSON文件> <查询JSON文件>
```

样例编号只能为 `type_mismatch`、`undefined_name`、`argument_count` 或 `hello`。核心内置逐份审核的精确原文及对应 SHA-256，要求磁盘源文件与原文一致；修改 JSON 清单不能授权新代码。这里的固定哈希仅对应这四个已知样例，并非已实现任意源码的摘要业务。测试另用标准 SHA-256 核对其一致性。

仓颉入口创建 `runs/native/<任务编号>/`，保存 `input.cj`、SDK 版本及编译器的 stdout/stderr、编译产物和 `record.json`。已有目录拒绝覆盖。完整诊断先写入临时文件，再重命名发布；编译前后核对原件及快照。外层任务状态另存于 `runs/tasks/`，仓颉启动失败时也有接收记录。

统一结果区分 `compile_passed`、`compile_failed`、`tool_error`，一直保持 `testStatus: not_run`。CLI 正常处理返回 0，参数用法错误返回 2，读取/任务失败返回 3；`compile-example` 处理出一个工具异常记录时仍可返回 0，因此调用者必须读取记录中的状态。

cjc 1.0.5 的正常样例成功编译时输出为空，错误 JSON 位于 stderr。只把退出 1 且存在错误证据判为编译错误；POSIX 信号编号、Windows 崩溃码、矛盾证据、超时和缺少产物都不能计为通过。底层 `parse` 命令只处理提供的诊断和退出码，产物存在性由编译任务入口检查。

## 功能页面与会话状态

侧栏首项为 `/tutorial`（使用教程），根地址 `/` 和 Doctor 品牌入口也进入教程。其余四项分别进入 `/diagnostics`（编译诊断）、`/documents`（文档依据）、`/records`（记录依据）和 `/history`（任务历史）。每次仅显示当前页面内容，不通过长页面锚点滚动来切换功能。各地址可直接打开或刷新；地址、当前侧栏项和浏览器前进/后退应保持一致。

教程先介绍当前离线工具的用途，再引导选择“类型不匹配”审核样例、重新编译、点击行列定位、检索同版本官方原文，最后导出记录和查看历史。功能入口只导航，不自动切换样例或覆盖已有编辑；进入编译诊断后由用户主动选择样例。教程同时说明环境未就绪、修改后旧诊断失效、源码副本与各类 JSON 的区别，以及刷新前保存的要求。当前检索不生成 AI 解释或修复；“编译通过”不等于行为测试通过。

同一浏览器页面会话内的功能切换保留当前源码副本、诊断记录和检索结果，不重新读取样例，也不因导航丢弃正在编辑的内容。切换样例、导入记录或修改源码时，仍按原有规则清除过期检索依据；从历史载入有效诊断后进入编译诊断页面。

这些状态尚未持久化到浏览器存储。刷新或关闭页面后重新打开会重新初始化工作台，即使地址仍是文档依据或任务历史，也不代表恢复了上次编辑内容。刷新前先下载修改后的源码、诊断记录或检索证据；服务已保存的任务历史仍由磁盘读取。页面拆分的直达、刷新、前进/后退、状态保留与窄屏显示已在上一轮验收；本轮新增教程又单独检查了首页跳转、教程刷新、跨页编辑及检索结果保留。

## 页面与接口约束

页面选择样例后，在本机环境就绪且副本未改变时可重新编译。编译接口只接受一个样例编号，不接受源码、路径或命令。新结果显示之前会检查副本是否仍与请求时相同；有后续编辑则只把结果留在历史中，不覆盖编辑。

- `GET /api/health`：当前环境状态与本次服务启动的操作 token。
- `POST /api/probe`：重新探测配置中的核心与 SDK。
- `POST /api/compile-example`：仅接受 `{"caseId":"hello"}` 形式的请求。
- `POST /api/retrieve`：仅接受 `{"record":诊断记录,"query":"可选关键词"}`；`query` 可省略或留空，使用当前诊断生成查询。不接受文档路径、源码文件路径或命令。
- `GET /api/history`：`{tasks, unreadable, busy}`，按接收时间返回最近 20 次任务及可验证的诊断；`unreadable` 表示不能完整读取的任务或诊断数量。0.3 接口已替代 0.2 的 `records` 数组。

除健康读取外，API 要求本次服务 token；验证本地主机和来源，不允许跨来源预检授权。编译请求最多 1 KiB；检索 HTTP 请求最多 2 MiB 加 16 KiB，其中诊断记录仍受 2 MiB 限制、查询不超过 2,000 个 JavaScript 字符单元。同一服务同时只运行一个编译或检索任务。所有进程使用独立参数数组，禁止 shell 拼接；浏览器中源码或诊断文本仅以文本方式展示。

导入限 UTF-8、`.cj`、64 KiB、200 行；单个导入记录最大 2 MiB。编辑器可以暂存超行数内容，下载前再次检查。导出诊断记录保留采集时的源码，当前副本要单独下载。哈希验证一致性，不是数字签名，导入文件中的生产者字段也不是来源认证。

## 离线文档检索与证据

本轮使用 [SDK 1.0.5 官方文档固定提交](document-sources.md)中的 15 段中文原文。来源修订为 `f8f8cd75a336e23785a4c57bd6091b2adf1e0302`，快照为 `cangjie-1.0.5-f8f8cd75a336-zh-cn-core-01`，当前语料 SHA-256 为 `aea5e1dd984f73f607a41555ac590ffc4d1ce6627149b660f03fd449c40325c2`。只读本地 JSON，不请求外部模型服务或在线检索接口。

仓颉核心完成词法检索：ASCII 标识符转小写，连续汉字产生单字与相邻双字词项；使用固定的 `compiler-glossary-v1` 将常见英文编译术语追加为中文查询词。原查询与扩展后的 `effectiveQuery` 都保留。BM25 参数固定为 `k1=1.2`、`b=0.75`，HTTP 入口取前三条，分数相同时按文档 ID 确定顺序。分数只用于当前快照内的相关性排序，不是置信度或修复成功概率。

服务先校验输入诊断及源码 SHA-256，拒绝 SDK 版本不符和工具异常记录，再核对语料与清单的哈希、版本和来源修订。每次检索将语料复制到独立运行目录，并把查询路径作为参数传给仓颉。原生输出返回后，逐项核对查询、配置、版本、排序和引用正文；未知片段、改写原文、重复条目或非法分数不能成为有效证据。只允许官方文档站和官方文档仓库的 HTTPS 引用。

文件位于已忽略的 `runs/retrieval/<检索编号>/`：

| 文件 | 含义 |
| --- | --- |
| `request.json` | 查询来源、完整诊断记录、源码和诊断记录哈希、语料哈希、接收时间 |
| `corpus.json`、`query.json` | 此次实际传给原生检索的固定输入 |
| `evidence.json` | 已校验的文档结果与来源、排名、算法参数、诊断/源码/语料哈希；先写临时文件再重命名 |
| `failure.json` | 已接收任务的检索、校验或保存失败说明及有界进程日志（失败时） |

成功结果在最终证据文件写入后才返回；写入失败不能显示成功。检索进程限时 15 秒，沿用输出上限和进程树取消处理。没有词法命中时保存并返回空结果，不补造引用。服务启动前或输入/快照校验阶段拒绝的请求不生成完整检索任务；保存失败可能只留下部分文件，不推断其成功。原子重命名不承诺断电持久化。

页面展示正文引用、原文链接、版本和证据元数据，允许导出 `doctor-document-evidence` JSON。源码变化或切换诊断后，原文档依据被清除，未完成请求被取消；异步结果须与请求时诊断及当前副本一致才能展示。此证据格式不能作为诊断记录导入，检索任务目前也未接入编译任务历史列表。磁盘文件保留供核验，不自动上传。

直接 CLI 的查询 JSON 形如 `{"sdkVersion":"1.0.5","query":"函数 参数 调用","topK":3}`。在仓库根目录使用相对 ASCII 路径调用 `doctor retrieve`，避免 Windows SDK 中文参数问题；完整的记录绑定、允许列表和落盘由 HTTP 传输入口提供，不能把裸 CLI 的通用 JSON 输入当作同样的验收边界。

当前片段覆盖有限的基础类型、变量、作用域和函数规则；用户需要回看完整原文并结合源码核对。展示中文官方文档不等于已经生成中文诊断解释。本阶段未生成修复候选、执行程序或测量修复成功率；模型服务与预算尚未选定，优先完成离线功能。

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

Linux 的原生运行及完整 HTTP 链路已在[检查记录 39534258780](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39534258780)通过。0.3 新增的真实编译器启动失败及任务记录检查也在[39536799153](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39536799153)通过（提交 `882a53d`，当时为 32 项前端/接口检查；后续本地补充至 33 项）。自动检查只运行公开的自建开发输入，不访问保留测试或任何密钥，也不是 A/B 实验。

0.3 本地增加了失败持久化、取消竞态、服务中断、损坏与超大记录、写盘失败、HTTP 断连和目录边界检查；浏览器中也验证了一次真实 Windows 启动失败的详情展开与 JSON 导出。故障注入输入明确标识为测试，均不计入 A/B。

上一轮离线文档依据实际完成本机 `test-native.ps1`、`test-native.mjs`、`test-compiler.mjs`、`test-native-http.mjs` 和 `test-retrieval.mjs` 检查；后者核对三个真实开发诊断的原文引用、哈希、重复排序、无命中、HTTP 和 SDK 不匹配拒绝。`node --test tests/*.test.mjs` 共 42 项通过，对应提交 `df0d436` 的 [Linux CI 39777823451](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39777823451) 已成功。上一轮自动化预览停在旧连接失败页，未完成新增文档界面的操作验收，该限制保留在进度记录中。

上一轮页面拆分的 43 项本地检查通过；浏览器实际核验前进/后退、编辑与检索结果跨页保留、记录页刷新、历史载入返回诊断、真实审核样例编译、检索和两类 JSON 导出。记录页导入无效文件时错误直接可见，有效记录可重新载入；四页窄屏无横向溢出。对应提交 `3a53900` 的 [Linux CI 39780688125](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39780688125) 已通过，GitCode 与 GitHub 的远端 SHA 已核对一致。截图与问题修复过程见进度文件。

本轮教程新增后，43 项本地检查、JavaScript 语法和 `git diff --check` 通过。实际从首页按指引选择类型不匹配、重新编译、点击第 2 行 24 列定位，并以空查询取得三条官方摘录；教程往返和浏览器后退保持检索结果。编辑副本后通过教程返回仍保留修改且编译禁用，恢复记录副本可继续操作。首页进入 `/tutorial`，教程刷新和四个功能页切换正确；FAQ 展开与功能入口可用。390、320 像素视口分别检查内容宽度和滚动宽度一致，五项导航在较窄尺寸自动换行。截图见[教程桌面](tutorial-preview.png)与[手机](tutorial-mobile.png)。这些仅是离线开发流程验收，不是学生试用或 A/B 结果。本轮发布后 CI 由包含这些改动的提交独立检查。

下一步：继续完善离线案例、证据和用户确认流程；验证 Linux 的进程、资源、网络及权限隔离后再开放任意源码受限编译与公开测试。模型服务与预算明确后再接 AI 修复和正式 A/B。详情持续记录在[进度文件](progress.md)。
