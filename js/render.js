'use strict';

// Canvas rendering. Game state is read-only here; animation state lives in View.
const View = {
  canvas: null, ctx: null, dpr: 1, k: 4, tile: 32,
  camX: 0, camY: 0, snap: true, shake: 0, lastDraw: 0, reduced: false,
  ents: new Map(), // entity id -> { rx, ry, flash, bump, bdx, bdy }
  floats: [], parts: [], shots: [], fades: [], marker: null,
  tilesets: {},
};

const BG = '#0b0910';
const UI_FONT = '"Jersey 15", "Trebuchet MS", sans-serif';

function initView(canvas) {
  View.canvas = canvas;
  View.ctx = canvas.getContext('2d');
  try {
    View.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    View.reduced = false;
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resizeView) : null;
  if (ro) ro.observe(canvas);
  window.addEventListener('resize', resizeView);
  resizeView();

  Bus.on('floor', () => {
    View.ents.clear();
    View.parts = [];
    View.floats = [];
    View.shots = [];
    View.fades = [];
    View.marker = null;
    View.snap = true;
  });
  Bus.on('attack', (a, target) => {
    const v = entVis(a);
    v.bump = 1;
    v.bdx = Math.sign(target.x - a.x);
    v.bdy = Math.sign(target.y - a.y);
  });
  Bus.on('damage', (e, dmg, kind, color) => {
    const v = entVis(e);
    v.flash = 1;
    const isPlayer = e === S.player;
    const textColor = isPlayer ? '#ff6b6b' : kind === 'crit' ? '#f7d154' : kind === 'fire' ? '#ffb347' : '#f6f0e2';
    addFloat(e.x, e.y - 0.15, (kind === 'crit' ? '!' : '') + dmg, textColor, kind === 'crit' ? 1.25 : 1);
    burst(e.x + 0.5, e.y + 0.55, color, isPlayer ? 6 : 8, 2.2);
    if (isPlayer) View.shake = Math.max(View.shake, 0.35);
  });
  Bus.on('kill', (m, d) => {
    const v = entVis(m);
    View.fades.push({ spr: d.spr, x: v.rx, y: v.ry, t: 0, big: !!d.boss });
    burst(m.x + 0.5, m.y + 0.5, d.blood, d.boss ? 60 : 16, d.boss ? 4 : 3);
    View.ents.delete(m.id);
    if (d.boss) View.shake = 1;
  });
  Bus.on('shot', (from, to, color) => {
    View.shots.push({ x0: from.x + 0.5, y0: from.y + 0.5, x1: to.x + 0.5, y1: to.y + 0.5, t: 0, dur: 0.16, color });
  });
  Bus.on('fire', (targets) => {
    for (const m of targets) burst(m.x + 0.5, m.y + 0.7, '#ff8a3d', 18, 2.5, -3);
    View.shake = Math.max(View.shake, 0.3);
  });
  Bus.on('heal', (n) => {
    addFloat(S.player.x, S.player.y - 0.15, '+' + n, '#9be37a');
    burst(S.player.x + 0.5, S.player.y + 0.6, '#79c26a', 10, 1.5, -2.5);
  });
  Bus.on('buff', () => burst(S.player.x + 0.5, S.player.y + 0.6, '#f2a03d', 12, 1.8, -2.5));
  Bus.on('levelup', () => {
    addFloat(S.player.x, S.player.y - 0.5, 'NIVEAU !', '#f7d154', 1.1);
    burst(S.player.x + 0.5, S.player.y + 0.5, '#f7d154', 24, 2.5, -3);
  });
  Bus.on('teleport', (from) => {
    burst(from.x + 0.5, from.y + 0.5, '#a46fd8', 16, 2.5);
    const v = entVis(S.player);
    v.rx = S.player.x;
    v.ry = S.player.y;
    View.snap = true;
    burst(S.player.x + 0.5, S.player.y + 0.5, '#c9a4f0', 16, 2.5);
  });
  Bus.on('alert', (m) => addFloat(m.x, m.y - 0.35, '!', '#f7d154', 1.2));
  Bus.on('pickup', (it) => {
    if (it.id === 'gold') addFloat(it.x, it.y - 0.1, '+' + it.n, '#f7d154', 0.85);
    burst(it.x + 0.5, it.y + 0.5, '#f7d154', 6, 1.2);
  });
  Bus.on('chest', (it) => burst(it.x + 0.5, it.y + 0.5, '#f7d154', 16, 2.2));
  Bus.on('mimic', () => (View.shake = Math.max(View.shake, 0.4)));
  Bus.on('death', () => {
    burst(S.player.x + 0.5, S.player.y + 0.5, '#d8454f', 30, 3);
    View.shake = 0.6;
  });
  Bus.on('victory', () => {
    for (let i = 0; i < 4; i++) burst(S.player.x + 0.5 + randInt(-3, 3), S.player.y + randInt(-3, 1), '#f7d154', 20, 3, -2);
  });
}

