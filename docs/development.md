# 当前实现与复现

更新：2026-10-23，0.3 开发版，第十二轮。审核样例诊断、仓颉原生离线检索、人工修改存档及回退已经实现；本轮把已保存修订接入 Linux 容器公开验证，并提供独立验证记录和 JSON/静态 HTML 报告。使用教程与四个功能页面仍保留独立地址。当前没有模型修复或正式 A/B。Windows 曾在回退更新后通过原生检查，但 2026-10-23 再次启动 `0xC0000005`；历史结果与当前限制见[环境记录](environment.md)。

## 组件职责

独立开发 CLI 与显式启用的 Linux Web 验证共用同一个容器运行层，详见[容器开发与验收](sandbox.md)。Node 管理 Docker 生命周期、受限传输、输入快照与记录一致性；仓颉 `parse` 处理真实编译诊断，`check-output` 比较公开 stdout 原始字节。Web 新入口只从已保存修订取源码，不接受浏览器提供命令、镜像或待执行源码。Windows 不能调用该执行入口，仍可保存修改和读取落盘报告。

| 路径 | 当前职责 |
| --- | --- |
| `src/json.cj`、`diagnostics.cj` | 有界诊断读取、统一结果、原始日志与编译/工具异常区分 |
| `src/compiler.cj`、`trusted_examples.cj` | 审核样例校验、任务目录、输入快照、SDK 核对、真实 cjc 调用和记录写入 |
| `src/retrieval.cj`、`retrieval_checks.cj` | 原生 BM25、分词、固定中英术语扩展、排序及确定性自检 |
| `src/contract_checks.cj` | 原生确定性自检；Linux 与回退后的 Windows 均通过 |
| `src/verification.cj` | 公开测试 stdout 的有界原始字节比较；退出非零判运行错误，缺文件或超大判工具错误 |
| `scripts/sandbox-container.mjs`、`sandbox-verify.mjs` | Linux CLI 与 Web 共用运行层；容器限制核对、断网编译与逐例运行、原生判定、输入/输出/清理报告 |
| `sandbox/`、`scripts/build-sandbox-image.sh`、`test-sandbox-*.mjs` | 专用构建上下文、实际镜像身份、真实 Docker 限制探针及三个公开仓颉开发检查 |
| `scripts/native-bridge.mjs`、`preview.mjs` | HTTP 与 CLI 之间的轻量传输；健康探测、请求约束、取消/超时终止、已有记录读取 |
| `scripts/task-store.mjs`、`web/task.mjs` | 外层进程任务的接收、结束及故障记录；与仓颉诊断结论分别保存 |
| `scripts/revision-store.mjs`、`web/revision.mjs` | 人工副本的有界逐行差异、确认输入、哈希绑定、修订存档与读取校验；不产生编译或测试结论 |
| `scripts/verification-service.mjs` | 已保存修订的 Linux 容器可用性探测、共享忙状态、独立请求/结束记录、历史读取与清理失败锁定 |
| `web/verification.mjs`、`verification-ui.mjs` | 公开输入与报告契约、选择修订和填写测试、逐项结果与历史、JSON 下载和不含脚本的 HTML 报告 |
| `scripts/retrieval.mjs` | 检索输入、版本、语料哈希和原生引用校验；保存请求、快照、结果及失败记录，不在 JavaScript 重算排名 |
| `data/docs/` | 固定 SDK 1.0.5 官方文档的 15 段摘录、来源清单、许可证及离线重建脚本 |
| `web/` | 独立使用教程与四个功能页面、会话内导航、副本编辑与定位、样例编译入口、历史、原始日志、文档依据与导出；不解析或执行任意命令 |
| `tests/fixtures/` | 第一轮 Windows cjc 真实采集记录，保留原有来源 |
| `scripts/test-native*.mjs`、`test-compiler.mjs`、`test-retrieval.mjs` | 原生 CLI、自检、真实编译、离线检索及 HTTP 联调检查 |
| `scripts/test-revision-verification-http.mjs` | Linux 真实 HTTP → 已保存修改 → 容器 → 原生判定 → 报告/重启读取；正常期望与故意错误期望两条公开开发路径 |
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

