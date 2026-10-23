# Linux 容器公开测试开发入口

更新：2026-10-23。当前是独立开发 CLI，尚未接入网页或正式 A/B。本机 Windows 没有可用 Docker/WSL，实际资源与仓颉容器验收在已有 Linux CI 完成后，以对应 SHA 的运行记录为证据；提交前不预称通过。

## 实现与边界

输入单文件 `.cj` 和最多 8 个公开测试，保存不可覆盖的任务目录。编译在受限容器中完成；仓颉核心 `parse` 处理真实 cjc 诊断。编译成功且存在有界 ELF 产物后，每个公开测试启动全新容器，仓颉核心 `check-output` 在宿主逐字节比对捕获的 stdout 与期望值。期望值、仓库、模型凭据、保留测试及 Docker socket 均不挂载进容器。

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

报告中 `policy` 是声明配置，`inspection` 是实际快照。中止前快照可能仍显示 Running，清理结果 `removed:true` 才是当次确认容器已不存在的证据。编译 holder 最长 300 秒，候选程序额外有容器内 5 秒 watchdog，降低宿主 CLI 突然退出后持续运行的风险；突然断电、Docker daemon 故障和清理请求失败仍需人工核查。尚无跨进程任务配额、自动遗留容器回收或生产部署保证。

非 root 容器仍可能连接 rootful Docker daemon，不能称为 rootless Docker。实际探针通过只证明这些开发检查在该主机生效，不等于任意恶意代码的安全认证。暂只在受控 Linux 开发/CI 环境运行公开开发输入，未开放 Web 任意代码执行。

## 复现

要求已有 Linux Docker Engine、本机 `/var/run/docker.sock`、cgroup v2 和 Node 22+。以下不安装 WSL、不修改 Windows。SDK 安装目的目录须为空：

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

## 留痕与验收

`runs/verification/<随机编号>/` 保存 request、源码、编译 stdout/stderr、产物、各测试原始 stdout/stderr/expected 和最终 `report.json`。记录包含来源哈希、SDK 与镜像身份、实际退出码、容器限制和清理结果。写盘失败不得返回成功；接收后缺最终 report 的目录应视为未完成，不能从残留产物猜测通过。`runs/` 持续忽略，不自动上传用户源码。

实际容器探针包含权限/只读/断网/cgroup、临时盘满、进程上限、OOM、超时、输出洪泛和取消清理；后三类必须确认容器不存在。实际仓颉检查是正常程序通过、故意错误的期望值失败、类型错误跳过测试。它们都是公开开发验收；Node 故障注入套件与实际容器运行分开记录，没有独立评估案例或 A/B 数据。

CI 摘要保存构建身份、资源探针与公开验收 receipt；具体版本、成功或失败及本机限制见[进度](progress.md)、[提交记录](submissions.md)。完整修复报告、网页修订接入、评估数据冻结和模型流程仍需后续实现。

参考：[Docker 运行参数](https://docs.docker.com/engine/containers/run/)、[资源限制](https://docs.docker.com/engine/containers/resource_constraints/)、[Docker 安全边界](https://docs.docker.com/engine/security/)。