function tilesetFor(theme) {
  return View.tilesets[theme] || (View.tilesets[theme] = buildTileset(theme));
}

function resizeView() {
  const c = View.canvas;
  const rect = c.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  View.dpr = Math.min(window.devicePixelRatio || 1, 3);
  c.width = Math.round(rect.width * View.dpr);
  c.height = Math.round(rect.height * View.dpr);
  // whole-pixel scale so the pixel art stays crisp; about 12 tiles across a phone screen
  View.k = Math.max(2, Math.floor(Math.min(c.width / 12.5, c.height / 9) / 8));
  View.tile = View.k * 8;
  View.ctx.imageSmoothingEnabled = false;
  View.snap = true;
  View.lastDraw = 0;
}

function entVis(e) {
  let v = View.ents.get(e.id);
  if (!v) {
    v = { rx: e.x, ry: e.y, flash: 0, bump: 0, bdx: 0, bdy: 0 };
    View.ents.set(e.id, v);
  }
  return v;
}

function addFloat(x, y, text, color, scale = 1) {
  View.floats.push({ x: x + 0.5, y, gy: Math.floor(y + 0.5) + 0.5, text, color, scale, t: 0, dur: 0.95 });
}

function burst(x, y, color, n, speed, lift = 0) {
  if (View.reduced) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    View.parts.push({
      x, y, gy: y, z: 0, vx: Math.cos(a) * s, vy: Math.sin(a) * s + lift, vz: (Math.random() * 2 - 1) * s * 0.7,
      life: 0, max: 0.35 + Math.random() * 0.4, color, size: Math.random() < 0.3 ? 2 : 1,
    });
  }
}

// World (tile units) -> canvas pixels.
function viewOrigin() {
  const W = View.canvas.width, H = View.canvas.height;
  return { ox: Math.round(W / 2 - View.camX), oy: Math.round(H / 2 - View.camY) };
}

function screenToTile(clientX, clientY) {
  if (V3.active) return pick3D(clientX, clientY);
  const rect = View.canvas.getBoundingClientRect();
  const { ox, oy } = viewOrigin();
  const px = (clientX - rect.left) * View.dpr, py = (clientY - rect.top) * View.dpr;
  return { x: Math.floor((px - ox) / View.tile), y: Math.floor((py - oy) / View.tile) };
}

function isAnimating() {
  if (View.floats.length || View.parts.length || View.shots.length || View.fades.length || View.shake > 0) return true;
  for (const v of View.ents.values()) if (v.flash > 0 || v.bump > 0) return true;
  if (!S) return false;
  for (const e of [S.player, ...S.monsters]) {
    const v = View.ents.get(e.id);
    if (v && (Math.abs(v.rx - e.x) > 0.002 || Math.abs(v.ry - e.y) > 0.002)) return true;
  }
  const pv = View.ents.get(0);
  if (pv) {
    const t = View.tile;
    if (Math.abs(View.camX - (pv.rx * t + t / 2)) > 0.5 || Math.abs(View.camY - (pv.ry * t + t / 2)) > 0.5) return true;
  }
  return false;
}

