'use strict';

// Every sound is synthesized with WebAudio: nothing to download.
const Sfx = {
  ctx: null, master: null, noiseBuf: null, on: true,

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    Music.start();
  },

  tone(f0, f1, dur, type = 'square', vol = 0.1, delay = 0, dest = null) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  },

  noise(dur, vol = 0.2, freq = 1200, delay = 0, type = 'lowpass', dest = null) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  },

  play(name) {
    switch (name) {
      case 'swing': this.noise(0.12, 0.16, 2600, 0, 'bandpass'); break;
      case 'hit': this.noise(0.06, 0.22, 1800); this.tone(220, 110, 0.07, 'square', 0.05); break;
      case 'crit': this.noise(0.1, 0.3, 3200); this.tone(880, 330, 0.14, 'sawtooth', 0.06); break;
      case 'kill': this.tone(300, 70, 0.22, 'triangle', 0.12); this.noise(0.18, 0.15, 900); break;
      case 'hurt': this.noise(0.14, 0.32, 700); this.tone(160, 60, 0.2, 'sawtooth', 0.1); break;
      case 'dash': this.noise(0.18, 0.18, 1400, 0, 'bandpass'); this.tone(500, 900, 0.1, 'sine', 0.04); break;
      case 'shoot': this.tone(900, 400, 0.1, 'triangle', 0.06); this.noise(0.05, 0.1, 4000, 0, 'highpass'); break;
      case 'cast': this.tone(600, 1200, 0.18, 'sine', 0.08); this.noise(0.12, 0.08, 3000, 0, 'highpass'); break;
      case 'spin': this.noise(0.3, 0.22, 1800, 0, 'bandpass'); this.tone(300, 600, 0.25, 'triangle', 0.05); break;
      case 'strike': this.noise(0.35, 0.35, 5000, 0, 'highpass'); this.tone(90, 40, 0.3, 'sawtooth', 0.12); break;
      case 'zap': this.noise(0.12, 0.15, 6000, 0, 'highpass'); break;
      case 'burn': this.noise(0.4, 0.25, 900); break;
      case 'freeze': for (let i = 0; i < 3; i++) this.tone(1800 + i * 500, 2200 + i * 500, 0.12, 'sine', 0.05, i * 0.04); break;
      case 'wave': this.noise(0.5, 0.25, 600); break;
      case 'slam': this.tone(110, 40, 0.35, 'sine', 0.3); this.noise(0.3, 0.25, 400); break;
      case 'blast': this.tone(140, 45, 0.4, 'sine', 0.25); this.noise(0.4, 0.3, 700); break;
      case 'enemyAttack': this.noise(0.15, 0.12, 1600, 0, 'bandpass'); break;
      case 'enemyShoot': this.tone(400, 200, 0.15, 'triangle', 0.05); break;
      case 'roar': this.tone(90, 50, 1.1, 'sawtooth', 0.16); this.noise(1, 0.2, 400); break;
      case 'bossDown': this.tone(200, 40, 1.6, 'sawtooth', 0.15); this.noise(1.4, 0.3, 600); this.play('victoryShort'); break;
      case 'victoryShort': [392, 494, 587, 784].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.08, 0.6 + i * 0.12)); break;
      case 'gold': this.tone(1320, 1320, 0.05, 'triangle', 0.08); this.tone(1760, 1760, 0.09, 'triangle', 0.08, 0.05); break;
      case 'heal': for (let i = 0; i < 4; i++) this.tone(400 + i * 120, 600 + i * 120, 0.12, 'sine', 0.08, i * 0.05); break;
      case 'reward': [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.5, 'sine', 0.07, i * 0.06)); break;
      case 'boon': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.4, 'triangle', 0.06, i * 0.05)); break;
      case 'buy': this.tone(1320, 1320, 0.06, 'triangle', 0.08); this.tone(990, 990, 0.1, 'triangle', 0.08, 0.06); break;
      case 'doors': this.tone(196, 196, 0.8, 'sine', 0.12); this.tone(294, 294, 0.8, 'sine', 0.08, 0.1); break;
      case 'cleared': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.25, 'square', 0.04, i * 0.08)); break;
      case 'urn': this.noise(0.15, 0.3, 2500); this.tone(800, 300, 0.08, 'triangle', 0.05); break;
      case 'defiance': [262, 330, 392, 523].forEach((f, i) => this.tone(f, f * 2, 0.4, 'sine', 0.1, i * 0.08)); break;
      case 'gameover': this.tone(220, 55, 1.6, 'sawtooth', 0.12); break;
      case 'victory': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.3, 'triangle', 0.09, i * 0.15)); break;
      case 'noAmmo': this.tone(200, 150, 0.1, 'square', 0.04); break;
      case 'click': this.tone(700, 700, 0.03, 'triangle', 0.04); break;
      default: break;
    }
  },
};

