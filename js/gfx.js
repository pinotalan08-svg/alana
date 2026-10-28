'use strict';

// Procedural, painterly textures (drawn on 2D canvases) and the vector glyphs used by the
// interface. Nothing here is pixel art: textures are high resolution and smoothly filtered.

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Smooth value noise in [0, 1], tileable over `period` cells.
function makeNoise(seed, period) {
  const rnd = mulberry32(seed);
  const grid = [];
  for (let i = 0; i < period * period; i++) grid.push(rnd());
  const at = (x, y) => grid[((y % period) + period) % period * period + (((x % period) + period) % period)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// Fractal noise written straight into the canvas pixels, tinted between two colors.
function paintNoise(g, size, seed, colA, colB, scale = 8, alpha = 1) {
  const n1 = makeNoise(seed, scale), n2 = makeNoise(seed + 1, scale * 2), n3 = makeNoise(seed + 2, scale * 4);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  const A = hexRgb(colA), B = hexRgb(colB);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * scale, v = (y / size) * scale;
      const t = n1(u, v) * 0.55 + n2(u * 2, v * 2) * 0.3 + n3(u * 4, v * 4) * 0.15;
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const c = A[k] + (B[k] - A[k]) * t;
        d[i + k] = d[i + k] * (1 - alpha) + c * alpha;
      }
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function scatter(g, size, rnd, count, color, rMin, rMax, alpha) {
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.globalAlpha = alpha * (0.4 + rnd() * 0.6);
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, rMin + rnd() * (rMax - rMin), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function crack(g, rnd, x, y, len, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  let a = rnd() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    a += (rnd() - 0.5) * 1.2;
    x += Math.cos(a) * (len / 6);
    y += Math.sin(a) * (len / 6);
    g.lineTo(x, y);
  }
  g.stroke();
}

// ---- Floors --------------------------------------------------------------------------------------

// Returns { map, emissive? } canvases. One texture spans 4 x 4 world units.
function floorCanvases(kind) {
  const S = 512, c = makeCanvas(S), g = c.getContext('2d'), rnd = mulberry32(kind.length * 977);
  if (kind === 'crypt') {
    paintNoise(g, S, 11, '#2b2430', '#4a4152', 6);
    const n = 4, cell = S / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const off = y % 2 ? cell / 2 : 0;
        const px = x * cell + off, py = y * cell;
        const shade = 0.75 + rnd() * 0.35;
        const grad = g.createLinearGradient(px, py, px + cell, py + cell);
        grad.addColorStop(0, `rgba(${Math.round(120 * shade)},${Math.round(108 * shade)},${Math.round(128 * shade)},0.35)`);
        grad.addColorStop(1, 'rgba(10,6,14,0.35)');
        for (const dx of [0, -S]) {
          g.fillStyle = grad;
          g.fillRect(px + dx + 4, py + 4, cell - 8, cell - 8);
        }
      }
    }
    // mortar lines
    g.strokeStyle = 'rgba(8,5,10,0.85)';
    g.lineWidth = 6;
    for (let y = 0; y <= n; y++) {
      g.beginPath();
      g.moveTo(0, y * cell);
      g.lineTo(S, y * cell);
      g.stroke();
      for (let x = 0; x <= n; x++) {
        const px = x * cell + (y % 2 ? cell / 2 : 0);
        g.beginPath();
        g.moveTo(px % (S + 1), y * cell);
        g.lineTo(px % (S + 1), (y + 1) * cell);
        g.stroke();
      }
    }
    scatter(g, S, rnd, 900, '#0c0810', 0.6, 2.2, 0.35);
    scatter(g, S, rnd, 500, '#8a7f96', 0.5, 1.6, 0.18);
    for (let i = 0; i < 7; i++) crack(g, rnd, rnd() * S, rnd() * S, 40 + rnd() * 60, 'rgba(6,3,8,0.7)', 1.6);
    return { map: c };
  }
  if (kind === 'cave') {
    paintNoise(g, S, 23, '#16211f', '#3b4d47', 5);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 18 + rnd() * 50;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const moss = rnd() < 0.45;
      grad.addColorStop(0, moss ? 'rgba(92,150,80,0.45)' : 'rgba(10,16,15,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    scatter(g, S, rnd, 260, '#0a100e', 2, 6, 0.4);
    scatter(g, S, rnd, 140, '#7a9a90', 1.5, 4, 0.22);
    for (let i = 0; i < 10; i++) crack(g, rnd, rnd() * S, rnd() * S, 60 + rnd() * 80, 'rgba(4,8,7,0.6)', 2.2);
    return { map: c };
  }
  // forge: dark basalt slabs veined with glowing magma (emissive map drawn separately)
  paintNoise(g, S, 37, '#1b1312', '#3a2a26', 6);
  const e = makeCanvas(S), ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  const cell = S / 3;
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const px = x * cell + (rnd() - 0.5) * 20, py = y * cell + (rnd() - 0.5) * 20;
      g.fillStyle = `rgba(${40 + rnd() * 20},${26 + rnd() * 10},${22},0.35)`;
      g.fillRect(px + 6, py + 6, cell - 12, cell - 12);
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = rnd() * S, len = 80 + rnd() * 140;
    crack(g, mulberry32(i * 31 + 5), x, y, len, '#0a0605', 5);
    ge.shadowColor = '#ff6a1a';
    ge.shadowBlur = 10;
    crack(ge, mulberry32(i * 31 + 5), x, y, len, '#ff8a2a', 2.4);
  }
  ge.shadowBlur = 0;
  scatter(g, S, rnd, 700, '#0a0605', 0.6, 2, 0.4);
  return { map: c, emissive: e };
}

