import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const companionFiles = ['bunny-still.png', 'bunny-wave.webp'];
export const companionRoutes = [
  ['/companion.css', ['web/companion.css', 'text/css; charset=utf-8']],
  ['/companion.mjs', ['web/companion.mjs', 'text/javascript; charset=utf-8']],
  ...companionFiles.map(name => [`/assets/local-companion/${name}`, [`web/assets/local-companion/${name}`, name.endsWith('.png') ? 'image/png' : 'image/webp']]),
];

// Local artwork is optional: a fresh checkout retains the complete workbench.
export function applyCompanion(html, root) {
  if (!companionFiles.every(name => existsSync(join(root, 'web/assets/local-companion', name)))) return html;
  const card = context => `<aside class="bunny-card bunny-${context}" data-bunny>
    <button type="button" class="bunny-greet" aria-label="让小兔挥手" title="点一下，打个招呼">
      <img src="/assets/local-companion/bunny-still.png" width="280" height="350" alt="白粉垂耳兔女生" decoding="async"><span class="bunny-hint">打个招呼</span>
    </button>
    <div class="bunny-copy"><span class="bunny-label">你的工作台小伙伴</span><strong>${context === 'tutorial' ? '从一条报错开始吧' : '先走通流程，再接入 AI'}</strong><p>${context === 'tutorial' ? '选个样例，找到出错的位置。' : '没有密钥，也可以先体验离线诊断。'}</p>${context === 'ai' ? '<a href="/tutorial" data-route>看看使用教程 →</a>' : ''}</div>
  </aside>`;
  return html.replace('</head>', '<link rel="stylesheet" href="/companion.css"></head>')
    .replace('<div class="tutorial-hero">', `${card('tutorial')}<div class="tutorial-hero">`)
    .replace('<aside class="ai-companion" aria-labelledby="ai-capabilities-title">', `<aside class="ai-companion" aria-labelledby="ai-capabilities-title">${card('ai')}`)
    .replace('</body>', '<script type="module" src="/companion.mjs"></script></body>');
}
