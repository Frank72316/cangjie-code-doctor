# 中期演示与截图

按用户确认的「只用PPT展示，不现场运行」准备。界面在本机截图，运行记录须保留真实时间、环境与提交，不把回看称为即时运行。AI仅展示配置设计。

## 正式入口

在仓库运行 `./scripts/start-workbench.ps1 -SdkRoot D:\Cangjie`，访问 `http://127.0.0.1:8765/tutorial`。正式方块主题连接本地服务；8766仍是只读试稿。端口占用时正常停止对应旧服务，不批量终止进程。Linux构建并加载SDK后可运行 `DOCTOR_WORKBENCH_THEME=voxel node scripts/preview.mjs`。

2026-11-16本机重建成功，但Doctor运行退出0xC0000005，未发现可用WSL/Docker。本机可读取历史、保存人工修改，不能实时编译、检索或运行测试。本轮没有修改系统更新或SDK基线。

## 真实案例采集

在已配置的Linux开发环境运行：

```bash
node scripts/capture-midterm-demo.mjs target/debug/doctor "$(command -v cjc)" "$DOCTOR_SANDBOX_IMAGE"
```

使用公开开发例type_mismatch：HTTP真实编译报错→SDK 1.0.5文档检索→固定修正 `"three"` 为 `3` →确认保存→受限容器公开测试（空输入，输出 `3\n`）→读取历史、修订与验证，确认原诊断未改写。脚本调用确认接口，是开发流程验收，不是学生操作、AI修复、保留测试或正式A/B。

每次生成独立 `runs/midterm-demo/<id>/`，包含总览index.html、初始诊断01-diagnosis.json、文档02-document-evidence.json、修订03-revision.json/html、验证04-verification.json/html和manifest.json。清单保留时间、版本、平台链接、步骤标识与文件哈希；全部断言通过才标记passed，失败保留错误。修订自身仍标记未验证，测试结论保存在独立验证报告中。

CI自动采集并上传midterm-development-evidence制品（保留30天，应及时下载本机备份）。Linux记录在Windows打开仍是历史回看。HTML可离线打开，初始诊断可在工作台「记录依据」导入。

## PPT截图顺序

1. 正式工作台和功能入口，说明本组的诊断—修改—验证定位。
2. 导入本次真实诊断，展示第2行错误定位；配文标明Linux运行日期。
3. 修改报告展示字符串改为整数、官方文档引用与源码摘要；交互由用户确认，采集脚本演练同一接口。
4. 独立验证报告展示编译、公开输出比对、容器与清理结果。一个公开测试通过不证明所有输入正确。
5. 阶段边界：AI未接入、正式案例未齐全，工具检查与后续A/B分别汇报。

截图保留历史记录、未验证等关键状态。组员应解释模块与证据，不将Codex辅助产出记为个人独立贡献。
