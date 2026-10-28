'use strict';

const STEP = 1 / 60;

function boot() {
  const webgl = initScene(document.getElementById('gl'), document.getElementById('fx'));
  initUI();
  initInput();
  if (webgl) setQuality(UI.settings.quality);
  else {
    $('no-webgl').hidden = false;
    $('btn-play').disabled = true;
  }
  showTitle();

  let last = performance.now(), acc = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (inRun() && !isPaused() && document.visibilityState === 'visible') {
      acc += dt;
      // fixed steps keep the combat identical whatever the frame rate
      for (let i = 0; acc >= STEP && i < 6; i++) {
        updateChamber(STEP);
        acc -= STEP;
      }
      if (acc > STEP * 6) acc = 0;
    } else {
      acc = 0;
    }
    if (webgl) renderScene(isPaused() ? 0 : dt, now / 1000);
    updateHud();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && inRun() && !UI.screen) openPause();
  });
  if ('serviceWorker' in navigator && !window.ABYSSES_NO_SW && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
