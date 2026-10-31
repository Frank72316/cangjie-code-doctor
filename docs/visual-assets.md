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

- [`web/assets/manifest.json`](../web/assets/manifest.json) 保存默认手绘版素材和工具的固定源版本、图标对应关系，以及该批资产文件的字节数与 SHA-256；不包含下述独立 `voxel/` 试稿目录，清单不作为运行时依赖。
- 图标 sprite 为 **6,333 字节**，三张原始贴纸合计 **22,883 字节**，Regular WOFF2 为 **92,380 字节**。
- 已检查 SVG 可解析为 XML，图标 symbol 数为 14，所选素材 SVG 不含脚本、事件处理属性或外链引用；字体文件头为 `wOF2`。下载的插画没有作为程序执行；Rough.js 的开发时运行与静态产物检查由该生成工具单独记录。
- 此处仅记录素材来源与静态检查。页面实际布局、字体渲染、交互和提交结果由本轮界面验收与进度记录另行登记，不把素材检查写成完整功能验证。

以后更新素材时应重新固定官方版本、保留相应许可、核对修改说明并重算清单，不直接替换为未记录的 CDN 链接。

## 独立方块试稿（2026-10-31）

本批仅供 `node scripts/preview-voxel.mjs` 启动的 `8766` 设计试稿，默认网站不加载。素材是 Kenney 原创方块视觉，不是从 Minecraft 游戏提取的资源；原始 PNG/WOFF2/许可保持字节不变，场景与书本由项目 CSS 组合。试稿仍沿用原 Phosphor 图标和 JetBrains 代码字体，正文使用系统字体。

| 素材 | 来源与许可 | 使用方式 |
| --- | --- | --- |
| Voxel Pack | [Kenney 作者发布页](https://opengameart.org/content/voxel-pack)，CC0；[原始许可](../web/assets/voxel/kenney-voxel-license.txt) | 草顶/草侧、石头、钻石矿、木材与铁镐，128×128 PNG。CSS 三面组合构成草地岛，木材用于工作台与书本。包内另保留泥土纹理供试稿选择。 |
| Pixel UI Pack | [Kenney 作者发布页](https://opengameart.org/content/pixel-ui-pack-750-assets)，Kenney Vleugels / Lynn Evers，CC0；[原始许可](../web/assets/voxel/kenney-pixel-ui-license.txt) | 灰/绿按钮与按下状态使用 CSS 九宫格边框，48×48 PNG；另保留灰面板供试稿选择。 |
| Fusion Pixel | [TakWolf 官方 2026.10.25 发布](https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.10.25)，SIL OFL 1.1 | 12px 比例简体中文 Regular 原始 WOFF2，701,520 字节，未裁剪；主许可与三份上游许可都保留在 `fonts/`。只用于品牌、标题与少量导航，代码和正文保持易读字体。 |

[素材署名页](../web/assets/voxel/credits.html)、[包来源与 ZIP 哈希](../web/assets/voxel/SOURCE.json)、[字体固定版本与哈希](../web/assets/voxel/fonts/SOURCE.json) 均保存在仓库。[manifest.json](../web/assets/voxel/manifest.json) 初版覆盖 23 个文件，第二十二轮补材后为 28 个，第二十三轮补充物品与许可后覆盖 **36 个文件**，排除清单自身。原 12 张 PNG 共 28,891 字节，第二十二轮 5 张共 17,124 字节，第二十三轮 5 张共 1,603 字节，全部 22 张合计 47,618 字节。清单与主程序、截图分别管理。

浏览器仅请求本地资源；静态服务器对预览素材使用精确允许列表，未开放任意目录读取。实际视觉与响应式检查见[第二十一轮进度](progress.md)。

第二十二轮根据用户反馈补充侧栏独立材质，避免重复右侧草地/木材/石头。以下为当时的对应关系，**第二十三轮导航已由下文的物品图标替换**；雪与水仍用于小景，其他保留为有来源记录的备选。它们均来自上表同一个固定 Voxel ZIP、CC0 许可，保持 128×128 原始 PNG 字节；各项哈希已加入来源与清单。

| 侧栏入口 | 本地文件 | 原包路径 |
| --- | --- | --- |
| 使用教程 | `nav-sand.png` | `PNG/Tiles/sand.png` |
| 编译诊断 | `nav-brick.png` | `PNG/Tiles/brick_red.png` |
| 文档依据 | `nav-snow.png` | `PNG/Tiles/snow.png` |
| 记录依据 | `nav-gold.png` | `PNG/Tiles/stone_gold.png` |
| 任务历史 | `nav-water.png` | `PNG/Tiles/water.png` |

立体小方块、侧栏雪地小景与标题装饰由 CSS 组合，新增纹理没有用于表示诊断或测试成功。原 Phosphor 导航图形在独立试稿中由装饰方块替换，文字与无障碍名称保留；默认工作台仍使用原图标。标题、边饰沿用原纹理，木材仅用于雪景树干。布局验收见[第二十二轮进度](progress.md)。

## 功能物品导航（第二十三轮，2026-10-31）

用户要求物品图标对应功能，记录依据使用附魔书。最终采用 [Pixel Perfection CE 固定提交](https://github.com/Athemis/PixelPerfectionCE/tree/28e38cab7c1f03f86364ef704f705bebcc13cb3d)，作者 **XSSheep 与社区贡献者**，许可 **CC BY-SA 4.0**。保留原始 [LICENSE.md](../web/assets/voxel/items/LICENSE.md)、[README.md](../web/assets/voxel/items/README.md) 与 [SOURCE.json](../web/assets/voxel/items/SOURCE.json)。这些是作者资源包的贴图，不是从游戏安装文件提取的资源；作者声明、原路径、Git blob 与 SHA-256 均已记录。

| 页面 | 图标与本地文件 | 固定版本原路径（均在 `assets/minecraft/textures/item/`） |
| --- | --- | --- |
| 使用教程 | 罗盘，`items/compass.png` | `compass_16.png` |
| 编译诊断 | 铁镐工具，`items/pickaxe.png` | `iron_pickaxe.png` |
| 文档依据 | 普通书，`items/book.png` | `book.png` |
| 记录依据 | 附魔书，`items/enchanted-book.png` | `enchanted_book.png` |
| 任务历史 | 时钟，`items/clock.png` | `clock_00.png` |

五张原图均为 16×16，合计 1,603 字节；浏览器放大为 32×32 并使用像素渲染，未改变 PNG 字节。时钟与罗盘是固定帧，不展示真实时间或方位。附魔书原图为棕红书封，紫色槽底、光点与光晕由项目 CSS 实现，不是资源包自带动画。选定贴图继续按 CC BY-SA 4.0 提供；如后续改编分享，应继续署名并遵守相同方式共享要求。署名不表示作者参与或认可本项目。
