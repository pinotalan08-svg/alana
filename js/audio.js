'use strict';

// Tiny WebAudio synth: every sound is generated, nothing to download.
const Sfx = {
  ctx: null, master: null, noiseBuf: null, on: true,

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 0.6;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },

  tone(f0, f1, dur, type = 'square', vol = 0.12, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  },

  noise(dur, vol = 0.2, freq = 1200, delay = 0) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = 'lowpass';
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.03);
  },

  play(name) {
    switch (name) {
      case 'hit': this.noise(0.07, 0.22, 2200); this.tone(260, 120, 0.07, 'square', 0.06); break;
      case 'crit': this.noise(0.1, 0.3, 3000); this.tone(520, 180, 0.12, 'square', 0.08); break;
      case 'hurt': this.noise(0.12, 0.3, 800); this.tone(170, 70, 0.16, 'sawtooth', 0.09); break;
      case 'kill': this.tone(420, 90, 0.2, 'square', 0.08); this.noise(0.14, 0.15, 1000); break;
      case 'pickup': this.tone(660, 660, 0.05, 'square', 0.06); this.tone(990, 990, 0.08, 'square', 0.06, 0.05); break;
      case 'gold': this.tone(1320, 1320, 0.05, 'triangle', 0.1); this.tone(1760, 1760, 0.09, 'triangle', 0.1, 0.05); break;
      case 'potion': for (let i = 0; i < 4; i++) this.tone(300 + i * 90, 520 + i * 90, 0.06, 'sine', 0.12, i * 0.06); break;
      case 'level': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.12, 'square', 0.07, i * 0.09)); break;
      case 'stairs': this.tone(420, 70, 0.6, 'triangle', 0.14); this.noise(0.5, 0.08, 500); break;
      case 'fire': this.noise(0.6, 0.35, 700); this.tone(140, 50, 0.5, 'sawtooth', 0.08); break;
      case 'tele': this.tone(200, 1600, 0.35, 'sine', 0.12); this.tone(1600, 300, 0.3, 'sine', 0.06, 0.3); break;
      case 'map': this.tone(880, 1320, 0.25, 'triangle', 0.1); this.tone(1320, 1760, 0.25, 'triangle', 0.08, 0.2); break;
      case 'shot': this.noise(0.05, 0.18, 3500); this.tone(900, 300, 0.1, 'triangle', 0.06); break;
      case 'breath': this.noise(0.7, 0.4, 900); this.tone(110, 45, 0.6, 'sawtooth', 0.1); break;
      case 'alert': this.tone(880, 880, 0.05, 'square', 0.04); break;
      case 'chest': this.tone(300, 600, 0.12, 'square', 0.06); this.tone(900, 900, 0.12, 'triangle', 0.08, 0.1); break;
      case 'mimic': this.tone(120, 60, 0.4, 'sawtooth', 0.12); this.noise(0.3, 0.25, 600); break;
      case 'boss': this.tone(80, 55, 1.2, 'sawtooth', 0.12); this.noise(1, 0.18, 400); break;
      case 'death': this.tone(300, 45, 1.1, 'sawtooth', 0.12); this.noise(0.6, 0.2, 500, 0.2); break;
      case 'victory': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 'square', 0.08, i * 0.14)); break;
      case 'click': this.tone(600, 600, 0.03, 'square', 0.04); break;
      default: break;
    }
  },
};

function buzz(pattern) {
  if (!UI.settings.vibrate || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibration not allowed here */
  }
}

Bus.on('damage', (e, dmg, kind) => {
  if (e === S.player) {
    Sfx.play('hurt');
    buzz(35);
  } else if (kind !== 'fire') {
    Sfx.play(kind === 'crit' ? 'crit' : 'hit');
  }
});
Bus.on('kill', () => Sfx.play('kill'));
Bus.on('pickup', (it) => Sfx.play(it.id === 'gold' ? 'gold' : 'pickup'));
Bus.on('heal', () => Sfx.play('potion'));
Bus.on('buff', () => Sfx.play('level'));
Bus.on('levelup', () => Sfx.play('level'));
Bus.on('descend', () => Sfx.play('stairs'));
Bus.on('fire', () => Sfx.play('fire'));
Bus.on('teleport', () => Sfx.play('tele'));
Bus.on('reveal', () => Sfx.play('map'));
Bus.on('shot', (from) => Sfx.play(MONSTERS[from.type] && MONSTERS[from.type].boss ? 'breath' : 'shot'));
Bus.on('alert', () => Sfx.play('alert'));
Bus.on('chest', () => Sfx.play('chest'));
Bus.on('mimic', () => {
  Sfx.play('mimic');
  buzz(80);
});
Bus.on('boss', () => {
  Sfx.play('boss');
  buzz([60, 40, 60]);
});
Bus.on('death', () => {
  Sfx.play('death');
  buzz([80, 50, 160]);
});
Bus.on('victory', () => Sfx.play('victory'));