本机在回退后的历史检查中曾可编译并运行审核样例诊断链路；2026-10-23 新旧 Doctor 再次启动失败，目前保留这一故障，没有改动系统。修复环境后，加载 SDK 并重启服务才能继承新的 PATH/DLL 设置。“检查环境”重新探测已配置的核心与编译器；失败时禁用样例编译，已有诊断、修订和验证记录仍可读取。Windows 无论是否设置镜像 ID，当前版本均不启用容器执行。不能把历史结果当作当前副本的实时结果。

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

如需验证已保存修改，先在已有 Linux Docker Engine 环境按[容器说明](sandbox.md)构建固定 SDK 镜像、运行限制检查，再显式启用 Web 容器入口：

```bash
bash scripts/build-sandbox-image.sh tmp/sdk-linux-1.0.5/cangjie tmp/sandbox-image.json
image=$(node -p "JSON.parse(require('fs').readFileSync('tmp/sandbox-image.json','utf8')).image")
node scripts/test-sandbox-isolation.mjs "$image" tmp/sandbox-isolation.json
DOCTOR_SANDBOX_IMAGE="$image" DOCTOR_BINARY="$(pwd)/target/debug/doctor" node scripts/preview.mjs
```

`DOCTOR_SANDBOX_IMAGE` 必须是当前机器已有镜像的完整 `sha256:<64 位小写十六进制>` ID，不能使用标签或远程地址。每次启动服务会检查原生 Doctor 能否运行、创建无输入挂载的探针容器、核对实际资源/挂载限制、确认容器 SDK 1.0.5 并清理探针；任一失败都禁用执行。宿主四样例编译器与容器验证分别报告可用性：容器验证需要宿主 Doctor 原生判定核心，但不依赖宿主 cjc 路径。未配置镜像时只关闭验证执行，不阻止保存修订或读取已有报告。

## 原生 CLI 与记录

```text
doctor --version
doctor --self-test
doctor parse <编译器原始JSON文件> <编译器退出码>
doctor compile-example <仓库根目录> <cjc绝对路径> <样例编号> <32位小写十六进制任务编号> <UTC时间>
doctor retrieve <文档语料JSON文件> <查询JSON文件>
doctor check-output <实际stdout文件> <期望stdout文件> <候选退出码>
```

样例编号只能为 `type_mismatch`、`undefined_name`、`argument_count` 或 `hello`。核心内置逐份审核的精确原文及对应 SHA-256，要求磁盘源文件与原文一致；修改 JSON 清单不能授权新代码。这里的固定哈希仅对应这四个已知样例，并非已实现任意源码的摘要业务。测试另用标准 SHA-256 核对其一致性。

仓颉入口创建 `runs/native/<任务编号>/`，保存 `input.cj`、SDK 版本及编译器的 stdout/stderr、编译产物和 `record.json`。已有目录拒绝覆盖。完整诊断先写入临时文件，再重命名发布；编译前后核对原件及快照。外层任务状态另存于 `runs/tasks/`，仓颉启动失败时也有接收记录。

统一结果区分 `compile_passed`、`compile_failed`、`tool_error`，一直保持 `testStatus: not_run`。CLI 正常处理返回 0，参数用法错误返回 2，读取/任务失败返回 3；`compile-example` 处理出一个工具异常记录时仍可返回 0，因此调用者必须读取记录中的状态。

cjc 1.0.5 的正常样例成功编译时输出为空，错误 JSON 位于 stderr。只把退出 1 且存在错误证据判为编译错误；POSIX 信号编号、Windows 崩溃码、矛盾证据、超时和缺少产物都不能计为通过。底层 `parse` 命令只处理提供的诊断和退出码，产物存在性由编译任务入口检查。

## 功能页面与会话状态

