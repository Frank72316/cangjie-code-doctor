// Development-only authoring. Browser pages use the generated static SVG files.
// Rough.js 4.6.6 source, integrity and MIT notice: ./vendor/rough/SOURCE.json.
import rough from './vendor/rough/rough.cjs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const output = fileURLToPath(new URL('../web/assets/sketch/', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node scripts/generate-sketch-assets.mjs [--check]');
const ink = '#3c403b';
const orange = '#d27a53';
const yellow = '#f2df9b';
const green = '#b9cbb4';
const paper = '#fffdf5';
const generator = rough.generator();
let seed = 4100;

const options = extra => ({
  seed: ++seed, stroke: ink, strokeWidth: 1.8, roughness: .65, bowing: .6,
  fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.5,
  disableMultiStrokeFill: true, ...extra,
});
const num = value => Number(value.toFixed(2));
const compactPath = value => value.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, match => num(Number(match)));
const draw = drawable => generator.toPaths(drawable).map(path =>
  `<path d="${compactPath(path.d)}" stroke="${path.stroke}" stroke-width="${num(path.strokeWidth)}" fill="${path.fill}"/>`
).join('\n');
const path = (d, extra) => draw(generator.path(d, options(extra)));
const line = (x1,y1,x2,y2,extra) => draw(generator.line(x1,y1,x2,y2, options(extra)));
const rect = (x,y,w,h,extra) => draw(generator.rectangle(x,y,w,h,options(extra)));
const polygon = (points,extra) => draw(generator.polygon(points,options(extra)));
const circle = (x,y,d,extra) => draw(generator.circle(x,y,d,options(extra)));
const curve = (points,extra) => draw(generator.curve(points,options(extra)));
const group = (transform,content) => `<g transform="${transform}">\n${content.join('\n')}\n</g>`;
const svg = (width,height,title,parts) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`+
  `<title>${title}</title>\n<!-- Original Doctor artwork. Generated deterministically with Rough.js 4.6.6; see scripts/generate-sketch-assets.mjs. -->\n`+
  `<g stroke-linecap="round" stroke-linejoin="round">\n${parts.join('\n')}\n</g>\n</svg>\n`;

// Quiet, sparse desk composition. Object outlines stay distinct at small sizes.
const hero = [];
hero.push(curve([[54,340],[188,343],[376,340],[551,342]], {stroke:'#a2a497',strokeWidth:1.25,roughness:.5}));

// Closed notebook to the left of the laptop; the spine and paper edge add depth.
hero.push(group('rotate(-8 91 278)', [
  rect(48,239,86,83,{fill:paper,fillStyle:'solid',roughness:.45}),
  rect(46,231,85,82,{fill:green,fillWeight:2,hachureGap:7}),
  line(59,233,59,311,{strokeWidth:1.1,roughness:.3}),
  line(65,319,132,319,{stroke:'#929786',strokeWidth:1,disableMultiStroke:true}),
  line(73,256,111,256,{stroke:'#69735e',strokeWidth:1.5}),
  line(73,265,103,265,{stroke:'#69735e',strokeWidth:1.5}),
]));

// Laptop shell, pale screen, two code brackets and a few deliberately short lines.
hero.push(rect(143,79,294,205,{fill:green,hachureGap:7,strokeWidth:2,roughness:.6}));
hero.push(rect(158,94,264,169,{fill:paper,fillStyle:'solid',strokeWidth:1.4,roughness:.45}));
hero.push(line(160,119,420,119,{stroke:'#b5b7a8',strokeWidth:1,disableMultiStroke:true,roughness:.25}));
hero.push(circle(171,108,3.3,{fill:orange,fillStyle:'solid',stroke:'none',roughness:.3}));
hero.push(circle(181,108,3.3,{fill:yellow,fillStyle:'solid',stroke:'none',roughness:.3}));
hero.push(circle(191,108,3.3,{fill:green,fillStyle:'solid',stroke:'none',roughness:.3}));
hero.push(path('M200 145 L190 156 L200 167 M231 145 L241 156 L231 167 M221 141 L210 171', {stroke:orange,strokeWidth:2.3,roughness:.45,disableMultiStroke:true}));
hero.push(line(182,193,242,193,{stroke:'#7d8d73',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(line(254,193,317,193,{stroke:'#a2aa98',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(line(195,211,275,211,{stroke:'#c38d6e',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(line(287,211,365,211,{stroke:'#a5afa0',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(line(182,230,223,230,{stroke:'#8d9b84',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(line(237,230,296,230,{stroke:'#b4b9a9',strokeWidth:3,roughness:.45,disableMultiStroke:true}));
hero.push(circle(290,273,3,{fill:ink,fillStyle:'solid',stroke:'none',roughness:.3}));
hero.push(polygon([[143,285],[437,285],[474,318],[107,318]],{fill:paper,fillStyle:'solid',strokeWidth:2,roughness:.5}));
hero.push(path('M108 318 L114 325 L466 325 L474 318',{strokeWidth:1.5,roughness:.45}));
hero.push(path('M254 289 L246 306 L329 306 L322 289 Z',{stroke:'#858c7d',strokeWidth:1,roughness:.35}));

// Yellow checklist note. A single green check is the main secondary accent.
hero.push(group('rotate(7 487 170)', [
  rect(445,116,92,110,{fill:paper,fillStyle:'solid',strokeWidth:1.6}),
  rect(445,116,92,110,{fill:yellow,hachureGap:6,fillWeight:2,stroke:'none',roughness:.45}),
  polygon([[473,108],[509,110],[506,123],[470,121]],{fill:'#ebe2ce',fillStyle:'solid',stroke:'none',roughness:.5}),
  path('M463 160 L478 174 L511 141',{stroke:'#6a805d',strokeWidth:3,roughness:.45,disableMultiStroke:true}),
  line(461,194,519,194,{stroke:'#93947b',strokeWidth:1.1,roughness:.3,disableMultiStroke:true}),
  line(461,207,501,207,{stroke:'#93947b',strokeWidth:1.1,roughness:.3,disableMultiStroke:true}),
]));

// A short pencil at the lower right; no large overlapping sketch lines.
hero.push(group('rotate(26 510 278)', [
  rect(501,241,15,72,{fill:yellow,hachureGap:5,fillWeight:2,strokeWidth:1.4,roughness:.4}),
  rect(501,233,15,11,{fill:orange,fillStyle:'solid',strokeWidth:1.2,roughness:.4}),
  line(508,245,508,310,{stroke:'#ad9972',strokeWidth:.8,roughness:.25,disableMultiStroke:true}),
  polygon([[501,313],[516,313],[508,333]],{fill:'#f1ddc0',fillStyle:'solid',strokeWidth:1.2,roughness:.35}),
  path('M505 326 L508 334 L511 326 Z',{fill:ink,fillStyle:'solid',strokeWidth:.8,roughness:.3}),
]));
// Two restrained annotation marks: enough warmth without visual clutter.
hero.push(path('M93 104 L85 93 M112 97 L112 83 M128 106 L136 97',{stroke:orange,strokeWidth:1.7,roughness:.55,disableMultiStroke:true}));

const underline = svg(320,26,'手绘双划线',[
  curve([[6,10],[90,8],[204,10],[313,6]],{stroke:orange,strokeWidth:2.7,roughness:.65,disableMultiStroke:true}),
  curve([[27,18],[111,16],[205,17],[292,15]],{stroke:orange,strokeWidth:1.2,roughness:.5,disableMultiStroke:true}),
]);
const arrow = svg(160,100,'手绘弯箭头',[
  curve([[13,18],[31,48],[77,62],[125,44],[144,25]],{stroke:ink,strokeWidth:2.1,roughness:.7,disableMultiStroke:true}),
  path('M124 27 L145 22 L142 44',{stroke:ink,strokeWidth:2.1,roughness:.65,disableMultiStroke:true}),
]);
const frame = svg(100,100,'不规则手绘边框',[
  polygon([[7,8],[92,6.5],[93,92],[6.5,93]],{stroke:ink,strokeWidth:1,roughness:.65,bowing:.35}),
]);

// Reproducible, transparent paper grain; no filter/noise work at browser runtime.
let grainSeed = 972451;
const random = () => {grainSeed = (Math.imul(grainSeed,1664525)+1013904223)>>>0;return grainSeed/4294967296;};
const dots = Array.from({length:105}, () =>
  `<circle cx="${num(random()*160)}" cy="${num(random()*160)}" r="${num(.28+random()*.35)}" fill="${ink}" fill-opacity="${num(.035+random()*.035)}"/>`
);
const texture = svg(160,160,'浅纸张纹理',dots);
const assets = new Map([
  ['hero-desk.svg',svg(600,400,'手绘编程桌面：笔记本电脑、书本、对勾便签与铅笔',hero)],
  ['underline.svg',underline],['arrow.svg',arrow],['frame.svg',frame],['paper.svg',texture],
]);

if (!check) await mkdir(output,{recursive:true});
for (const [name,content] of assets) {
  if (check) {
    if (await readFile(join(output,name),'utf8') !== content) throw new Error(`Generated asset differs: ${name}`);
  } else await writeFile(join(output,name),content,'utf8');
  console.log(`${check?'Verified':'Generated'} ${name}: ${Buffer.byteLength(content)} bytes, SHA256 ${createHash('sha256').update(content).digest('hex')}`);
}
