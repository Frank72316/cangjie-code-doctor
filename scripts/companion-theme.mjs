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
    <div class="bunny-copy"><span class="bunny-label">TIPS · 小兔提醒</span><strong>${context === 'tutorial' ? '陪你从第一条报错开始' : '提问前，先核对这两点'}</strong>
      <ul class="bunny-tips">${context === 'tutorial'
        ? '<li>先选一个样例，再点击报错，回到对应的代码行。</li><li>查文档时核对 SDK 版本；编译通过后，还要用测试检查结果。</li>'
        : '<li>确认当前代码和报错，再选择是否附带官方文档。</li><li>AI 建议没有自动执行，不能把回答当成验证通过。</li>'}</ul>
      ${context === 'ai' ? '<a href="/tutorial" data-route>先跟我看看使用教程 →</a>' : ''}</div>
  </aside>`;
  return html.replace('</head>', '<link rel="stylesheet" href="/companion.css"></head>')
    .replace('<div class="tutorial-flow"', `${card('tutorial')}<div class="tutorial-flow"`)
    .replace('<aside class="ai-companion" aria-labelledby="ai-capabilities-title">', `<aside class="ai-companion" aria-labelledby="ai-capabilities-title">${card('ai')}`)
    .replace('</body>', '<script type="module" src="/companion.mjs"></script></body>');
}