侧栏首项为 `/tutorial`（使用教程），根地址 `/` 和 Doctor 品牌入口也进入教程。其余四项分别进入 `/diagnostics`（编译诊断）、`/documents`（文档依据）、`/records`（记录依据）和 `/history`（任务历史）。每次仅显示当前页面内容，不通过长页面锚点滚动来切换功能。各地址可直接打开或刷新；地址、当前侧栏项和浏览器前进/后退应保持一致。

教程先用三步说明“选样例并编译 → 点击报错位置 → 查阅文档”，提供一个主要入口；详细五步教程和功能说明默认折叠，常见问题分别展开。功能入口只导航，不自动切换样例或覆盖已有编辑；进入编译诊断后由用户主动选择样例。教程同时说明环境未就绪、修改后旧诊断失效、源码副本与各类 JSON 的区别，以及刷新前保存的要求。当前检索不生成 AI 解释或修复；“编译通过”不等于行为测试通过。

编译诊断页将四个样例按钮改为下拉选择，主动作统一为“编译所选样例”；下方提示当前阶段或不可编译原因。环境详情正常折叠、异常自动展开，“检查环境”收在详情内。源码的导入、下载归入“源码操作”，“恢复记录副本”仅在副本修改后出现。诊断结果下方提供“查找文档依据”作为下一步；诊断记录的导入、导出统一在记录依据页，任务导出位于历史条目的详情内。

文档页默认使用当前诊断，保留“检索文档”作为主动作；自定义词输入按需展开，填写后主操作区提示使用自定义关键词。检索结果首条原文展开，其他条目折叠；来源、许可、匹配信息、本次查询及完整元数据均可展开查看，并保留证据 JSON 导出。中等宽度保留带文字的侧栏，窄屏改为顶部导航与单栏内容。

同一浏览器页面会话内的功能切换保留当前源码副本、诊断记录和检索结果，不重新读取样例，也不因导航丢弃正在编辑的内容。切换样例、导入记录或修改源码时，仍按原有规则清除过期检索依据；从历史载入有效诊断后进入编译诊断页面。

这些会话状态没有自动持久化到浏览器存储。刷新或关闭页面后重新打开会重新初始化工作台，即使地址仍是文档依据或任务历史，也不代表恢复了上次编辑内容。刷新前确认保存修订或下载当前副本；诊断记录与检索证据按需另外导出。服务已保存的任务和修订由磁盘读取，修订可在记录依据页主动载入。页面拆分、教程和布局简化的历史检查保留在进度记录中，本轮另验收修订流程。

## 人工修改审阅与修订

修改源码后，诊断页在源码下方提供“查看修改并保存”，展开后显示逐行差异及“确认保存这份修改”，不新增侧栏页面。比较基准是当前诊断记录中的源码；仅为显示差异统一换行，原诊断记录及其原始源码哈希保持不变。差异保留空行和末尾换行，使用新增、删除标记和前后行号。确认时保存的是用户审阅过的副本；继续编辑或改换诊断后必须重新展开核对，异步返回不能覆盖后续编辑。未保存副本即将被切换样例、导入或载入操作替换时，先提示用户是否放弃；取消后保留编辑。

确认后在忽略的 `runs/revisions/<32位小写十六进制编号>/revision.json` 中保存修订。服务自行产生编号和保存时间，先独占写 `revision.pending.json` 再重命名发布；不覆盖先前记录。格式为 `doctor-manual-revision`，包含 `baseRecord`、其 `recordSha256` 和修改 `source` 的 SHA-256；原源码哈希保留在原诊断中。服务重新校验，不采信客户端自行声明的编译或测试结果。记录依据页展示按保存时间排序的最近 20 份摘要，并可载入其绑定的诊断和修改副本；“恢复记录副本”返回该诊断中的原源码。载入与回退只作用于工作台副本，不覆盖审核样例或导入文件。

记录读取核对编号、文件大小、UTF-8、完整字段和哈希；损坏或未发布的条目计入 `unreadable`，不冒充完整记录。记录目录不接受链接，读文件检查符号链接与已打开文件身份。条目详情提供 JSON 下载；修订格式与诊断记录不同，当前不能用诊断导入按钮重新导入修订 JSON，本机恢复使用保存列表。保存不依赖编译器可用，但需要已连接本机服务和有效操作 token。