// A slow, generative score: a drone and a minor-key pluck pattern that quickens in combat.
const Music = {
  started: false, step: 0, next: 0, bus: null, timer: 0,
  scale: [0, 1, 3, 5, 7, 8, 10],
  start() {
    if (this.started || !Sfx.ctx) return;
    this.started = true;
    this.bus = Sfx.ctx.createGain();
    this.bus.gain.value = 0.35;
    this.bus.connect(Sfx.master);
    this.next = Sfx.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 120);
  },
  schedule() {
    if (!Sfx.on || !Sfx.ctx || Sfx.ctx.state !== 'running') return;
    const combat = inRun() && UI.screen === null && Ch.enemies.length > 0;
    const boss = combat && Ch.kind === 'boss';
    const beat = boss ? 0.2 : combat ? 0.24 : 0.36;
    const root = [146.83, 130.81, 110][Ch ? Ch.biome : 0];
    while (this.next < Sfx.ctx.currentTime + 0.3) {
      const s = this.step++ % 16, t = this.next - Sfx.ctx.currentTime;
      if (s === 0) Sfx.tone(root / 2, root / 2, beat * 15, 'sawtooth', 0.05, t, this.bus);
      if (s % 2 === 0 && (combat || s % 4 === 0)) {
        const deg = this.scale[(s * 3 + Math.floor(this.step / 16) * 2) % this.scale.length];
        const octave = s % 8 === 0 ? 2 : 4;
        Sfx.tone(root * octave * Math.pow(2, deg / 12), root * octave * Math.pow(2, deg / 12), beat * 1.6, 'triangle', combat ? 0.035 : 0.025, t, this.bus);
      }
      if (combat && (s === 0 || s === 8 || (boss && s === 12))) Sfx.tone(120, 40, 0.25, 'sine', 0.16, t, this.bus);
      if (combat && s % 4 === 2) Sfx.noise(0.05, 0.05, 6000, t, 'highpass', this.bus);
      this.next += beat;
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

Bus.on('swing', () => Sfx.play('swing'));
Bus.on('hit', (e, dmg, crit, src) => {
  if (src === 'burn') return;
  if (src === 'storm') Sfx.play('zap');
  else Sfx.play(crit ? 'crit' : 'hit');
});
Bus.on('kill', () => Sfx.play('kill'));
Bus.on('hurt', () => {
  Sfx.play('hurt');
  buzz(40);
});
Bus.on('dash', () => Sfx.play('dash'));
Bus.on('shoot', () => Sfx.play('shoot'));
Bus.on('cast', () => Sfx.play('cast'));
Bus.on('spin', () => Sfx.play('spin'));
Bus.on('strike', () => Sfx.play('strike'));
Bus.on('burst', () => Sfx.play('burn'));
Bus.on('freeze', () => Sfx.play('freeze'));
Bus.on('nova', () => Sfx.play('freeze'));
Bus.on('wave', () => Sfx.play('wave'));
Bus.on('slam', () => {
  Sfx.play('slam');
  buzz(25);
});
Bus.on('blast', () => Sfx.play('blast'));
Bus.on('enemyAttack', () => Sfx.play('enemyAttack'));
Bus.on('enemyShoot', () => Sfx.play('enemyShoot'));
Bus.on('roar', () => {
  Sfx.play('roar');
  buzz([60, 40, 60]);
});
Bus.on('bossDown', () => {
  Sfx.play('bossDown');
  buzz([80, 40, 120]);
});
Bus.on('collect', (k) => Sfx.play(k.kind === 'gold' ? 'gold' : k.kind === 'heal' ? 'heal' : k.kind === 'reward' ? 'reward' : 'click'));
Bus.on('fountain', () => Sfx.play('heal'));
Bus.on('doors', () => Sfx.play('doors'));
Bus.on('cleared', () => Sfx.play('cleared'));
Bus.on('urn', () => Sfx.play('urn'));
Bus.on('defiance', () => Sfx.play('defiance'));
Bus.on('noAmmo', () => Sfx.play('noAmmo'));
Bus.on('death', () => buzz([80, 50, 160]));
