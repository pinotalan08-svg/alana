'use strict';

// Material textures for the 3D world, painted procedurally: colour, relief (normal map),
// shininess (roughness) and glow (emissive). Each set is generated once and cached.
// Floors and walls are 512 px for 4 world units, about one texel per screen pixel on a phone.

const TEX = 512;
const texCache = {};

function cachedTex(key, make) {
  return texCache[key] || (texCache[key] = make());
}

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Tileable fractal noise sampled on the TEX grid.
function fbmField(seed, scale, octaves = 4, size = TEX) {
  const out = new Float32Array(size * size);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(makeNoise(seed + o * 17, scale << o));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (let o = 0; o < octaves; o++) {
        const s = (scale << o) / size;
        v += layers[o](x * s, y * s) * amp;
        norm += amp;
        amp *= 0.5;
      }
      out[y * size + x] = v / norm;
    }
  }
  return out;
}

// Tileable Voronoi: nearest cell id and distance to the nearest edge, in cell units.
function voronoiField(seed, cells, size = TEX, stretchY = 1) {
  const rnd = mulberry32(seed);
  const ox = new Float32Array(cells * cells), oy = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    ox[i] = 0.15 + rnd() * 0.7;
    oy[i] = 0.15 + rnd() * 0.7;
  }
  const id = new Int32Array(size * size), edge = new Float32Array(size * size);
  const cs = size / cells;
  for (let y = 0; y < size; y++) {
    const py = y / cs, cy = Math.floor(py);
    for (let x = 0; x < size; x++) {
      const px = x / cs, cx = Math.floor(px);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const ci = cx + i, cj = cy + j;
          const w = (((cj % cells) + cells) % cells) * cells + (((ci % cells) + cells) % cells);
          const dx = ci + ox[w] - px, dy = (cj + oy[w] - py) * stretchY;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = w; } else if (d < d2) d2 = d;
        }
      }
      const k = y * size + x;
      id[k] = best;
      edge[k] = (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5;
    }
  }
  return { id, edge, cells };
}

