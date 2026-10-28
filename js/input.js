'use strict';

// Floating joystick on the left half of the screen, action buttons on the right, and the
// keyboard for desktop play. Actions are buffered briefly so a press is never lost mid-swing.
const Input = {
  move: { x: 0, z: 0 },
  held: { attack: false, special: false, dash: false, cast: false },
  buf: { attack: 0, special: 0, dash: 0, cast: 0 },
  stick: null,
  stickVec: { x: 0, z: 0 },
  keys: new Set(),

  take(action) {
    const t = this.buf[action];
    if (t && performance.now() - t < 220) {
      this.buf[action] = 0;
      return true;
    }
    return false;
  },
  press(action) {
    this.buf[action] = performance.now();
    this.held[action] = true;
  },
  release(action) {
    this.held[action] = false;
  },
  reset() {
    for (const k of Object.keys(this.held)) {
      this.held[k] = false;
      this.buf[k] = 0;
    }
    this.keys.clear();
    this.stick = null;
    setStick(0, 0);
    const s = document.getElementById('stick');
    if (s) {
      s.classList.remove('active');
      s.removeAttribute('style');
    }
    document.querySelectorAll('.act.down').forEach((b) => b.classList.remove('down'));
  },
};

const STICK_R = 50;
const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
const ACTION_KEYS = {
  Space: 'attack', KeyJ: 'attack', KeyK: 'special', KeyL: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'cast', KeyI: 'cast',
};

function updateMove() {
  let kx = 0, kz = 0;
  for (const code of Input.keys) {
    const d = MOVE_KEYS[code];
    if (d) {
      kx += d[0];
      kz += d[1];
    }
  }
  if (kx || kz) {
    const l = Math.hypot(kx, kz);
    Input.move = { x: kx / l, z: kz / l };
  } else {
    Input.move = { ...Input.stickVec };
  }
}

function setStick(dx, dy) {
  const knob = document.getElementById('stick-knob');
  if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const m = Math.hypot(dx, dy) / STICK_R;
  Input.stickVec = m < 0.15 ? { x: 0, z: 0 } : { x: dx / STICK_R, z: dy / STICK_R };
  updateMove();
}

function initInput() {
  const zone = $('stick-zone'), stick = $('stick');
  zone.addEventListener('pointerdown', (e) => {
    if (Input.stick) return;
    e.preventDefault();
    Sfx.unlock();
    zone.setPointerCapture(e.pointerId);
    const r = zone.getBoundingClientRect();
    Input.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    stick.style.left = `${e.clientX - r.left - 60}px`;
    stick.style.bottom = `${r.bottom - e.clientY - 60}px`;
    stick.classList.add('active');
    setStick(0, 0);
  });
  zone.addEventListener('pointermove', (e) => {
    if (!Input.stick || e.pointerId !== Input.stick.id) return;
    const dx = e.clientX - Input.stick.ox, dy = e.clientY - Input.stick.oy, l = Math.hypot(dx, dy);
    const k = l > STICK_R ? STICK_R / l : 1;
    setStick(dx * k, dy * k);
  });
  const release = (e) => {
    if (!Input.stick || e.pointerId !== Input.stick.id) return;
    Input.stick = null;
    setStick(0, 0);
    stick.classList.remove('active');
    stick.removeAttribute('style');
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);

  for (const btn of document.querySelectorAll('.act')) {
    const action = btn.dataset.act;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      Sfx.unlock();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        /* capture not available */
      }
      Input.press(action);
      btn.classList.add('down');
    });
    const up = () => {
      Input.release(action);
      btn.classList.remove('down');
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (!$('confirm').hidden) closeConfirm();
      else if (UI.screen === 'pause') showScreen(null);
      else if (UI.screen === 'help') showScreen(UI.back);
      else if (!UI.screen) openPause();
      return;
    }
    if (isPaused()) return;
    if (MOVE_KEYS[e.code]) {
      e.preventDefault();
      Input.keys.add(e.code);
      updateMove();
    } else if (ACTION_KEYS[e.code]) {
      e.preventDefault();
      Sfx.unlock();
      if (!e.repeat) Input.press(ACTION_KEYS[e.code]);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (MOVE_KEYS[e.code]) {
      Input.keys.delete(e.code);
      updateMove();
    } else if (ACTION_KEYS[e.code]) {
      Input.release(ACTION_KEYS[e.code]);
    }
  });
  window.addEventListener('blur', () => Input.reset());
}
