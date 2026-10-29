# Linux 容器与网页公开验证

更新：2026-10-23，第十二轮。独立开发 CLI 已接入显式启用的 Linux Web 修订验证：网页选择已保存副本、提交公开输入与期望输出，单独留存验证记录，导出 JSON/静态 HTML 报告。模型和正式 A/B 尚未接入。本机 Windows 没有可用 Docker/WSL，且原生启动再次 `0xC0000005`，当前只能保存修改和查看已有报告，不能执行容器验证。

前轮 [CI 39932727970](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39932727970) 已实际通过 7 项运行容器限制与清理检查、3 条仓颉编译/公开测试路径，代码版本为 `d576f1d`。首次 SDK 权限失败及修复过程保留在[进度记录](progress.md)。本轮新增 HTTP 验收已在提交 `83715cd` 的 [CI 39949690080](https://github.com/Frank72316/cangjie-code-doctor/actions/runs/39949690080) 实际通过，详细身份与结果见进度记录；合成检查另列。

## 实现与边界

CLI 输入单文件 `.cj` 和最多 8 个公开测试；Web 入口只接受已确认修订的编号和 1 至 8 个公开测试，从修订库读取源码。两者保存不可覆盖的任务目录，共用同一个容器执行层。编译在受限容器中完成；仓颉核心 `parse` 处理真实 cjc 诊断。编译成功且存在有界 ELF 产物后，每个公开测试启动全新容器，仓颉核心 `check-output` 在宿主逐字节比对捕获的 stdout 与期望值。期望值、仓库、模型凭据、保留测试及 Docker socket 均不挂载进容器。

`check-output` 只读取捕获文件，不在宿主执行候选产物。stdout 比对保留 CRLF、尾部换行及原始字节；stderr 单独记录，不参与期望 stdout 比较。退出非零、超时、输出超限和 OOM 都不能通过。编译失败时测试未运行；零个测试显示 `not_run`。工具异常、取消或容器清理失败记为 `tool_error`，不算候选成功或实验成绩。

镜像来自重新核验 SHA-256 的官方 SDK 1.0.5 归档。构建上下文只包含 SDK、固定 Dockerfile 和启动脚本。Ubuntu 22.04 标签在本次构建前解析为 digest，镜像实际 ID 与基础镜像 digest 写入构建 receipt；运行入口拒绝标签，只接受本地 `sha256:` 镜像 ID。apt 包版本尚未冻结，因此不同日期构建不承诺字节一致，正式实验前还需冻结整份镜像和配置。

## 当前限制

| 项目 | 编译 | 单个公开测试 |
| --- | --- | --- |
| 非 root 用户 | UID/GID 65534 | UID/GID 65534 |
| 网络、权限 | network none、cap-drop ALL、no-new-privileges、只读根、默认 seccomp | 相同 |
| 内存 / 交换空间 | 1 GiB / 不允许额外交换 | 512 MiB / 不允许额外交换 |
| CPU / 进程数 | 1 CPU / 128 | 1 CPU / 128 |
| 可写空间 | `/work` 128 MiB、`/tmp` 32 MiB、`/dev/shm` 16 MiB | `/work` 16 MiB，其余相同 |
| 文件与描述符 | 单文件 64 MiB、nofile 128、core 0 | 相同 |
| 超时与输出 | cjc 60 秒、诊断 1 MiB；产物传输最多 32 MiB | 3 秒、stdout+stderr 合计 64 KiB |
| 只读挂载 | 本任务的单个源码文件 | 本任务的单个产物文件 |

源码最多 64 KiB、200 行；每个 stdin 最多 4 KiB，期望 stdout 最多 16 KiB。`/tmp` 禁止执行，`/work` 允许运行编译工具的临时产物，但有容量限制。Docker 只连接固定本机 Unix socket。创建后与启动前核对 inspect 中实际限制和挂载；配置不符即拒绝启动。超时、取消和输出超限先删除整个命名容器，再终止 Docker 客户端，随后核查容器不存在。

报告中 `policy` 是声明配置，`inspection` 是实际快照。中止前快照可能仍显示 Running，清理结果 `removed:true` 才是当次确认容器已不存在的证据。编译 holder 最长 300 秒，候选程序额外有容器内 5 秒 watchdog。第十四轮增加同工作区的跨进程容器验证互斥与已登记资源恢复；创建状态不明、Docker 故障和证据冲突仍须人工核查，尚无全主机配额或生产部署保证。

非 root 容器仍可能连接 rootful Docker daemon，不能称为 rootless Docker。实际探针通过只证明这些开发检查在该主机生效，不等于任意恶意代码的安全认证。当前仅面向受控 Linux 开发/CI 环境与本地回环服务；Web 验证不提供无配置执行、任意命令、镜像选择或宿主产物执行能力。

## 复现

要求已有 Linux Docker Engine、本机 `/var/run/docker.sock`、cgroup v2、Node 22+ 和 util-linux 的 `flock`，工作区位于本机文件系统。NFS/CIFS 等共享盘锁语义不在当前验收范围。以下不安装 WSL、不修改 Windows。SDK 安装目的目录须为空：

```bash
bash scripts/install-ci-sdk.sh tmp/sdk-linux-1.0.5
source tmp/sdk-linux-1.0.5/cangjie/envsetup.sh
mkdir -p target/debug
cjc -p src -o target/debug/doctor --diagnostic-format=noColor
bash scripts/build-sandbox-image.sh tmp/sdk-linux-1.0.5/cangjie tmp/sandbox-image.json
image=$(node -p "JSON.parse(require('fs').readFileSync('tmp/sandbox-image.json','utf8')).image")
node scripts/test-public-verdict.mjs target/debug/doctor
node scripts/test-sandbox-isolation.mjs "$image" tmp/sandbox-isolation.json
node scripts/test-sandbox-verification.mjs "$image" target/debug/doctor
node scripts/test-sandbox-recovery.mjs "$image"
```

自己的公开开发请求可以保存为 `tmp/public-request.json`：

```json
{
  "source": {"name":"hello.cj","text":"main() { println(\"Hello\") }\n"},
  "tests": [{"id":"hello","stdin":"","expectedStdout":"Hello\n"}]
}
```

```bash
node scripts/sandbox-verify.mjs tmp/public-request.json "$image" target/debug/doctor
```

CLI 退出码：0 表示全部提供的公开测试通过；1 表示编译失败、测试失败或未提供测试；2 表示参数、环境或工具错误。报告只限本次公开输入，不能据此推断保留测试通过或程序对所有输入正确。CLI 不是 HTTP 服务，不接受用户命令、Docker 参数或输出路径字段。

## 显式启用网页修订验证

在以上 SDK、原生核心、镜像及容器限制检查已完成的 Linux 主机中启动：

```bash
DOCTOR_SANDBOX_IMAGE="$image" DOCTOR_BINARY="$(pwd)/target/debug/doctor" node scripts/preview.mjs
```

服务只监听 `127.0.0.1`。`DOCTOR_SANDBOX_IMAGE` 必须来自本地构建 receipt 的精确镜像 ID，不能填标签；运行时不拉取镜像。启动时先核对宿主 Doctor 0.3.0 能启动，再用无输入挂载的受限容器检查 SDK 1.0.5、实际资源限制和清理。未配置、探针失败或宿主非 Linux 时禁用执行，已有修订和验证报告仍可读取。四个审核样例的原编译入口保持原限制，不因配置镜像而接收任意源码或执行它的产物。

在网页“编译诊断”编辑源码并审阅确认保存后，进入“记录依据”选择该修订、填写公开测试并点“编译并验证这份修改”。`POST /api/verifications` 只接受 `revisionId`、`tests`、`confirmed:true`，不接受 `source`、镜像、命令、路径或额外字段。服务自行读取已保存修订，验证期间后续编辑不会改变本次输入。stdout 按原始字节比较，页面明确展示换行并提供追加一个 LF 的选项；公开输入不得填入保留测试或密钥。

每次 Web 验证在 `runs/revision-verifications/<验证编号>/` 保存独立请求及结束记录，完整嵌入所选修订和公开测试；不会更改原诊断或修订的未编译/未测试标记。JSON 完整保留输入、身份、哈希、逐项结果与容器证据，HTML 提供可离线打开的源码差异、编译和公开测试可读报告，无脚本和远程资源。两种报告保留已保存修订中显式附带的原诊断文档依据，只覆盖此次人工修改与公开测试，不是模型修复或正式实验报告。（2026-10-30 更正：原句“文档依据未合并”已过时，第十六轮已实现显式附带。）

缺少结束记录时保持“状态待确认”；当前服务活跃任务才显示正在验证。报告损坏或与初始请求不一致不能显示成功。清理失败禁用后续验证；重新检查环境须先持锁完成下述恢复核查，重启本身不能证明清理成功。界面在现有环境提示中显示恢复数量；缺失的旧测试结果不补写、不自动重跑。历史读取失败可用原有刷新入口重试，保留当前测试草稿。

## 跨进程互斥与受控恢复

Linux 探针和公开验证共用 `runs/.doctor-execution.lock` 的稳定文件 FD，通过 `flock` 非阻塞独占。同一规范工作区的其他服务/CLI 得到占用错误，不抢锁、不终止原任务；不同工作区独立。Docker 客户端继承该 FD，父 Node 进程突然退出时，仍在运行的客户端继续持锁，直到自身关闭。释放只关闭 FD，不显式解锁、不删除或重命名锁文件。不要手动删除锁文件；锁是协作式互斥，不能抵抗有写权限的外部程序破坏目录。

`runs/sandbox-lifecycle/<operationId>/` 保存容器创建前的不可变 intent、创建尝试/已确认 ID 或未启动证据、清理 receipt；逐份独占写入并同步文件及 Linux 目录。源码不写入生命周期日志。Docker 标签绑定规范工作区哈希和随机 operation ID，随机容器名也记入 intent。正常清理与恢复都先核对名称、镜像、归属标签和已知完整 ID，再按检查到的完整 ID 删除；核对 ID 与名称均不存在后才登记完成，不按 `doctor-` 前缀遍历删除，不调用 `docker prune`。

恢复先校验完整日志再处理未清理条目。记录损坏、链接、归属冲突、Docker 连接失败、删除失败均停止执行，保留证据。创建尝试后未取得可靠完成证据时，一次 inspect 缺失不足以排除 daemon 迟到创建，须保持阻断并人工核查；不能为解除阻断伪造 receipt。已有匹配对象则核对归属并按完整 ID 清理。已确认的创建也须核对记录 ID，拒绝同名替换对象。该机制不处理迁移前无日志的容器，也不自动完成旧任务报告。

扫描设有上限：10000 个 operation、每个 160 个文件、总计 100000 个 intent、单记录 4 KiB，超过上限停止执行并提示人工核查归档。它是有界读取保护，不是累计磁盘配额；自动归档、多用户调度和跨工作区总资源限制仍待实现。只读报告在执行禁用时仍可访问。

实际故障验收脚本 `test-sandbox-recovery.mjs` 在独立工作区启动真实容器、强制终止持锁 Node 服务，验证另一个进程先被拒绝、重启后只清理登记对象，并保留另一工作区的运行容器。Node 套件另验证父进程死亡及真实 `runSandboxProcess` 子进程继承锁。测试不声称复现了所有 Docker daemon 故障或断电情形。

本轮实际 HTTP 验收入口：

```bash
node scripts/test-revision-verification-http.mjs "$image" target/debug/doctor
```

该脚本保存一份人工修订，再通过真实 HTTP 入口验证正确期望与故意错误期望两条路径，检查通过/不符区分、原修订不变、报告读取、服务重启后读取、请求授权与额外源码拒绝。提交 `83715cd` 的 CI 已实际通过两条路径，并确认原修订不变、重读正常和全部容器清理；两条路径来自同一公开开发修订，不是两个独立评估案例。

## 留痕与验收

`runs/verification/<随机编号>/` 保存 request、源码、编译 stdout/stderr、产物、各测试原始 stdout/stderr/expected 和最终 `report.json`。记录包含来源哈希、SDK 与镜像身份、实际退出码、容器限制和清理结果。写盘失败不得返回成功；接收后缺最终 report 的目录应视为未完成，不能从残留产物猜测通过。`runs/` 持续忽略，不自动上传用户源码。

实际容器探针包含权限/只读/断网/cgroup、临时盘满、进程上限、OOM、超时、输出洪泛和取消清理；后三类必须确认容器不存在。实际仓颉检查是正常程序通过、故意错误的期望值失败、类型错误跳过测试。它们都是公开开发验收；Node 故障注入套件与实际容器运行分开记录，没有独立评估案例或 A/B 数据。

CI 摘要保存构建身份、资源探针、容器公开验收、进程中断恢复和 Web 修订 HTTP 验收 receipt；具体版本、成功或失败及本机限制见[进度](progress.md)、[提交记录](submissions.md)。网页修订接入、人工修改/公开测试报告及登记资源恢复已实现；部署配额、自动归档、评估数据冻结、模型候选与正式 A/B 报告仍需后续完成。

参考：[Docker 运行参数](https://docs.docker.com/engine/containers/run/)、[资源限制](https://docs.docker.com/engine/containers/resource_constraints/)、[Docker 安全边界](https://docs.docker.com/engine/security/)、[flock 命令](https://man7.org/linux/man-pages/man1/flock.1.html)、[flock 文件描述符语义](https://man7.org/linux/man-pages/man2/flock.2.html)。