// Height field to a tangent-space normal map (OpenGL convention, as three.js expects).
function normalCanvas(h, strength, size = TEX) {
  const c = makeCanvas(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size, yd = ((y + 1) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const l = h[yr + ((x - 1 + size) % size)], r = h[yr + ((x + 1) % size)];
      let nx = (l - r) * strength, ny = (h[yd + x] - h[yu + x]) * strength, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (yr + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Writes per-pixel colour, roughness and emissive buffers into canvases.
function packCanvases(col, rough, emis, size = TEX) {
  const out = {};
  const write = (buf, channels) => {
    const c = makeCanvas(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    for (let i = 0, n = size * size; i < n; i++) {
      if (channels === 3) {
        d[i * 4] = buf[i * 3];
        d[i * 4 + 1] = buf[i * 3 + 1];
        d[i * 4 + 2] = buf[i * 3 + 2];
      } else {
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = buf[i];
      }
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  out.map = write(col, 3);
  out.roughness = write(rough, 1);
  if (emis) out.emissive = write(emis, 3);
  return out;
}

// Random crack lines rasterised into a mask.
function crackMask(seed, count, size = TEX) {
  const c = makeCanvas(size), g = c.getContext('2d'), rnd = mulberry32(seed);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI * 2;
    g.lineWidth = 1 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 5 + Math.floor(rnd() * 6);
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 1.3;
      x += Math.cos(a) * (8 + rnd() * 14);
      y += Math.sin(a) * (8 + rnd() * 14);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const d = g.getImageData(0, 0, size, size).data, out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255;
  return out;
}

// ---- Floors ------------------------------------------------------------------------------------

function cryptFloor() {
  const S = TEX, rnd = mulberry32(4242);
  // flagstones from recursive splits on a 64 px grid: edges of the square are seams, so it tiles
  const rects = [];
  const split = (x0, y0, x1, y1) => {
    const w = x1 - x0, h = y1 - y0;
    if ((w <= 256 && h <= 256 && rnd() < 0.55) || (w <= 128 && h <= 128)) {
      rects.push([x0, y0, x1, y1]);
      return;
    }
    if (w >= h ? w > 128 : h <= 128) {
      const cut = x0 + 64 * (1 + Math.floor(rnd() * (w / 64 - 1)));
      split(x0, y0, cut, y1);
      split(cut, y0, x1, y1);
    } else {
      const cut = y0 + 64 * (1 + Math.floor(rnd() * (h / 64 - 1)));
      split(x0, y0, x1, cut);
      split(x0, cut, x1, y1);
    }
  };
  split(0, 0, S, S);
  const owner = new Int32Array(S * S);
  rects.forEach(([x0, y0, x1, y1], i) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) owner[y * S + x] = i;
  });
  const tone = rects.map(() => [0.82 + rnd() * 0.3, (rnd() - 0.5) * 0.08, (rnd() - 0.5) * 0.0008, (rnd() - 0.5) * 0.0008]);
  const fine = fbmField(11, 8, 4), broad = fbmField(12, 3, 3), chip = fbmField(13, 24, 2);
  const cracks = crackMask(14, 16);
  const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, r = rects[owner[i]], t = tone[owner[i]];
      const de = Math.min(x - r[0], r[2] - 1 - x, y - r[1], r[3] - 1 - y);
      let bevel = smooth(1.5, 11, de);
      if (de < 14 && chip[i] > 0.62) bevel *= 0.55; // chipped corners and edges
      const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2;
      const crack = cracks[i] * (de > 3 ? 1 : 0);
      h[i] = bevel * (0.75 + (x - cx) * t[2] + (y - cy) * t[3] + fine[i] * 0.2) - crack * 0.35;
      const grout = 1 - bevel;
      // purple-grey stone, worn lighter at the rim, grime collects in the joints and cracks
      const lum = t[0] * (0.62 + fine[i] * 0.55) * (0.85 + broad[i] * 0.3) * (1 - crack * 0.6);
      const wear = smooth(10, 2, de) * bevel * 0.25;
      col[i * 3] = clamp((74 + t[1] * 120) * lum + wear * 60 - grout * 40, 0, 255) * (1 - grout * 0.55) + grout * 14;
      col[i * 3 + 1] = clamp(64 * lum + wear * 52 - grout * 36, 0, 255) * (1 - grout * 0.55) + grout * 11;
      col[i * 3 + 2] = clamp((84 - t[1] * 80) * lum + wear * 58 - grout * 40, 0, 255) * (1 - grout * 0.55) + grout * 16;
      // polished centres catch the brazier light; joints stay dull
      rough[i] = 255 * clamp(0.82 - smooth(18, 60, de) * 0.32 + fine[i] * 0.12 + grout * 0.2, 0.35, 1);
    }
  }
  return { ...packCanvases(col, rough, null), normal: normalCanvas(h, 5) };
}

function caveFloor() {
  const S = TEX, v = voronoiField(77, 5), rnd = mulberry32(78);
  const tone = Array.from({ length: 25 }, () => [0.8 + rnd() * 0.35, rnd()]);
  const fine = fbmField(21, 10, 4), moss = fbmField(22, 3, 4), wet = fbmField(23, 2, 3);
  const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S), emis = new Uint8ClampedArray(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const e = v.edge[i], t = tone[v.id[i]];
    const plate = smooth(0.0, 0.14, e);
    const puddle = smooth(0.3, 0.23, wet[i]); // low basins hold water
    h[i] = plate * (0.7 + fine[i] * 0.45) * (1 - puddle * 0.7);
    const m = smooth(0.58, 0.74, moss[i]) * (1 - puddle);
    const lum = t[0] * (0.55 + fine[i] * 0.6) * (0.55 + plate * 0.45);
    let r = 58 * lum, g = 64 * lum, b = 62 * lum;
    r = r * (1 - m) + 46 * m * (0.7 + fine[i] * 0.6);
    g = g * (1 - m) + 80 * m * (0.7 + fine[i] * 0.6);
    b = b * (1 - m) + 44 * m * (0.7 + fine[i] * 0.6);
    // water: darker, bluer and glassy so lights reflect in it
    r = r * (1 - puddle * 0.65) + 8 * puddle;
    g = g * (1 - puddle * 0.6) + 22 * puddle;
    b = b * (1 - puddle * 0.5) + 30 * puddle;
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
    rough[i] = 255 * clamp(0.9 - puddle * 0.82 + m * 0.08 - plate * 0.08, 0.06, 1);
    // rare glowing spores in the moss
    if (m > 0.5 && fine[i] > 0.74 && t[1] > 0.4) {
      emis[i * 3] = 40;
      emis[i * 3 + 1] = 200;
      emis[i * 3 + 2] = 220;
    }
  }
  return { ...packCanvases(col, rough, emis), normal: normalCanvas(h, 4) };
}

function forgeFloor() {
  const S = TEX, v = voronoiField(91, 4), rnd = mulberry32(92);
  const tone = Array.from({ length: 16 }, () => [0.75 + rnd() * 0.4, rnd()]);
  const fine = fbmField(31, 10, 4), heat = fbmField(32, 3, 3), ash = fbmField(33, 18, 2);
  const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S), emis = new Uint8ClampedArray(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const e = v.edge[i], t = tone[v.id[i]];
    const plate = smooth(0.0, 0.1, e);
    h[i] = plate * (0.72 + fine[i] * 0.3);
    const lum = t[0] * (0.5 + fine[i] * 0.6) * (0.35 + plate * 0.65);
    const a = smooth(0.62, 0.8, ash[i]) * plate * 0.5;
    col[i * 3] = 44 * lum + a * 70;
    col[i * 3 + 1] = 32 * lum + a * 64;
    col[i * 3 + 2] = 30 * lum + a * 60;
    rough[i] = 255 * clamp(0.78 + fine[i] * 0.2 - plate * 0.1, 0.4, 1);
    // magma glows in the seams, brighter where the heat field says so
    const seam = smooth(0.05, 0.0, e) * smooth(0.5, 0.72, heat[i]);
    if (seam > 0) {
      const k = seam * (0.7 + fine[i] * 0.6);
      emis[i * 3] = clamp(255 * k, 0, 255);
      emis[i * 3 + 1] = clamp(120 * k * k, 0, 255);
      emis[i * 3 + 2] = clamp(30 * k * k * k, 0, 255);
    }
  }
  return { ...packCanvases(col, rough, emis), normal: normalCanvas(h, 4.5) };
}

// Glacier: plates of blue ice, frost in patches, deep cracks that hold a little cold light.
function iceFloor() {
  const S = TEX, v = voronoiField(55, 4), rnd = mulberry32(56);
  const tone = Array.from({ length: 16 }, () => 0.85 + rnd() * 0.25);
  const fine = fbmField(57, 10, 4), frost = fbmField(58, 4, 4), deep = fbmField(59, 2, 3);
  const cracks = crackMask(60, 12);
  const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S), emis = new Uint8ClampedArray(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const e = v.edge[i], t = tone[v.id[i]];
    const plate = smooth(0.0, 0.07, e), fr = smooth(0.52, 0.74, frost[i]), crack = cracks[i] * plate;
    h[i] = plate * (0.82 + fine[i] * 0.18) - crack * 0.3 + fr * 0.06;
    const lum = t * (0.78 + fine[i] * 0.32) * (1 - crack * 0.45);
    let r = (30 + deep[i] * 20) * lum, g = (56 + deep[i] * 24) * lum, b = (84 + deep[i] * 26) * lum;
    r = r * (1 - fr * 0.6) + 118 * fr * 0.6;
    g = g * (1 - fr * 0.6) + 134 * fr * 0.6;
    b = b * (1 - fr * 0.6) + 150 * fr * 0.6;
    const seam = 1 - plate;
    col[i * 3] = r * (1 - seam * 0.7) + 8 * seam;
    col[i * 3 + 1] = g * (1 - seam * 0.7) + 18 * seam;
    col[i * 3 + 2] = b * (1 - seam * 0.7) + 34 * seam;
    rough[i] = 255 * clamp(0.22 + fr * 0.6 + seam * 0.5 + crack * 0.2, 0.12, 1);
    const k = Math.max(seam, crack * 0.8) * smooth(0.45, 0.7, deep[i]);
    if (k > 0) {
      emis[i * 3] = 16 * k;
      emis[i * 3 + 1] = 80 * k;
      emis[i * 3 + 2] = 120 * k;
    }
  }
  return { ...packCanvases(col, rough, emis), normal: normalCanvas(h, 3) };
}