修订是人工操作留痕，不是模型候选或修复成功证明。保存动作本身不编译、执行或测试，原诊断的编译状态仅适用于原源码。后续验证另存新记录，修订中的 `compileStatus: not_run`、`testStatus: not_run` 和 `execution.attempted: false` 保持不变。编辑时原文档检索结果失效，修订不自动合并上次文档证据；需要引用记录时应在修改前另行导出。存档失败须显示失败，不能宣称保存完成；原子发布不承诺断电持久化。

## 已保存修改的公开验证与报告

“记录依据”页提供“验证已保存修改”：选择确认过的副本，可展开核对源码与 SHA-256，再填写 1 至 8 条公开标准输入和期望 stdout，点击“编译并验证这份修改”即确认执行选定副本。默认只展开一条测试，其他测试按需添加；当前编辑器后续输入不会被验证结果覆盖。测试按原始字节比较，空格、CRLF 和末尾换行有意义；页面可明确补一个 LF，并用 JSON 字符串展示实际比较文本，不自动猜测期望输出。

服务只接受修订编号、公开测试和确认状态，自行从修订库加载并校验源码。执行前把完整修订与公开测试写入 `runs/revision-verifications/<验证编号>/request.json`；每次验证独立编号，即使修订和测试相同也不覆盖旧结果。容器运行层另在 `runs/verification/<容器任务编号>/` 留存源码、产物和原始输出。源码、镜像、测试顺序、编译/逐项判定、退出证据与清理状态校验通过后，先写 `verification.pending.json`，再重命名发布 `verification.json`。状态已完成仅表示有完整报告，报告内部仍可能是编译失败、公开测试失败或工具异常。

“验证记录与报告”按时间列出最近 20 次记录。存在当前服务活跃任务时可显示正在验证；只有请求且无完整结束记录时显示“状态待确认”，不能用残留产物推断通过。服务重新启动或换为无执行能力的 Windows 服务后，仍可读取原目录中的完整报告，但不会自动重跑、恢复或取消以前的任务。损坏、超大、链接文件及与原请求不一致的记录拒绝展示为成功，并保留不可读数量。

JSON 使用 `doctor-revision-verification` 格式，包含原诊断与人工修订、接收/结束时间、公开输入和期望值、容器报告、源码/输出哈希、SDK/镜像身份、逐项原生判定及清理证据；完整记录上限 16 MiB。静态 HTML 展示身份、源码差异与修改副本、编译信息、公开输入/期望/实际结果、退出码及清理结论，可在服务关闭后单独打开。候选文本均转义，HTML 不含脚本或远程资源，另有禁止外部加载的 CSP。报告用于本次人工修改和公开测试留档，不是 AI 修复、保留测试或正式实验报告；文档检索证据仍单独导出，哈希也不构成数字签名。目前不提供验证 JSON 的页面导入，已保存记录通过本机列表重新读取。

容器清理未确认时，服务保存故障证据并锁住后续验证；“检查环境”不能解除此锁。须人工核查并清理记录中的容器后再重启服务。锁只属于当前进程，重启没有自动遗留容器扫描或清理保证。共享忙状态阻止同一服务同时编译、检索或验证，但尚无跨服务独占、累计磁盘配额或多用户调度。HTTP 断连会请求取消正在进行的验证，退出、落盘和断连存在先后顺序；刷新后应读取记录确认最终状态，不能把客户端错误当作未执行或已撤销。

## 页面与接口约束

页面选择样例后，在本机环境就绪且副本未改变时可重新编译。编译接口只接受一个样例编号，不接受源码、路径或命令。新结果显示之前会检查副本是否仍与请求时相同；有后续编辑则只把结果留在历史中，不覆盖编辑。