function wallCanvas(kind) {
  const S = 512, c = makeCanvas(S), g = c.getContext('2d'), rnd = mulberry32(kind.length * 131);
  const base = { crypt: ['#1f1a24', '#4a4054'], cave: ['#101a18', '#324642'], forge: ['#140d0c', '#3c2a24'] }[kind];
  paintNoise(g, S, 51 + kind.length, base[0], base[1], 6);
  const rows = 6, h = S / rows;
  for (let y = 0; y < rows; y++) {
    const w = kind === 'cave' ? S / (2 + (y % 2)) : S / 3;
    for (let x = -1; x < 5; x++) {
      const px = x * w + (y % 2 ? w / 2 : 0) + (kind === 'cave' ? rnd() * 30 : 0);
      const grad = g.createLinearGradient(0, y * h, 0, (y + 1) * h);
      grad.addColorStop(0, 'rgba(255,240,230,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0.35)');
      g.fillStyle = grad;
      g.fillRect(px + 4, y * h + 4, w - 8, h - 8);
    }
    g.fillStyle = 'rgba(5,3,6,0.8)';
    g.fillRect(0, y * h - 2, S, 4);
  }
  scatter(g, S, rnd, 600, '#050306', 0.6, 2, 0.35);
  return c;
}

function rockCanvas() {
  const S = 256, c = makeCanvas(S), g = c.getContext('2d');
  paintNoise(g, S, 77, '#0b0809', '#2c2224', 5);
  scatter(g, S, mulberry32(5), 200, '#000', 1, 3, 0.4);
  return c;
}

