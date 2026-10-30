# 界面素材来源

本批素材于 **2026-10-30（北京时间）** 获取，用于 Doctor 手绘笔记本界面。浏览器只使用本地 SVG 和一个 WOFF2 字体文件，不加载素材站脚本、CDN 或在线字体；Rough.js 只用于开发时生成静态 SVG。页面署名见 [本地素材页](../web/assets/credits.html)。

## 固定来源与许可

| 素材 | 固定来源 | 许可与本地文件 | 改动 |
| --- | --- | --- | --- |
| Phosphor Icons，14 个 Duotone 图标 | [phosphor-icons/core，2b75f3ad12b420c9504ef05df8d2564a28f8500e](https://github.com/phosphor-icons/core/tree/2b75f3ad12b420c9504ef05df8d2564a28f8500e)，`assets/duotone/<name>-duotone.svg` | [MIT 原文](../web/assets/licenses/phosphor-MIT.txt) | 原始 SVG 保存在 `web/assets/phosphor/`；路径与透明度整理进 `doctor-icons.svg`，每个 symbol 使用原始 `0 0 256 256` viewBox、`currentColor` 填充及无描边。未改图标几何。 |
| Mega Doodles Pack，书本/铅笔/灯泡 | [MariaLetta/mega-doodles-pack，4383d4323ddf11d79523ae9ee961ab5a08283d0d](https://github.com/MariaLetta/mega-doodles-pack/tree/4383d4323ddf11d79523ae9ee961ab5a08283d0d)，具体路径见下表 | **CC BY-SA 4.0**，作者 **Maria Letta**；[完整许可](../web/assets/licenses/mega-doodles-CC-BY-SA-4.0.txt) | 使用原始 SVG 文件，原色和图形均未修改，只更改本地文件名。 |
| JetBrains Mono Regular | [JetBrains/JetBrainsMono，19371302b95d218af43299bce79ddbddd0bc364d](https://github.com/JetBrains/JetBrainsMono/tree/19371302b95d218af43299bce79ddbddd0bc364d)，`fonts/webfonts/JetBrainsMono-Regular.woff2` | [SIL Open Font License 1.1 原文](../web/assets/licenses/jetbrains-mono-OFL.txt)，The JetBrains Mono Project Authors | 二进制未经修改，只将本地文件名规范为 `jetbrains-mono-regular.woff2`。 |
| Rough.js 4.6.6，开发生成工具 | [rough-stuff/rough，发布来源 56a2762171b1294d643501e8d14f120db6b27bd7](https://github.com/rough-stuff/rough/tree/56a2762171b1294d643501e8d14f120db6b27bd7)，完整包地址与完整性见 [`SOURCE.json`](../scripts/vendor/rough/SOURCE.json) | [MIT 原文](../web/assets/licenses/rough-MIT.txt)，Preet Shihn 与贡献者 | 工具 bundle 未修改，仅在开发时由本项目生成脚本调用。`web/assets/sketch/` 是为 Doctor 绘制的原创组合，不是从 Rough.js 仓库下载的现成插画。浏览器不运行该库。 |

Mega Doodles Pack 的许可核对自作者固定版本的 [`README.md`](https://github.com/MariaLetta/mega-doodles-pack/blob/4383d4323ddf11d79523ae9ee961ab5a08283d0d/README.md)，完整许可下载自 [Creative Commons 官方文本](https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt)。这三张插画继续按 CC BY-SA 4.0 提供；后续对插画进行改编并分享时须遵守该许可的相同方式共享要求。署名不表示原作者认可或参与本项目。

## 手绘插画对应

选材时实际查看了作者整套预览和带编号 PNG 缩略图，核对书本、铅笔、灯泡的形状后选取对应 SVG。

| 本地文件 | 原始 SVG 与逐个出处 | 字节数 |
| --- | --- | --- |
| `doodles/book.svg` | [蓝色书本，doodles/svg/doodle-45.svg](https://github.com/MariaLetta/mega-doodles-pack/blob/4383d4323ddf11d79523ae9ee961ab5a08283d0d/doodles/svg/doodle-45.svg) | 9,513 |
| `doodles/pencil.svg` | [黄色铅笔，doodles/svg/doodle-68.svg](https://github.com/MariaLetta/mega-doodles-pack/blob/4383d4323ddf11d79523ae9ee961ab5a08283d0d/doodles/svg/doodle-68.svg) | 6,227 |
| `doodles/lightbulb.svg` | [蓝色灯泡，doodles/svg/doodle-122.svg](https://github.com/MariaLetta/mega-doodles-pack/blob/4383d4323ddf11d79523ae9ee961ab5a08283d0d/doodles/svg/doodle-122.svg) | 7,143 |

编程桌面、纸张纹理、手绘边框/箭头/下划线由 [`scripts/generate-sketch-assets.mjs`](../scripts/generate-sketch-assets.mjs) 使用 Rough.js 4.6.6 和固定种子生成，原始组合图的结构写在生成脚本内。可以运行 `node scripts/generate-sketch-assets.mjs --check` 检查静态产物是否与生成结果一致。Rough.js 依赖与许可保存在 `scripts/vendor/rough/`，不作为 Web 路由提供。

## 图标对应

| 本地 symbol | Phosphor 原图标 |
| --- | --- |
| `i-guide` | compass |
| `i-code` | code |
| `i-book` | book-open |
| `i-record` | file-text |
| `i-history` | clock-counter-clockwise |
| `i-upload` | upload-simple |
| `i-download` | download-simple |
| `i-shield` | shield-check |
| `i-info` | info |
| `i-refresh` | arrow-clockwise |
| `i-monitor` | desktop |
| `i-arrow-right` | arrow-right |
| `i-search` | magnifying-glass |
| `i-check` | check-circle |

页面通过同源 `/assets/doctor-icons.svg#<symbol>` 使用图标。插画和纹理仅作装饰；图标不替代按钮或导航的可读文字。代码字体不覆盖中文正文。

## 清单与验证范围

- [`web/assets/manifest.json`](../web/assets/manifest.json) 保存素材和工具的固定源版本、图标对应关系，以及除清单自身外每个资产文件的字节数与 SHA-256；清单不作为运行时依赖。
- 图标 sprite 为 **6,333 字节**，三张原始贴纸合计 **22,883 字节**，Regular WOFF2 为 **92,380 字节**。
- 已检查 SVG 可解析为 XML，图标 symbol 数为 14，所选素材 SVG 不含脚本、事件处理属性或外链引用；字体文件头为 `wOF2`。下载的插画没有作为程序执行；Rough.js 的开发时运行与静态产物检查由该生成工具单独记录。
- 此处仅记录素材来源与静态检查。页面实际布局、字体渲染、交互和提交结果由本轮界面验收与进度记录另行登记，不把素材检查写成完整功能验证。

以后更新素材时应重新固定官方版本、保留相应许可、核对修改说明并重算清单，不直接替换为未记录的 CDN 链接。