function updateView(dt) {
  if (!S) return;
  const follow = 1 - Math.exp(-dt * 20);
  for (const e of [S.player, ...S.monsters]) {
    const v = entVis(e);
    v.rx += (e.x - v.rx) * follow;
    v.ry += (e.y - v.ry) * follow;
    // long jumps (ghost reappearing, teleport) are not worth animating
    if (Math.abs(v.rx - e.x) > 3 || Math.abs(v.ry - e.y) > 3) { v.rx = e.x; v.ry = e.y; }
    v.flash = Math.max(0, v.flash - dt * 6);
    v.bump = Math.max(0, v.bump - dt * 7);
  }
  const pv = entVis(S.player), t = View.tile;
  const tx = pv.rx * t + t / 2, ty = pv.ry * t + t / 2;
  if (View.snap) {
    View.camX = tx;
    View.camY = ty;
    View.snap = false;
  } else {
    const c = 1 - Math.exp(-dt * 14);
    View.camX += (tx - View.camX) * c;
    View.camY += (ty - View.camY) * c;
  }
  View.shake = Math.max(0, View.shake - dt * 1.6);

  for (const p of View.parts) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    p.vy += 6 * dt;
    p.vx *= 0.92;
  }
  View.parts = View.parts.filter((p) => p.life < p.max);
  for (const f of View.floats) f.t += dt;
  View.floats = View.floats.filter((f) => f.t < f.dur);
  for (const s of View.shots) s.t += dt;
  for (const s of View.shots) if (s.t >= s.dur) burst(s.x1, s.y1, s.color, 6, 1.8);
  View.shots = View.shots.filter((s) => s.t < s.dur);
  for (const f of View.fades) f.t += dt;
  View.fades = View.fades.filter((f) => f.t < 0.45);
}

function drawSprite(name, x, y, scale = 1, alpha = 1, flash = 0) {
  const s = SPR[name];
  const ctx = View.ctx, k = View.k * scale;
  const w = s.w * k, h = s.h * k;
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(s.img, Math.round(x), Math.round(y), w, h);
  if (flash > 0) {
    ctx.globalAlpha = alpha * Math.min(1, flash * 1.4);
    ctx.drawImage(s.white, Math.round(x), Math.round(y), w, h);
  }
  ctx.globalAlpha = 1;
}

