'use strict';

const MAP_W = 40;
const MAP_H = 40;
const T_WALL = 0;
const T_FLOOR = 1;
const T_STAIRS = 2;

function blankLevel() {
  const deco = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < deco.length; i++) deco[i] = rand(64);
  return { tiles: new Uint8Array(MAP_W * MAP_H), deco, rooms: [], start: null, stairs: null, boss: null };
}

function carveRect(L, x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) L.tiles[yy * MAP_W + xx] = T_FLOOR;
}
function carveH(L, x0, x1, y) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) L.tiles[y * MAP_W + x] = T_FLOOR;
}
function carveV(L, y0, y1, x) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) L.tiles[y * MAP_W + x] = T_FLOOR;
}

// Breadth-first distances (8 directions) from (sx, sy); -1 where unreachable.
function bfs(sx, sy, passable, maxDist = 999) {
  const dist = new Int16Array(MAP_W * MAP_H).fill(-1);
  const queue = new Int32Array(MAP_W * MAP_H);
  let head = 0, tail = 0;
  dist[sy * MAP_W + sx] = 0;
  queue[tail++] = sy * MAP_W + sx;
  while (head < tail) {
    const i = queue[head++];
    const x = i % MAP_W, y = (i / MAP_W) | 0, d = dist[i];
    if (d >= maxDist) continue;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const j = ny * MAP_W + nx;
      if (dist[j] !== -1 || !passable(nx, ny)) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }
  return dist;
}

function placeStairsFarthest(L, candidates) {
  const dist = bfs(L.start.x, L.start.y, (x, y) => L.tiles[y * MAP_W + x] !== T_WALL);
  let best = null, bestD = -1;
  for (const [x, y] of candidates) {
    const d = dist[y * MAP_W + x];
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  L.tiles[best.y * MAP_W + best.x] = T_STAIRS;
  L.stairs = best;
}

// Classic rooms and L-shaped corridors.
function genRooms() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const L = blankLevel();
    const rooms = [];
    for (let i = 0; i < 150 && rooms.length < 11; i++) {
      const w = randInt(4, 9), h = randInt(4, 7);
      const x = randInt(1, MAP_W - w - 1), y = randInt(1, MAP_H - h - 1);
      // keep at least one wall between rooms
      if (rooms.some((r) => x <= r.x + r.w && x + w >= r.x && y <= r.y + r.h && y + h >= r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
      carveRect(L, x, y, w, h);
    }
    if (rooms.length < 6) continue;

    const corridor = (a, b) => {
      if (chance(0.5)) { carveH(L, a.cx, b.cx, a.cy); carveV(L, a.cy, b.cy, b.cx); }
      else { carveV(L, a.cy, b.cy, a.cx); carveH(L, a.cx, b.cx, b.cy); }
    };
    // join each room to its nearest earlier room, then add a few loops
    for (let i = 1; i < rooms.length; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
        if (d < bestD) { bestD = d; best = j; }
      }
      corridor(rooms[i], rooms[best]);
    }
    for (let e = 0; e < 3; e++) {
      const a = pick(rooms), b = pick(rooms);
      if (a !== b) corridor(a, b);
    }

    L.rooms = rooms;
    L.start = { x: rooms[0].cx, y: rooms[0].cy };
    const cells = [];
    for (const r of rooms.slice(1)) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push([x, y]);
    }
    placeStairsFarthest(L, cells);
    return L;
  }
  return fallbackLevel();
}

// Cellular-automaton caves, keeping only the largest connected cavern.
function genCaves() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const L = blankLevel();
    let t = new Uint8Array(MAP_W * MAP_H);
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) t[y * MAP_W + x] = chance(0.45) ? T_WALL : T_FLOOR;
    }
    const wallsAround = (src, x, y, r) => {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || src[ny * MAP_W + nx] === T_WALL) n++;
        }
      }
      return n;
    };
    for (let it = 0; it < 5; it++) {
      const next = new Uint8Array(MAP_W * MAP_H);
      for (let y = 1; y < MAP_H - 1; y++) {
        for (let x = 1; x < MAP_W - 1; x++) {
          const near = wallsAround(t, x, y, 1);
          const far = it < 3 ? wallsAround(t, x, y, 2) : 99;
          next[y * MAP_W + x] = near >= 5 || far <= 2 ? T_WALL : T_FLOOR;
        }
      }
      t = next;
    }
    L.tiles = t;

    // flood-fill regions and keep the biggest one
    const region = new Int16Array(MAP_W * MAP_H).fill(-1);
    let bestId = -1, bestSize = 0, id = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === T_WALL || region[i] !== -1) continue;
      const d = bfs(i % MAP_W, (i / MAP_W) | 0, (x, y) => t[y * MAP_W + x] !== T_WALL);
      let size = 0;
      for (let j = 0; j < d.length; j++) if (d[j] >= 0) { region[j] = id; size++; }
      if (size > bestSize) { bestSize = size; bestId = id; }
      id++;
    }
    if (bestSize < MAP_W * MAP_H * 0.35) continue;
    const cells = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === T_WALL) continue;
      if (region[i] !== bestId) t[i] = T_WALL;
      else cells.push([i % MAP_W, (i / MAP_W) | 0]);
    }
    const [sx, sy] = pick(cells);
    L.start = { x: sx, y: sy };
    placeStairsFarthest(L, cells);
    return L;
  }
  return fallbackLevel();
}

// Floor 10: a pillared hall with the Wyrm, reached from a small antechamber.
function genArena() {
  const L = blankLevel();
  carveRect(L, 11, 5, 18, 17);
  for (const [x, y] of [[14, 8], [25, 8], [14, 13], [25, 13], [14, 18], [25, 18]]) L.tiles[y * MAP_W + x] = T_WALL;
  carveV(L, 21, 27, 20);
  carveRect(L, 16, 27, 8, 6);
  L.start = { x: 20, y: 30 };
  L.boss = { x: 20, y: 8 };
  return L;
}

function fallbackLevel() {
  const L = blankLevel();
  carveRect(L, 5, 5, 30, 30);
  L.start = { x: 8, y: 8 };
  L.tiles[31 * MAP_W + 31] = T_STAIRS;
  L.stairs = { x: 31, y: 31 };
  return L;
}

// Recursive shadowcasting (Björn Bergström), one call per octant.
const FOV_MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

function shadowcast(ox, oy, radius, opaque, reveal) {
  reveal(ox, oy);
  for (let o = 0; o < 8; o++) {
    castLight(ox, oy, 1, 1.0, 0.0, radius, FOV_MULT[0][o], FOV_MULT[1][o], FOV_MULT[2][o], FOV_MULT[3][o], opaque, reveal);
  }
}

function castLight(cx, cy, row, start, end, radius, xx, xy, yx, yy, opaque, reveal) {
  if (start < end) return;
  const r2 = (radius + 0.5) * (radius + 0.5);
  let newStart = 0;
  for (let j = row; j <= radius; j++) {
    let dx = -j - 1;
    const dy = -j;
    let blocked = false;
    while (dx <= 0) {
      dx++;
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);
      if (start < rSlope) continue;
      if (end > lSlope) break;
      if (dx * dx + dy * dy < r2) reveal(X, Y);
      const op = opaque(X, Y);
      if (blocked) {
        if (op) { newStart = rSlope; continue; }
        blocked = false;
        start = newStart;
      } else if (op && j < radius) {
        blocked = true;
        castLight(cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, opaque, reveal);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}