// Void: polished obsidian tiles with marbled veins; some tiles carry a channel of violet light.
function voidFloor() {
  const S = TEX, T = 128, rnd = mulberry32(71);
  const lit = Array.from({ length: 16 }, () => rnd() < 0.3), tone = Array.from({ length: 16 }, () => 0.8 + rnd() * 0.35);
  const fine = fbmField(72, 10, 4), vein = fbmField(73, 6, 4), broad = fbmField(74, 2, 3);
  const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S), emis = new Uint8ClampedArray(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, id = (Math.floor(y / T) % 4) * 4 + (Math.floor(x / T) % 4), xi = x % T, yi = y % T;
      const de = Math.min(xi, T - 1 - xi, yi, T - 1 - yi);
      const bevel = smooth(1.5, 8, de), ring = Math.max(0, 1 - Math.abs(de - 15) / 2.4);
      const vn = smooth(0.035, 0, Math.abs(vein[i] - 0.5)) * bevel;
      h[i] = bevel * (0.8 + fine[i] * 0.12) - ring * 0.22;
      const lum = tone[id] * (0.72 + fine[i] * 0.4) * (0.85 + broad[i] * 0.3), grout = 1 - bevel;
      col[i * 3] = (32 * lum + vn * 40) * bevel + 8 * grout;
      col[i * 3 + 1] = (24 * lum + vn * 26) * bevel + 5 * grout;
      col[i * 3 + 2] = (44 * lum + vn * 60) * bevel + 12 * grout;
      rough[i] = 255 * clamp(0.18 + fine[i] * 0.14 + grout * 0.7 + ring * 0.3, 0.1, 1);
      const k = (lit[id] ? ring * (0.55 + broad[i] * 0.6) : 0) + vn * 0.07;
      if (k > 0) {
        emis[i * 3] = clamp(160 * k, 0, 255);
        emis[i * 3 + 1] = clamp(70 * k, 0, 255);
        emis[i * 3 + 2] = clamp(255 * k, 0, 255);
      }
    }
  }
  return { ...packCanvases(col, rough, emis), normal: normalCanvas(h, 4) };
}