- `GET /api/health`：当前原生环境、`verification` 容器可用性、共享 `busy` 状态与本次服务启动的操作 token。
- `POST /api/probe`：重新探测配置中的核心、SDK 和可选容器环境；不解除已确认的清理故障锁。
- `POST /api/compile-example`：仅接受 `{"caseId":"hello"}` 形式的请求。
- `POST /api/retrieve`：仅接受 `{"record":诊断记录,"query":"可选关键词"}`；`query` 可省略或留空，使用当前诊断生成查询。不接受文档路径、源码文件路径或命令。
- `GET /api/history`：`{tasks, unreadable, busy}`，按接收时间返回最近 20 次任务及可验证的诊断；`unreadable` 表示不能完整读取的任务或诊断数量。0.3 接口已替代 0.2 的 `records` 数组。
- `POST /api/revisions`：只接受 `{"baseRecord":原诊断记录,"source":{"name":"example.cj","text":"修改源码"},"confirmed":true}`，服务校验后返回保存的人工修订。文件名限 128 个字符，不接受路径、命令或额外结果字段。
- `GET /api/revisions`：`{revisions, unreadable}`，返回最近 20 份有效修订的编号、保存时间、前后文件名及修改后源码哈希摘要。
- `GET /api/revisions/<编号>`：返回经完整校验的修订及绑定原诊断，供载入和导出；编号仅接受 32 位小写十六进制。
- `POST /api/verifications`：仅接受 `{"revisionId":"32位小写十六进制编号","tests":[{"id":"public_1","stdin":"","expectedStdout":"3\n"}],"confirmed":true}`；拒绝任意 `source`、`image`、`command`、路径及额外字段，源码来自已保存修订。
- `GET /api/verifications`：`{verifications, unreadable, busy}`，最近 20 次验证的精简身份、结果及当前服务活跃状态，不在索引重复返回源码。
- `GET /api/verifications/<编号>`：重新校验原请求与完整记录绑定后返回 JSON；没有结束记录时只返回正在处理或状态待确认，不伪造结果。

除健康读取外，API 要求本次服务 token；验证本地主机和来源，不允许跨来源预检授权。编译请求最多 1 KiB；检索 HTTP 请求最多 2 MiB 加 16 KiB，其中诊断记录仍受 2 MiB 限制、查询不超过 2,000 个 JavaScript 字符单元。验证 HTTP 请求最多 1 MiB，解码后仍限制 1 至 8 个唯一编号的公开测试、每项 stdin 4 KiB 和期望 stdout 16 KiB；大小按 UTF-8 字节检查。所有进程使用独立参数数组，禁止 shell 拼接；浏览器中源码或诊断文本仅以文本方式展示。

修订 HTTP 请求和完整记录上限为 `2 MiB + 6 × 64 KiB + 4 KiB`，为受限源码的 JSON 转义预留空间；原诊断仍限 2 MiB、源码仍限 64 KiB 和 200 行。必须明确确认且与原诊断源码或文件名有变化，不允许夹带状态、路径字段。服务生成 `origin=manual`、`compileStatus=not_run`、`testStatus=not_run`、`execution.attempted=false`；这些状态在读取时再次验证。修订保存与编译任务分别管理，不能将存档成功视作编译成功。

导入限 UTF-8、`.cj`、64 KiB、200 行；单个导入记录最大 2 MiB。编辑器可以暂存超行数内容，下载前再次检查。导出诊断记录保留采集时的源码，当前副本要单独下载。哈希验证一致性，不是数字签名，导入文件中的生产者字段也不是来源认证。

## 离线文档检索与证据

当前使用 [SDK 1.0.5 官方文档固定提交](document-sources.md)中的 15 段中文原文。来源修订为 `f8f8cd75a336e23785a4c57bd6091b2adf1e0302`，快照为 `cangjie-1.0.5-f8f8cd75a336-zh-cn-core-01`，当前语料 SHA-256 为 `aea5e1dd984f73f607a41555ac590ffc4d1ce6627149b660f03fd449c40325c2`。只读本地 JSON，不请求外部模型服务或在线检索接口。

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