// Soft round sprite used for glows, sparks and magic.
function glowCanvas() {
  const S = 128, c = makeCanvas(S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return c;
}

// The glowing depths far beneath the floating chambers.
function abyssCanvas(color) {
  const S = 512, c = makeCanvas(S), g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, 'rgba(20,4,10,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const rnd = mulberry32(9);
  for (let i = 0; i < 40; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.8, y = S / 2 + (rnd() - 0.5) * S * 0.8, r = 10 + rnd() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,140,60,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

function lavaCanvas() {
  const S = 256, c = makeCanvas(S), g = c.getContext('2d');
  paintNoise(g, S, 91, '#5a0a00', '#ffb02a', 4);
  const rnd = mulberry32(3);
  for (let i = 0; i < 9; i++) crack(g, rnd, rnd() * S, rnd() * S, 60, 'rgba(40,6,0,0.6)', 5);
  return c;
}

// ---- Interface glyphs (vector, drawn in a 100 x 100 box) ----------------------------------------

const GLYPHS = {
  bolt(g) {
    g.beginPath();
    g.moveTo(58, 6); g.lineTo(24, 56); g.lineTo(46, 56); g.lineTo(38, 94); g.lineTo(76, 40); g.lineTo(53, 40); g.lineTo(66, 6);
    g.closePath();
    g.fill();
  },
  flame(g) {
    g.beginPath();
    g.moveTo(50, 6);
    g.bezierCurveTo(70, 30, 84, 46, 80, 66);
    g.bezierCurveTo(76, 86, 60, 94, 50, 94);
    g.bezierCurveTo(30, 94, 18, 80, 20, 62);
    g.bezierCurveTo(22, 46, 36, 40, 38, 24);
    g.bezierCurveTo(46, 34, 48, 44, 46, 52);
    g.bezierCurveTo(56, 40, 56, 22, 50, 6);
    g.fill();
  },
  flake(g) {
    g.lineWidth = 8;
    g.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      g.save();
      g.translate(50, 50);
      g.rotate((i * Math.PI) / 3);
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(0, -40);
      g.moveTo(0, -24); g.lineTo(-12, -34);
      g.moveTo(0, -24); g.lineTo(12, -34);
      g.stroke();
      g.restore();
    }
  },
  wave(g) {
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(8, 70);
    g.bezierCurveTo(24, 52, 36, 52, 46, 66);
    g.bezierCurveTo(56, 80, 70, 80, 92, 58);
    g.stroke();
    g.beginPath();
    g.moveTo(14, 50);
    g.bezierCurveTo(22, 20, 58, 12, 70, 34);
    g.bezierCurveTo(76, 46, 64, 56, 54, 48);
    g.bezierCurveTo(48, 42, 54, 34, 60, 38);
    g.stroke();
  },
  moon(g) {
    g.beginPath();
    g.arc(50, 50, 40, 0.35 * Math.PI, 1.65 * Math.PI, false);
    g.arc(64, 44, 32, 1.45 * Math.PI, 0.55 * Math.PI, true);
    g.closePath();
    g.fill();
  },
  feather(g) {
    g.beginPath();
    g.moveTo(82, 8);
    g.bezierCurveTo(40, 14, 18, 46, 22, 80);
    g.bezierCurveTo(52, 78, 84, 50, 82, 8);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(80, 12);
    g.quadraticCurveTo(46, 40, 24, 80);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(24, 78);
    g.lineTo(12, 94);
    g.stroke();
  },
  coin(g) {
    g.beginPath();
    g.arc(50, 50, 40, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(50, 50, 29, 0, Math.PI * 2);
    g.stroke();
    g.font = '700 38px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('Ω', 50, 53);
    g.globalCompositeOperation = 'source-over';
  },
  heart(g) {
    g.beginPath();
    g.moveTo(50, 90);
    g.bezierCurveTo(14, 64, 6, 44, 10, 30);
    g.bezierCurveTo(16, 10, 42, 8, 50, 28);
    g.bezierCurveTo(58, 8, 84, 10, 90, 30);
    g.bezierCurveTo(94, 44, 86, 64, 50, 90);
    g.fill();
  },
  fruit(g) {
    g.beginPath();
    g.arc(50, 58, 34, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(38, 26); g.lineTo(42, 12); g.lineTo(50, 22); g.lineTo(58, 12); g.lineTo(62, 26);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(38, 48, 7, 11, -0.5, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  },
  shard(g) {
    g.beginPath();
    g.moveTo(50, 4); g.lineTo(74, 36); g.lineTo(60, 96); g.lineTo(40, 96); g.lineTo(26, 36);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(50, 8); g.lineTo(50, 92);
    g.moveTo(28, 36); g.lineTo(72, 36);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  },
  anvil(g) {
    g.beginPath();
    g.moveTo(8, 30); g.lineTo(92, 30); g.lineTo(86, 46); g.lineTo(64, 50); g.lineTo(62, 66);
    g.lineTo(78, 86); g.lineTo(22, 86); g.lineTo(38, 66); g.lineTo(36, 50); g.lineTo(18, 46);
    g.closePath();
    g.fill();
  },
  fountain(g) {
    g.beginPath();
    g.moveTo(14, 64); g.lineTo(86, 64); g.lineTo(72, 82); g.lineTo(28, 82);
    g.closePath();
    g.fill();
    g.fillRect(44, 82, 12, 10);
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(50, 60); g.lineTo(50, 22);
    g.moveTo(50, 24); g.quadraticCurveTo(30, 14, 24, 52);
    g.moveTo(50, 24); g.quadraticCurveTo(70, 14, 76, 52);
    g.stroke();
  },
  skull(g) {
    g.beginPath();
    g.arc(50, 44, 36, Math.PI, 0);
    g.lineTo(86, 60); g.lineTo(70, 66); g.lineTo(70, 88); g.lineTo(30, 88); g.lineTo(30, 66); g.lineTo(14, 60);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.ellipse(36, 50, 9, 11, 0, 0, Math.PI * 2);
    g.ellipse(64, 50, 9, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(50, 60); g.lineTo(44, 72); g.lineTo(56, 72);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  },
  star(g) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 18 : 44, a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(50 + Math.cos(a) * r, 52 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  },
  ankh(g) {
    g.lineWidth = 11;
    g.lineCap = 'round';
    g.beginPath();
    g.ellipse(50, 28, 14, 19, 0, 0, Math.PI * 2);
    g.moveTo(50, 48); g.lineTo(50, 92);
    g.moveTo(22, 56); g.lineTo(78, 56);
    g.stroke();
  },
  sword(g) {
    g.beginPath();
    g.moveTo(84, 6); g.lineTo(94, 16); g.lineTo(40, 70); g.lineTo(30, 60);
    g.closePath();
    g.fill();
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(22, 52); g.lineTo(48, 78);
    g.moveTo(32, 68); g.lineTo(12, 88);
    g.stroke();
  },
  bow(g) {
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(18, 50, 54, -0.95, 0.95);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(49, 8); g.lineTo(49, 92);
    g.stroke();
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(10, 50); g.lineTo(84, 50);
    g.stroke();
    g.beginPath();
    g.moveTo(94, 50); g.lineTo(80, 42); g.lineTo(80, 58);
    g.closePath();
    g.fill();
  },
  spin(g) {
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(50, 50, 34, 0.2, Math.PI * 1.7);
    g.stroke();
    g.beginPath();
    g.moveTo(84, 30); g.lineTo(86, 56); g.lineTo(62, 46);
    g.closePath();
    g.fill();
    g.beginPath();
    g.arc(50, 50, 12, 0, Math.PI * 2);
    g.fill();
  },
  dash(g) {
    g.beginPath();
    g.moveTo(40, 20); g.lineTo(80, 50); g.lineTo(40, 80); g.lineTo(52, 50);
    g.closePath();
    g.fill();
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(12, 34); g.lineTo(34, 34);
    g.moveTo(6, 50); g.lineTo(36, 50);
    g.moveTo(12, 66); g.lineTo(34, 66);
    g.stroke();
  },
};

const glyphCache = {};

// A round medallion with a glowing glyph, returned as a data URL for <img> and as a canvas for 3D.
function emblemCanvas(glyph, color, size = 160, plain = false) {
  const c = makeCanvas(size), g = c.getContext('2d');
  const s = size / 100;
  if (!plain) {
    const bg = g.createRadialGradient(50 * s, 42 * s, 4 * s, 50 * s, 50 * s, 48 * s);
    bg.addColorStop(0, '#2c2230');
    bg.addColorStop(1, '#0c080e');
    g.fillStyle = bg;
    g.beginPath();
    g.arc(50 * s, 50 * s, 46 * s, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 4 * s;
    g.strokeStyle = color;
    g.stroke();
    g.lineWidth = 1.5 * s;
    g.strokeStyle = 'rgba(255,230,180,0.35)';
    g.beginPath();
    g.arc(50 * s, 50 * s, 40 * s, 0, Math.PI * 2);
    g.stroke();
  }
  g.save();
  const inner = plain ? 1 : 0.62;
  g.translate(50 * s * (1 - inner), 50 * s * (1 - inner));
  g.scale(s * inner, s * inner);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 14 * s;
  (GLYPHS[glyph] || GLYPHS.star)(g);
  g.restore();
  return c;
}

function emblemURL(glyph, color, size = 160, plain = false) {
  const key = `${glyph}|${color}|${size}|${plain}`;
  return glyphCache[key] || (glyphCache[key] = emblemCanvas(glyph, color, size, plain).toDataURL());
}

// What a reward looks like: its glyph and color.
function rewardLook(reward) {
  if (reward.type === 'boon') return { glyph: ANCIENTS[reward.anc].glyph, color: ANCIENTS[reward.anc].color };
  const r = REWARDS[reward.type];
  return { glyph: r.glyph, color: r.color };
}