function floorSet(kind) {
  const make = { crypt: cryptFloor, cave: caveFloor, forge: forgeFloor, ice: iceFloor, void: voidFloor }[kind] || cryptFloor;
  return cachedTex('floor-' + kind, make);
}

// ---- Walls and rock ----------------------------------------------------------------------------------

function wallSet(kind) {
  return cachedTex('wall-' + kind, () => {
    const S = TEX, rnd = mulberry32(kind.length * 313);
    const fine = fbmField(41 + kind.length, 9, 4), stain = fbmField(42 + kind.length, 2, 3);
    const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S);
    const emis = kind === 'forge' || kind === 'void' ? new Uint8ClampedArray(S * S * 3) : null;
    const base = { crypt: [70, 62, 80], cave: [48, 64, 62], forge: [58, 40, 34], ice: [64, 84, 104], void: [34, 26, 46] }[kind];
    const glowCol = kind === 'void' ? [170, 80, 255] : [255, 90, 20];
    const rowH = kind === 'cave' ? 96 : 64, rows = Math.round(S / rowH);
    const shift = Array.from({ length: rows }, () => rnd() * S);
    const blockW = kind === 'cave' ? 192 : 128;
    const shade = Array.from({ length: 64 }, () => 0.8 + rnd() * 0.35);
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / rowH) % rows, yi = y % rowH;
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const xs = (x + shift[row]) % S, bi = Math.floor(xs / blockW), xi = xs % blockW;
        const de = Math.min(xi, blockW - 1 - xi, yi, rowH - 1 - yi);
        const bevel = smooth(1, kind === 'cave' ? 16 : 8, de + (kind === 'cave' ? fine[i] * 10 : 0));
        h[i] = bevel * (0.75 + fine[i] * 0.3);
        const s = shade[(row * 7 + bi) % 64] * (0.6 + fine[i] * 0.55) * (0.7 + stain[i] * 0.45) * (0.45 + bevel * 0.55);
        col[i * 3] = base[0] * s;
        col[i * 3 + 1] = base[1] * s;
        col[i * 3 + 2] = base[2] * s;
        rough[i] = 255 * clamp((kind === 'ice' ? 0.42 : kind === 'void' ? 0.5 : 0.88) - bevel * 0.1, 0.2, 1);
        if (emis && bevel < 0.5 && stain[i] > 0.55) {
          const k = (0.5 - bevel) * 2 * smooth(0.55, 0.75, stain[i]);
          emis[i * 3] = glowCol[0] * k;
          emis[i * 3 + 1] = glowCol[1] * k;
          emis[i * 3 + 2] = glowCol[2] * k;
        }
      }
    }
    return { ...packCanvases(col, rough, emis), normal: normalCanvas(h, 4) };
  });
}

