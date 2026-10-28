'use strict';

// Chamber layouts and collision. World units: x to the right, z toward the camera (south).
// Exit doors stand in the far (north) wall at z = -D/2; the hero arrives from the south.

const LAYOUTS = [
  [],
  [[-3.6, -4], [3.6, -4], [-3.6, 3], [3.6, 3]],
  [[0, -5], [-4.2, -0.5], [4.2, -0.5], [0, 3.6]],
  [[-4.6, -5.5], [-4.6, -1.5], [-4.6, 2.5], [4.6, -5.5], [4.6, -1.5], [4.6, 2.5]],
  [[-2.6, -1.5], [2.6, -1.5], [0, -5.5]],
  [[-4.2, -4.5], [4.2, 2.5], [0, -1]],
];

function doorXs(n) {
  return n === 1 ? [0] : n === 2 ? [-3.3, 3.3] : n === 3 ? [-4.6, 0, 4.6] : [];
}

function genRoom(biome, kind, doorCount) {
  const W = kind === 'boss' ? 18 : kind === 'rest' ? 12 : 14;
  const D = kind === 'boss' ? 22 : kind === 'rest' ? 14 : 20;
  const room = {
    W, D, kind, biome, obstacles: [], lava: [], decor: [],
    doors: doorXs(doorCount).map((x) => ({ x, z: -D / 2 })),
    spawn: { x: 0, z: D / 2 - 2 },
  };
  const floorKind = BIOMES[biome].floor;
  const solid = (x, z, r, kind2, extra = {}) => room.obstacles.push({ shape: 'circle', x, z, r, kind: kind2, ...extra });

  if (kind === 'combat') {
    const mirror = chance(0.5) ? -1 : 1;
    for (const [x, z] of pick(LAYOUTS)) {
      const k = floorKind === 'cave' ? (chance(0.5) ? 'crystal' : 'rock') : floorKind === 'forge' ? (chance(0.6) ? 'pillar' : 'rock') : (chance(0.8) ? 'pillar' : 'statue');
      solid(x * mirror, z, k === 'statue' ? 0.7 : k === 'rock' ? 0.75 : 0.6, k, { h: 1.6 + Math.random() * 1.6 });
    }
    // breakable urns along the edges
    const urns = 2 + rand(3);
    for (let i = 0; i < urns; i++) {
      const p = freePoint(room, { x: 0, z: room.spawn.z }, 3, 1.2);
      if (p) solid(p.x, p.z, 0.38, 'urn', { hp: 1 });
    }
    if (floorKind === 'forge') {
      const pools = 1 + rand(2);
      for (let i = 0; i < pools; i++) {
        const p = freePoint(room, { x: 0, z: room.spawn.z }, 5, 2.4);
        if (p) room.lava.push({ x: p.x, z: p.z, r: 1.3 + Math.random() * 0.6 });
      }
    }
  } else if (kind === 'rest') {
    solid(-3, -1.2, 1.25, 'fountain');
    room.obstacles.push({ shape: 'box', x: 3, z: -1.35, hw: 1.05, hd: 0.75, kind: 'merchant' });
    room.merchant = { x: 3, z: -0.2 };
    room.fountain = { x: -3, z: -1.2 };
  } else {
    for (const [x, z] of [[-6, -6.5], [6, -6.5], [-6, 5], [6, 5]]) solid(x, z, 0.65, floorKind === 'cave' ? 'crystal' : 'pillar', { h: 3.2 });
  }
  // braziers in the corners light every chamber
  const bx = W / 2 - 1, bz = D / 2 - 1.2;
  for (const [x, z] of [[-bx, -bz + 0.4], [bx, -bz + 0.4], [-bx, bz - 0.6], [bx, bz - 0.6]]) solid(x, z, 0.4, 'brazier');
  return room;
}

// A random open point, at least `away` from `from` and `margin` from walls and obstacles.
function freePoint(room, from, away, margin) {
  for (let i = 0; i < 80; i++) {
    const x = (Math.random() - 0.5) * (room.W - margin * 2);
    const z = (Math.random() - 0.5) * (room.D - margin * 2 - 2) - 0.5;
    if (Math.hypot(x - from.x, z - from.z) < away) continue;
    if (blockedAt(room, x, z, margin)) continue;
    if (room.lava.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + margin)) continue;
    return { x, z };
  }
  return null;
}

function blockedAt(room, x, z, r) {
  if (Math.abs(x) > room.W / 2 - r || Math.abs(z) > room.D / 2 - r) return true;
  for (const o of room.obstacles) {
    if (o.broken) continue;
    if (o.shape === 'circle') {
      if (Math.hypot(x - o.x, z - o.z) < o.r + r) return true;
    } else if (Math.abs(x - o.x) < o.hw + r && Math.abs(z - o.z) < o.hd + r) {
      return true;
    }
  }
  return false;
}

// Push a circle out of walls and obstacles. Returns true when something stopped it.
function collide(room, e, r) {
  let hit = false;
  const hx = room.W / 2 - r, hz = room.D / 2 - r;
  if (e.x < -hx) { e.x = -hx; hit = true; }
  if (e.x > hx) { e.x = hx; hit = true; }
  if (e.z < -hz) { e.z = -hz; hit = true; }
  if (e.z > hz) { e.z = hz; hit = true; }
  for (const o of room.obstacles) {
    if (o.broken) continue;
    if (o.shape === 'circle') {
      const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
      if (d < min) {
        const n = d > 1e-4 ? 1 / d : 0;
        e.x = o.x + (n ? dx * n : 1) * min;
        e.z = o.z + (n ? dz * n : 0) * min;
        hit = true;
      }
    } else {
      const cx = clamp(e.x, o.x - o.hw, o.x + o.hw), cz = clamp(e.z, o.z - o.hd, o.z + o.hd);
      const dx = e.x - cx, dz = e.z - cz, d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-4) {
          e.x = cx + (dx / d) * r;
          e.z = cz + (dz / d) * r;
        } else {
          e.z = o.z + o.hd + r;
        }
        hit = true;
      }
    }
  }
  return hit;
}

// Line of sight for archers and casters: urns do not block it.
function clearLine(room, x0, z0, x1, z1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.35);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    for (const o of room.obstacles) {
      if (o.broken || o.kind === 'urn') continue;
      if (o.shape === 'circle' ? Math.hypot(x - o.x, z - o.z) < o.r : Math.abs(x - o.x) < o.hw && Math.abs(z - o.z) < o.hd) return false;
    }
  }
  return true;
}