function drawShadow(cx, by, w) {
  const ctx = View.ctx;
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.ellipse(cx, by, w, w * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawText(text, x, y, color, size) {
  const ctx = View.ctx;
  ctx.font = `${Math.round(size)}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 5);
  ctx.strokeStyle = '#0b0910';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function renderFrame(now, dt) {
  if (!View.canvas) return;
  updateView(dt);
  if (!isAnimating() && now - View.lastDraw < 70) return;
  View.lastDraw = now;
  drawWorld(now / 1000);
}

function drawWorld(time) {
  const ctx = View.ctx, W = View.canvas.width, H = View.canvas.height, t = View.tile;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  if (!S) return;
  const TS = tilesetFor(S.theme);
  let { ox, oy } = viewOrigin();
  if (View.shake > 0 && !View.reduced) {
    const m = View.shake * t * 0.18;
    ox += Math.round((Math.random() * 2 - 1) * m);
    oy += Math.round((Math.random() * 2 - 1) * m);
  }
  const x0 = Math.max(0, Math.floor(-ox / t)), x1 = Math.min(MAP_W - 1, Math.floor((W - ox) / t));
  const y0 = Math.max(0, Math.floor(-oy / t)), y1 = Math.min(MAP_H - 1, Math.floor((H - oy) / t));
  const torches = [];

  // tiles
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * MAP_W + x;
      if (!S.explored[i]) continue;
      const sx = ox + x * t, sy = oy + y * t;
      const tile = S.tiles[i];
      let img;
      if (tile === T_WALL) {
        const below = y + 1 < MAP_H ? S.tiles[i + MAP_W] : T_WALL;
        if (below !== T_WALL) {
          const torch = THEMES[S.theme].torches && S.deco[i] % 11 === 0;
          img = torch ? TS.faceTorch : TS.face;
          if (torch && visible[i]) torches.push([sx + t / 2, sy + t * 0.35]);
        } else img = TS.wallTop;
      } else if (tile === T_STAIRS) img = TS.stairs;
      else {
        const d = S.deco[i];
        img = TS.floors[d < 54 ? d & 1 : d < 59 ? 2 : 3];
      }
      ctx.drawImage(img, sx, sy, t, t);
    }
  }
  // remembered but not currently seen: dim it
  ctx.fillStyle = 'rgba(9,7,16,0.62)';
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * MAP_W + x;
      if (S.explored[i] && !visible[i]) ctx.fillRect(ox + x * t, oy + y * t, t, t);
    }
  }

  // items (remembered ones stay faintly drawn)
  for (const it of S.items) {
    const i = idx(it.x, it.y);
    if (!S.explored[i] || (!visible[i] && !it.seen)) continue;
    const sx = ox + it.x * t, sy = oy + it.y * t;
    const seen = visible[i] === 1;
    if (seen) drawShadow(sx + t / 2, sy + t * 0.92, t * 0.3);
    drawSprite(itemDef(it.id).spr, sx, sy, 1, seen ? 1 : 0.35);
  }

  // stairs glint so they are easy to spot
  if (S.stairs && visible[idx(S.stairs.x, S.stairs.y)]) {
    const a = 0.25 + 0.15 * Math.sin(time * 3);
    ctx.strokeStyle = `rgba(242,160,61,${a})`;
    ctx.lineWidth = View.k;
    ctx.strokeRect(ox + S.stairs.x * t + View.k / 2, oy + S.stairs.y * t + View.k / 2, t - View.k, t - View.k);
  }

  // dying monsters fade out
  for (const f of View.fades) {
    const s = 1 - f.t / 0.45;
    const big = f.big ? 2 : 1;
    const sx = ox + f.x * t - (big - 1) * t / 2, sy = oy + f.y * t - (big - 1) * t;
    drawSprite(f.spr, sx, sy, big, s, 1);
  }

  // monsters, then the player on top
  const mons = S.monsters.filter((m) => visible[idx(m.x, m.y)]).sort((a, b) => a.y - b.y);
  for (const m of mons) drawCreature(m, MONSTERS[m.type], ox, oy, time);
  if (!S.dead) drawCreature(S.player, null, ox, oy, time);

  // torchlight: warm near the hero, darker toward the edge of sight
  const pv = entVis(S.player);
  const pcx = ox + pv.rx * t + t / 2, pcy = oy + pv.ry * t + t / 2;
  const flick = View.reduced ? 1 : 1 + 0.025 * Math.sin(time * 7.3) + 0.018 * Math.sin(time * 13.7 + 1.3);
  const R = (FOV_RADIUS + 0.6) * t * flick;
  const g = ctx.createRadialGradient(pcx, pcy, t * 0.4, pcx, pcy, R);
  g.addColorStop(0, 'rgba(255,170,90,0.10)');
  g.addColorStop(0.45, 'rgba(255,140,60,0)');
  g.addColorStop(1, 'rgba(6,4,10,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = 'lighter';
  for (const [tx, ty] of torches) {
    const r = t * (1.5 + 0.12 * Math.sin(time * 9 + tx));
    const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
    tg.addColorStop(0, 'rgba(255,150,60,0.22)');
    tg.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = tg;
    ctx.fillRect(tx - r, ty - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  // effects above the lighting so they read clearly
  for (const s of View.shots) {
    const a = s.t / s.dur;
    const x = ox + (s.x0 + (s.x1 - s.x0) * a) * t, y = oy + (s.y0 + (s.y1 - s.y0) * a) * t;
    const z = View.k * 2;
    ctx.fillStyle = s.color;
    ctx.fillRect(x - z / 2, y - z / 2, z, z);
    ctx.globalAlpha = 0.5;
    const bx = ox + (s.x0 + (s.x1 - s.x0) * Math.max(0, a - 0.15)) * t, by = oy + (s.y0 + (s.y1 - s.y0) * Math.max(0, a - 0.15)) * t;
    ctx.fillRect(bx - z / 4, by - z / 4, z / 2, z / 2);
    ctx.globalAlpha = 1;
  }
  for (const p of View.parts) {
    const z = View.k * p.size;
    ctx.globalAlpha = 1 - p.life / p.max;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(ox + p.x * t - z / 2), Math.round(oy + p.y * t - z / 2), z, z);
  }
  ctx.globalAlpha = 1;

  if (View.marker) {
    const a = 0.5 + 0.4 * Math.sin(time * 8);
    ctx.strokeStyle = `rgba(242,160,61,${a})`;
    ctx.lineWidth = View.k;
    ctx.strokeRect(ox + View.marker.x * t + View.k * 1.5, oy + View.marker.y * t + View.k * 1.5, t - View.k * 3, t - View.k * 3);
  }

  for (const f of View.floats) {
    const a = f.t / f.dur;
    ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
    drawText(f.text, ox + f.x * t, oy + (f.y - a * 0.6) * t, f.color, t * 0.42 * f.scale);
  }
  ctx.globalAlpha = 1;
}

function drawCreature(e, def, ox, oy, time) {
  const t = View.tile, v = entVis(e);
  const bumpOff = v.bump > 0 ? Math.sin((1 - v.bump) * Math.PI) * 0.3 : 0;
  const x = v.rx + v.bdx * bumpOff, y = v.ry + v.bdy * bumpOff;
  const big = def && def.boss ? 2 : 1;
  const sx = ox + x * t, sy = oy + y * t;
  const floating = def && (def.spr === 'bat' || def.spr === 'ghost');
  const hover = floating && !View.reduced ? Math.round(Math.sin(time * 5 + e.id) * View.k) : 0;
  drawShadow(sx + t / 2, sy + t * 0.94, t * (0.3 * big));
  drawSprite(def ? def.spr : 'hero', sx - (big - 1) * t / 2, sy - (big - 1) * t + hover - (floating ? View.k : 0), big,
    def && def.phase ? 0.82 : 1, v.flash);

  if (!def) return;
  const m = e;
  if (m.asleep) {
    const zt = (time * 0.8 + e.id * 0.37) % 1;
    View.ctx.globalAlpha = 1 - zt;
    drawText('z', sx + t * (0.78 + zt * 0.15), sy + t * 0.05 - zt * t * 0.4, '#bfe9f5', t * 0.48);
    View.ctx.globalAlpha = 1;
  } else if (m.hp < m.maxHp && !def.boss) {
    const k = View.k, w = t - 2 * k;
    View.ctx.fillStyle = '#140f1a';
    View.ctx.fillRect(sx + k - k / 2, sy - k * 1.5 - k / 2, w + k, k * 2);
    View.ctx.fillStyle = '#d8454f';
    View.ctx.fillRect(sx + k, sy - k * 1.5, Math.max(k, w * (m.hp / m.maxHp)), k);
  }
}

// Small looping scene for the title screen: the hero on a torchlit landing.
function drawTitleArt(canvas, time) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, k = Math.floor(H / 24), t = k * 8;
  const TS = tilesetFor(0);
  g.imageSmoothingEnabled = false;
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const cols = Math.ceil(W / t) + 1, ox = Math.round(W / 2 - (cols * t) / 2), base = H - t;
  for (let c = 0; c < cols; c++) {
    g.drawImage(c % 4 === 1 ? TS.faceTorch : TS.face, ox + c * t, base - 2 * t, t, t);
    g.drawImage(TS.wallTop, ox + c * t, base - 3 * t, t, t);
    g.drawImage(c === cols - 2 ? TS.stairs : TS.floors[c % 3 === 0 ? 3 : c & 1], ox + c * t, base - t, t, t);
    g.drawImage(TS.floors[(c + 1) & 1], ox + c * t, base, t, t);
  }
  const hx = Math.round(W / 2 - t / 2), hy = base - t - (Math.sin(time * 2) > 0.85 ? k : 0);
  g.drawImage(SPR.hero.img, hx, hy, t, t);
  const flick = 1 + 0.04 * Math.sin(time * 7.3) + 0.03 * Math.sin(time * 12.1);
  const grad = g.createRadialGradient(W / 2, base - t / 2, t * 0.3, W / 2, base - t / 2, W * 0.55 * flick);
  grad.addColorStop(0, 'rgba(255,170,90,0.12)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(11,9,16,0.95)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
}