function rockSet() {
  return cachedTex('rock', () => {
    const S = 256, fine = fbmField(61, 6, 5, S), strata = fbmField(62, 2, 2, S);
    const h = new Float32Array(S * S), col = new Uint8ClampedArray(S * S * 3), rough = new Uint8ClampedArray(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const band = Math.sin((y / S) * Math.PI * 12 + strata[i] * 6) * 0.5 + 0.5;
        h[i] = fine[i] * 0.8 + band * 0.25;
        const l = 0.35 + fine[i] * 0.5 + band * 0.15;
        col[i * 3] = 46 * l;
        col[i * 3 + 1] = 38 * l;
        col[i * 3 + 2] = 42 * l;
        rough[i] = 235;
      }
    }
    return { ...packCanvases(col, rough, null, S), normal: normalCanvas(h, 6, S) };
  });
}

// ---- Ornaments: inlaid border and floor medallion ---------------------------------------------------

const INLAY = {
  crypt: { metal: '#c9a24a', dark: '#5a3e14', glow: null },
  cave: { metal: '#5fbfa8', dark: '#1d4a40', glow: '#5fe0ff' },
  forge: { metal: '#d8843a', dark: '#4a1e08', glow: '#ff7a2a' },
  ice: { metal: '#cfe8ff', dark: '#24486c', glow: '#7ad8ff' },
  void: { metal: '#a070e0', dark: '#220c3a', glow: '#c080ff' },
};

// A meander band, one repeat per world unit (128 px), drawn as raised metal inlay.
function borderCanvas(kind) {
  return cachedTex('border-' + kind, () => {
    const W = 1024, H = 128, c = makeCanvas(W, H), g = c.getContext('2d'), s = INLAY[kind];
    const path = (ox) => {
      // a classic key: in, up, back, down — then on to the next unit
      g.moveTo(ox + 8, 104);
      g.lineTo(ox + 8, 24);
      g.lineTo(ox + 104, 24);
      g.lineTo(ox + 104, 88);
      g.lineTo(ox + 40, 88);
      g.lineTo(ox + 40, 56);
      g.lineTo(ox + 72, 56);
    };
    const stroke = (width, color) => {
      g.lineWidth = width;
      g.strokeStyle = color;
      g.lineJoin = 'miter';
      g.beginPath();
      for (let i = -1; i <= 8; i++) path(i * 128);
      g.stroke();
    };
    g.fillStyle = s.dark;
    g.globalAlpha = 0.55;
    g.fillRect(0, 6, W, 4);
    g.fillRect(0, H - 10, W, 4);
    g.globalAlpha = 1;
    stroke(16, s.dark);
    stroke(10, s.metal);
    stroke(3, 'rgba(255,250,230,0.55)');
    g.fillStyle = s.metal;
    g.fillRect(0, 7, W, 2);
    g.fillRect(0, H - 9, W, 2);
    return c;
  });
}

