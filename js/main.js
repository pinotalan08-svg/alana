'use strict';

function boot() {
  const canvas = document.getElementById('view');
  buildSprites();
  initView(canvas);
  init3D(document.getElementById('view3d'));
  initUI();
  initInput(canvas);
  showTitle();

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    tickAuto(dt);
    if (V3.active) render3D(now, dt);
    else renderFrame(now, dt);
    if (UI.modal === 'title') drawTitle(now / 1000);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // browsers only allow sound after a user gesture
  document.addEventListener('pointerdown', () => Sfx.unlock(), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveGame();
  });
  window.addEventListener('pagehide', saveGame);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => (View.lastDraw = 0));

  if ('serviceWorker' in navigator && !window.ABYSSES_NO_SW && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