当前片段覆盖有限的基础类型、变量、作用域和函数规则；用户需要回看完整原文并结合源码核对。展示中文官方文档不等于已经生成中文诊断解释。检索本身不生成候选或执行程序；已保存人工修订的公开验证由独立入口负责，没有测量修复成功率。模型服务与预算尚未选定，优先完成离线功能。

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

上述段落描述原审核样例编译入口的开发故障保护：该入口仍不执行产物，日志文件在进程存活期间尚无操作系统级磁盘配额，原生 CLI 的直接子进程终止也不等于完整后代清理。新增修订公开验证采用另一条经核对资源限制的容器路径，超时先删除整个容器并核对清理，具体上限见[容器说明](sandbox.md)；两种入口都不能被描述为任意恶意代码的安全认证。

## 验证与后续

第十二轮新增 `tests/verification-service.test.mjs`、`tests/verification-report.test.mjs` 等服务、报告和 HTTP 契约检查，合成故障数据明确标识；真实 HTTP 验收由 `scripts/test-revision-verification-http.mjs` 在 Linux Docker 环境运行。同一份实际保存的人工修订分别使用正确期望 `3\n` 与错误期望 `4\n`，要求真实编译/执行后得到通过与输出不符，并检查原修订不变、历史读取、重启读取及授权拒绝。新增脚本已加入 CI；本轮提交前尚未运行当前 SHA 的 CI，不预称这两条路径已通过，实际结果见[进度](progress.md)和[提交记录](submissions.md)。

复现命令（先完成 SDK、原生核心和镜像构建）：

```bash
node scripts/test-revision-verification-http.mjs "$image" target/debug/doctor
```

以下是此前各轮已发生的检查，保留原有成功与失败，不作为第十二轮代码已经验收的替代证据。

Linux 的原生运行及完整 HTTP 链路已在[检查记录 39534258780](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39534258780)通过。0.3 新增的真实编译器启动失败及任务记录检查也在[39536799153](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39536799153)通过（提交 `882a53d`，当时为 32 项前端/接口检查；后续本地补充至 33 项）。自动检查只运行公开的自建开发输入，不访问保留测试或任何密钥，也不是 A/B 实验。

0.3 本地增加了失败持久化、取消竞态、服务中断、损坏与超大记录、写盘失败、HTTP 断连和目录边界检查；浏览器中也验证了一次真实 Windows 启动失败的详情展开与 JSON 导出。故障注入输入明确标识为测试，均不计入 A/B。

上一轮离线文档依据实际完成本机 `test-native.ps1`、`test-native.mjs`、`test-compiler.mjs`、`test-native-http.mjs` 和 `test-retrieval.mjs` 检查；后者核对三个真实开发诊断的原文引用、哈希、重复排序、无命中、HTTP 和 SDK 不匹配拒绝。`node --test tests/*.test.mjs` 共 42 项通过，对应提交 `df0d436` 的 [Linux CI 39777823451](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39777823451) 已成功。上一轮自动化预览停在旧连接失败页，未完成新增文档界面的操作验收，该限制保留在进度记录中。

上一轮页面拆分的 43 项本地检查通过；浏览器实际核验前进/后退、编辑与检索结果跨页保留、记录页刷新、历史载入返回诊断、真实审核样例编译、检索和两类 JSON 导出。记录页导入无效文件时错误直接可见，有效记录可重新载入；四页窄屏无横向溢出。对应提交 `3a53900` 的 [Linux CI 39780688125](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39780688125) 已通过，GitCode 与 GitHub 的远端 SHA 已核对一致。截图与问题修复过程见进度文件。

上一轮教程新增后，43 项本地检查、JavaScript 语法和 `git diff --check` 通过。实际从首页按指引选择类型不匹配、重新编译、点击第 2 行 24 列定位，并以空查询取得三条官方摘录；教程往返和浏览器后退保持检索结果。编辑副本后通过教程返回仍保留修改且编译禁用，恢复记录副本可继续操作。首页进入 `/tutorial`，教程刷新和四个功能页切换正确；FAQ 展开与功能入口可用。390、320 像素视口分别检查内容宽度和滚动宽度一致，五项导航在较窄尺寸自动换行。截图见[教程桌面](tutorial-preview.png)与[手机](tutorial-mobile.png)。对应提交 `d8ebb51` 的 [Linux CI 39784024066](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39784024066) 已成功，GitCode、GitHub 远端 SHA 已核对一致。这些仅是离线开发流程验收，不是学生试用或 A/B 结果。