// A round inlay for the middle of each chamber: rings, runes and an eight-pointed star.
function medallionCanvas(kind, seed) {
  // not cached: one per chamber, cheap to paint, and large
  return (() => {
    const S = 1024, c = makeCanvas(S), g = c.getContext('2d'), s = INLAY[kind], rnd = mulberry32(seed);
    g.translate(S / 2, S / 2);
    const ring = (r, w, color) => {
      g.lineWidth = w;
      g.strokeStyle = color;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    };
    const metalRing = (r, w) => {
      ring(r, w + 6, s.dark);
      ring(r, w, s.metal);
      ring(r - w * 0.25, 2, 'rgba(255,250,230,0.5)');
    };
    g.fillStyle = 'rgba(10,6,12,0.35)';
    g.beginPath();
    g.arc(0, 0, 500, 0, Math.PI * 2);
    g.fill();
    metalRing(492, 14);
    metalRing(420, 8);
    // rune band between the two outer rings
    g.fillStyle = s.metal;
    g.strokeStyle = s.metal;
    g.lineWidth = 6;
    g.lineCap = 'round';
    for (let k = 0; k < 24; k++) {
      g.save();
      g.rotate((k / 24) * Math.PI * 2);
      g.translate(0, -456);
      g.beginPath();
      const strokes = 2 + Math.floor(rnd() * 3);
      for (let q = 0; q < strokes; q++) {
        g.moveTo((rnd() - 0.5) * 24, (rnd() - 0.5) * 30);
        g.lineTo((rnd() - 0.5) * 24, (rnd() - 0.5) * 30);
      }
      g.stroke();
      g.restore();
    }
    // eight-pointed star
    for (const [rot, len] of [[0, 380], [Math.PI / 8, 260]]) {
      g.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = rot + (k / 16) * Math.PI * 2, r = k % 2 ? 110 : len;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.lineWidth = 14;
      g.strokeStyle = s.dark;
      g.stroke();
      g.lineWidth = 8;
      g.strokeStyle = s.metal;
      g.stroke();
    }
    metalRing(120, 10);
    const gem = g.createRadialGradient(-20, -20, 4, 0, 0, 90);
    gem.addColorStop(0, '#fff6d8');
    gem.addColorStop(0.35, s.glow || s.metal);
    gem.addColorStop(1, s.dark);
    g.fillStyle = gem;
    g.beginPath();
    g.arc(0, 0, 86, 0, Math.PI * 2);
    g.fill();
    return c;
  })();
}

// ---- Effect textures ------------------------------------------------------------------------------

