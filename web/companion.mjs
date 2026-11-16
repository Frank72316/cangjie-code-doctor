const still = '/assets/local-companion/bunny-still.png';
const wave = '/assets/local-companion/bunny-wave.webp';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
for (const card of document.querySelectorAll('[data-bunny]')) {
  const button = card.querySelector('button');
  const img = card.querySelector('img');
  const hint = card.querySelector('.bunny-hint');
  let timer;
  const stop = () => {
    clearTimeout(timer);
    if (img.getAttribute('src') !== still) img.src = still;
    hint.textContent = '打个招呼';
    button.setAttribute('aria-label', '让小兔挥手');
    card.dataset.playing = 'false';
  };
  button.addEventListener('click', () => {
    if (card.dataset.playing === 'true') return stop();
    if (reduced.matches) {
      hint.textContent = '你好呀！';
      clearTimeout(timer);
      timer = setTimeout(stop, 1800);
      return;
    }
    card.dataset.playing = 'true';
    // A fresh URL restarts the finite animation on subsequent clicks.
    img.src = `${wave}?greeting=${Date.now()}`;
    hint.textContent = '停止挥手';
    button.setAttribute('aria-label', '停止小兔挥手');
    timer = setTimeout(stop, 3100);
  });
  img.addEventListener('error', () => {
    if (img.getAttribute('src') !== still) stop();
    else { clearTimeout(timer); card.hidden = true; }
  });
  reduced.addEventListener('change', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  // SPA page changes should stop any animation on a hidden page.
  const page = card.closest('[data-page-view]');
  new MutationObserver(() => { if (page.hidden) stop(); }).observe(page, {attributes:true, attributeFilter:['hidden']});
}