本轮界面简化后，首次本地检查有一项仍匹配旧页面标题而失败，改为检查稳定的 `main-content` 入口后，43 项复测通过；`app.mjs`、`navigation.mjs` 语法及 `git diff --check` 通过。独立复核发现载入样例期间导入无效文件可能使加载状态残留，已在文件导入接管请求时清理加载状态并刷新控件。

新版浏览器实际复测通过：下拉选择正常样例后真实编译通过，仍显示行为未验证；历史详情刷新后保持展开，任务和诊断 JSON 下载后核对状态与未执行标记。无效诊断导入显示错误，有效记录可载入；源码菜单 Escape 关闭并返回焦点，源码导入、编辑后跨页保留、下载和恢复均通过。按报错和自定义关键词查询均返回三条文档，首条原文默认展开，其余折叠；关键词收起后仍显示自定义查询提示。临时未配置核心的服务中，环境详情自动展开、原因和检查入口可见，编译保持禁用。390/320 像素视口五页均无横向溢出，320 像素下源码菜单展开正常，880 像素下五项文字导航保留。新版[诊断](simplified-diagnostics.png)、[教程](simplified-tutorial.png)、[文档](simplified-documents.png)及[手机](simplified-mobile.png)截图已保存并目视检查。本轮为开发验收，不是学生试用或 A/B；当前提交 CI 待发布后独立核验。

布局简化的发布结果补记：`fb35346f6e3d48804ec491a46b53a829ff6c63db` 已核对 GitCode、GitHub 远端 `main` 均为该 SHA；对应 [Linux CI 39787334108](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39787334108) 成功。原有提交前“待核验”表述保留，具体提交和平台记录时间见[提交记录](submissions.md)。

本轮人工修改确认与修订已完成浏览器验收：审阅后再编辑会关闭差异并禁用确认；确认保存后，刷新页面及实际重启服务均能重新载入相同副本，JSON 导出核对了人工来源、未编译/未测试和未执行标记，原样例文件哈希保持不变。恢复原副本后仍可真实编译审核正常样例，行为测试未运行。未保存时切换样例并取消，编辑保留。

在独立临时服务注入 900 毫秒延迟及保存失败，实际确认了保存期间继续编辑保留新内容、保存先前审阅副本到列表，保存失败保留副本且不提示成功，载入期间继续编辑阻止旧结果覆盖。复核同时发现原有样例/文件读取可能覆盖随后输入，已使输入和恢复操作取消待处理载入。390/320 像素视口的诊断和记录页无横向溢出；[差异确认](revision-review.png)、[保存列表](revision-records.png)与[手机](revision-mobile.png)截图已保存并目视检查。

本轮 Windows SDK 1.0.5 的 `test-native-http.mjs` 与 `test-retrieval.mjs` 通过；JavaScript 语法及差异格式检查通过。完整本地套件 56 项，55 项通过、0 失败、1 项因 Windows 文件符号链接权限跳过，细节见[进度记录](progress.md)。最终重载页面与重启服务后，从修订恢复原诊断源码再检索，返回三条官方摘录。这些仍是开发验收，不是学生试用、修复成功率或 A/B；本次提交 CI 待发布后核验。

下一步：完成本轮真实 Linux HTTP 验收和界面检查后，继续完善部署配额、跨服务独占与遗留任务恢复，扩充公开开发案例并邀请实际用户试用。人工修改/公开测试报告已实现；模型候选、两轮修复、保留测试、冻结与 A/B 汇总仍未完成。模型服务与预算明确后再接 AI，详情持续记录在[进度文件](progress.md)。