function fxCanvas(name) {
  return cachedTex('fx-' + name, () => {
    switch (name) {
      case 'spark': {
        const c = makeCanvas(64), g = c.getContext('2d');
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, 'rgba(255,255,255,1)');
        r.addColorStop(0.15, 'rgba(255,255,255,0.9)');
        r.addColorStop(0.4, 'rgba(255,255,255,0.25)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, 64, 64);
        return c;
      }
      case 'smoke': {
        const S = 128, c = makeCanvas(S), g = c.getContext('2d'), n = fbmField(71, 3, 4, S);
        const img = g.createImageData(S, S), d = img.data;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const i = y * S + x, dist = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
            const a = clamp((1 - dist) * 1.6, 0, 1) * clamp(n[i] * 1.6 - 0.3, 0, 1);
            d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
            d[i * 4 + 3] = a * 255;
          }
        }
        g.putImageData(img, 0, 0);
        return c;
      }
      case 'flame': {
        const c = makeCanvas(64, 128), g = c.getContext('2d');
        g.beginPath();
        g.moveTo(32, 4);
        g.bezierCurveTo(48, 40, 60, 70, 56, 92);
        g.bezierCurveTo(52, 116, 40, 124, 32, 124);
        g.bezierCurveTo(24, 124, 12, 116, 8, 92);
        g.bezierCurveTo(4, 70, 16, 40, 32, 4);
        const r = g.createRadialGradient(32, 96, 2, 32, 80, 60);
        r.addColorStop(0, 'rgba(255,255,240,1)');
        r.addColorStop(0.3, 'rgba(255,230,140,0.95)');
        r.addColorStop(0.7, 'rgba(255,140,40,0.6)');
        r.addColorStop(1, 'rgba(200,40,10,0)');
        g.fillStyle = r;
        g.filter = 'blur(3px)';
        g.fill();
        return c;
      }
      case 'ring': {
        const c = makeCanvas(256), g = c.getContext('2d');
        const r = g.createRadialGradient(128, 128, 60, 128, 128, 128);
        r.addColorStop(0, 'rgba(255,255,255,0)');
        r.addColorStop(0.75, 'rgba(255,255,255,0.15)');
        r.addColorStop(0.9, 'rgba(255,255,255,1)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, 256, 256);
        return c;
      }
      case 'slash': {
        // u runs along the swing, v across it: a bright leading rim fading to the inside
        const W = 256, H = 64, c = makeCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = x / (W - 1), v = 1 - y / (H - 1);
            const along = Math.pow(u, 1.6) * smooth(1, 0.85, u);
            const across = Math.pow(v, 2.2) + smooth(0.88, 1, v) * 0.8;
            const a = clamp(along * across * 1.6, 0, 1), i = (y * W + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = a * 255;
          }
        }
        g.putImageData(img, 0, 0);
        return c;
      }
      case 'shaft': {
        const W = 64, H = 256, c = makeCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
        const n = makeNoise(81, 8);
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const u = x / (W - 1), v = y / (H - 1);
            const a = Math.pow(Math.sin(u * Math.PI), 2) * smooth(0, 0.25, v) * smooth(1, 0.55, v) * (0.6 + n(u * 3, v * 6) * 0.6);
            const i = (y * W + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = clamp(a, 0, 1) * 255;
          }
        }
        g.putImageData(img, 0, 0);
        return c;
      }
      case 'portal': {
        const S = 256, c = makeCanvas(S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
            const arms = Math.pow(Math.sin(a * 3 + r * 9) * 0.5 + 0.5, 3);
            const k = clamp((1 - r) * 1.4, 0, 1) * (0.25 + arms * 0.9) + smooth(0.25, 0, r) * 0.8;
            const i = (y * S + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = clamp(k, 0, 1) * 255;
          }
        }
        g.putImageData(img, 0, 0);
        return c;
      }
      case 'tele': {
        // telegraph disc: faint fill, bright rim
        const c = makeCanvas(256), g = c.getContext('2d');
        const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        r.addColorStop(0, 'rgba(255,255,255,0.12)');
        r.addColorStop(0.8, 'rgba(255,255,255,0.32)');
        r.addColorStop(0.95, 'rgba(255,255,255,1)');
        r.addColorStop(1, 'rgba(255,255,255,0.0)');
        g.fillStyle = r;
        g.fillRect(0, 0, 256, 256);
        return c;
      }
      case 'grime': {
        const S = 256, c = makeCanvas(S), g = c.getContext('2d'), n = fbmField(99, 6, 4, S);
        const img = g.createImageData(S, S), d = img.data;
        for (let i = 0; i < S * S; i++) {
          const l = 200 + n[i] * 55;
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = l;
          d[i * 4 + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c;
      }
      default:
        return glowCanvas();
    }
  });
}

// The glowing depths beneath the chambers.
function abyssTexture(color) {
  return cachedTex('abyss-' + color, () => {
    const S = 512, c = makeCanvas(S), g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, 'rgba(20,4,10,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    const rnd = mulberry32(9);
    for (let i = 0; i < 60; i++) {
      const x = S / 2 + (rnd() - 0.5) * S * 0.85, y = S / 2 + (rnd() - 0.5) * S * 0.85, r = 8 + rnd() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,150,70,0.22)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return c;
  });
}

function lavaTexture(kind = 'forge') {
  const violet = kind === 'void';
  return cachedTex('lava-' + kind, () => {
    const S = 256, n = fbmField(93, 4, 4, S), v = voronoiField(94, 4, S);
    const c = makeCanvas(S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (let i = 0; i < S * S; i++) {
      const crust = Math.max(smooth(0.03, 0.12, v.edge[i]) * smooth(0.3, 0.55, n[i]), smooth(0.62, 0.8, n[i]) * 0.8);
      const hot = 1 - crust;
      if (violet) {
        d[i * 4] = 24 + hot * hot * 150;
        d[i * 4 + 1] = 6 + hot * hot * hot * 70;
        d[i * 4 + 2] = 40 + hot * 215;
      } else {
        d[i * 4] = 40 + hot * 215;
        d[i * 4 + 1] = 8 + hot * hot * 150;
        d[i * 4 + 2] = 4 + hot * hot * hot * 40;
      }
      d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}
