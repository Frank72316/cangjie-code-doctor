// Optional visual preview. The default workbench does not load these assets.
export const voxelRoutes = [
  ['/voxel-preview.css', ['web/voxel-preview.css', 'text/css; charset=utf-8']],
  ['/assets/voxel/credits.html', ['web/assets/voxel/credits.html', 'text/html; charset=utf-8']],
  ...[
    ['credits.css', 'text/css; charset=utf-8'],
    ...['grass-top', 'grass-side', 'dirt', 'stone', 'wood', 'diamond-ore', 'pickaxe', 'ui-grey', 'ui-green', 'ui-grey-pressed', 'ui-green-pressed', 'ui-panel', 'nav-sand', 'nav-brick', 'nav-snow', 'nav-water', 'nav-gold'].map(name => [`${name}.png`, 'image/png']),
    ['fonts/fusion-pixel-12px-proportional-zh_hans.otf.woff2', 'font/woff2'],
    ...['SOURCE.json', 'manifest.json', 'fonts/SOURCE.json'].map(name => [name, 'application/json; charset=utf-8']),
    ...['kenney-voxel-license.txt', 'kenney-pixel-ui-license.txt', 'fonts/OFL.txt', 'fonts/LICENSES/ark-pixel/OFL.txt', 'fonts/LICENSES/cubic-11/OFL.txt', 'fonts/LICENSES/galmuri/LICENSE.txt'].map(name => [name, 'text/plain; charset=utf-8']),
  ].map(([file, type]) => [`/assets/voxel/${file}`, [`web/assets/voxel/${file}`, type]]),
];

const cube = (position, material = 'grass') => `<span class="block block-${position} block-${material}"><i class="block-top"></i><i class="block-left"></i><i class="block-right"></i></span>`;
// Decorative cubes keep navigation names and status text independent of the artwork.
const miniCube = material => `<span class="voxel-cube voxel-cube-${material}" aria-hidden="true"><i class="cube-top"></i><i class="cube-left"></i><i class="cube-right"></i></span>`;
const navMaterials = {tutorial:'nav-sand', diagnostics:'nav-brick', documents:'nav-snow', records:'nav-gold', history:'nav-water'};
const headingMaterials = {'GETTING STARTED':'grass', DIAGNOSE:'ore', REFERENCE:'wood', RECORD:'stone', 'TASK HISTORY':'dirt'};
const sidebarGarden = `<div class="voxel-sidebar-garden" aria-hidden="true"><span class="garden-ground garden-rear">${miniCube('nav-snow')}</span><span class="garden-tree"><i class="tree-trunk"></i><span class="tree-crown">${miniCube('nav-snow')}</span></span><span class="garden-ground garden-left">${miniCube('nav-water')}</span><span class="garden-ground garden-front">${miniCube('nav-snow')}</span><span class="garden-ground garden-right">${miniCube('nav-snow')}</span><i class="garden-flower"></i></div>`;
const landscape = `<figure class="voxel-scene" aria-label="草地方块、矿石和工作台组成的小岛插画">
  <div class="voxel-sky" aria-hidden="true"><span class="pixel-cloud cloud-one"></span><span class="pixel-cloud cloud-two"></span><span class="pixel-sun"></span></div>
  <div class="voxel-island" aria-hidden="true">
    ${cube('a')}${cube('b')}${cube('c')}${cube('d', 'stone')}${cube('e')}${cube('f')}${cube('g')}
    <span class="voxel-workbench"><span class="workbench-screen">&lt;/&gt;</span><span class="workbench-base"></span></span>
    <span class="voxel-sprout sprout-one"></span><span class="voxel-sprout sprout-two"></span>
    <span class="voxel-gem"></span>
  </div>
  <figcaption><span aria-hidden="true">◆</span> 一条报错，一条新线索</figcaption>
</figure>`;

export function applyVoxelTheme(html) {
  return html
    .replace('</head>', '<link rel="stylesheet" href="/voxel-preview.css"></head>')
    .replace(/<body data-page="([a-z]+)">/, '<body data-page="$1" data-theme="voxel">')
    .replace(/(<a class="nav-item[^>]*href="\/([a-z]+)"[^>]*>)<svg[^>]*>[\s\S]*?<\/svg>/g, (match, link, page) => navMaterials[page] ? link + miniCube(navMaterials[page]) : match)
    .replace('<div class="sidebar-bottom">', `<div class="sidebar-bottom">${sidebarGarden}`)
    .replace(/<p class="eyebrow">([^<]+)<\/p>/g, (match, label) => headingMaterials[label] ? `<p class="eyebrow"><span class="voxel-heading-blocks" aria-hidden="true">${miniCube(headingMaterials[label])}${miniCube('stone')}</span>${label}</p>` : match)
    .replace('本地运行 · 副本编辑', '方块风格 · 独立预览')
    .replace('<main id="main-content" tabindex="-1">', '<main id="main-content" tabindex="-1"><div class="voxel-preview-note">设计试稿 <span>可切换五个页面、查看和编辑样例；编译与保存请回到原工作台。</span><a href="http://127.0.0.1:8765/tutorial">原工作台 ↗</a></div>')
    .replace('DOCTOR / 你的程序诊断手记', 'DOCTOR / 方块工作台')
    .replace('带上好奇心就好。从一个小样例开始，读报错、找位置，再翻一翻官方文档。', '从一个小样例开始。读懂报错，定位代码，再找到有依据的修改方向。')
    .replace(/<figure class="sketch-scene"[\s\S]*?<\/figure>/, landscape)
    .replace('进入后选择样例，再点击“编译所选样例”。', '先预览诊断页，熟悉从报错到定位的过程。')
    .replace('/assets/doodles/pencil.svg', '/assets/voxel/pickaxe.png')
    .replace('/assets/doodles/lightbulb.svg', '/assets/voxel/diamond-ore.png')
    .replace('<img src="/assets/doodles/book.svg" alt="" width="46" height="46">', '<span class="pixel-book"></span>')
    .replace('href="/assets/credits.html"', 'href="/assets/voxel/credits.html"');
}
