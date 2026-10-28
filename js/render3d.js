'use strict';

// Third-person view, built with three.js. The camera stays behind the hero and swings round
// to follow the way they face. Movement, particles and floating numbers are shared with the
// top-down renderer (View); the 2D canvas stays on top as a transparent effects layer.
const V3 = {
  ok: false, active: false, canvas: null,
  renderer: null, scene: null, camera: null, heroLight: null, torchLights: [],
  raycaster: null, geo: null, shadowMat: null, materials: {},
  level: [], torchCells: [], // instanced meshes of the current floor: { mesh, cells }
  ents: new Map(), items: new Map(), fades: new Map(),
  stairsMark: null, marker: null,
  yaw: -Math.PI / 2, yawTarget: -Math.PI / 2, cardYaw: 0, px: 0, py: 0,
  dirty: true, tilesDirty: true, lastDraw: 0, w: 0, h: 0, dpr: 0,
  tmp: null, // scratch math objects, created once three.js is known to be loaded
};

const CAM = { back: 3.3, height: 5.6, ahead: 2.4, tilt: 0.5, hfov: 68 };
const WALL_H = 1;
const MEMORY_TINT = [0.42, 0.4, 0.56];

function init3D(canvas) {
  if (typeof THREE === 'undefined') return false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  } catch {
    return false;
  }
  V3.canvas = canvas;
  V3.renderer = renderer;
  renderer.setClearColor(0x0b0910, 1);

  const scene = (V3.scene = new THREE.Scene());
  // the camera sits ~6.5 units from the hero: fog starts past the hero and swallows the edge of sight
  scene.fog = new THREE.Fog(0x0b0910, 7.5, 16);
  V3.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 40);
  scene.add(new THREE.AmbientLight(0x8a7aa8, 0.6));
  V3.heroLight = new THREE.PointLight(0xffb070, 1.8, 10, 1.2);
  scene.add(V3.heroLight);
  // a fixed pool of torch lights, so the shaders never need recompiling
  for (let i = 0; i < 2; i++) {
    const light = new THREE.PointLight(0xff9a40, 0, 3.4, 1.5);
    V3.torchLights.push(light);
    scene.add(light);
  }
  V3.raycaster = new THREE.Raycaster();
  V3.tmp = {
    matrix: new THREE.Matrix4(), hidden: new THREE.Matrix4().makeScale(0, 0, 0),
    color: new THREE.Color(), vec: new THREE.Vector3(),
  };

  const flat = new THREE.PlaneGeometry(1, 1);
  flat.rotateX(-Math.PI / 2);
  const wall = new THREE.BoxGeometry(1, WALL_H, 1);
  wall.translate(0, WALL_H / 2, 0);
  const card = new THREE.PlaneGeometry(1, 1);
  card.translate(0, 0.5, 0);
  const shadow = new THREE.CircleGeometry(0.3, 14);
  shadow.rotateX(-Math.PI / 2);
  const ring = new THREE.RingGeometry(0.34, 0.45, 4, 1, Math.PI / 4);
  ring.rotateX(-Math.PI / 2);
  V3.geo = { flat, wall, card, shadow, ring };
  V3.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });

  const glow = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, fog: false });
  V3.stairsMark = new THREE.Mesh(ring, glow(0xf2a03d));
  V3.marker = new THREE.Mesh(ring, glow(0xffc777));
  V3.marker.scale.setScalar(0.75);
  scene.add(V3.stairsMark, V3.marker);

  Bus.on('floor', () => {
    V3.dirty = true;
    V3.px = S.player.x;
    V3.py = S.player.y;
  });
  Bus.on('turn', () => (V3.tilesDirty = true));
  Bus.on('reveal', () => (V3.tilesDirty = true));
  Bus.on('move', (e) => {
    if (e !== S.player) return;
    const dx = e.x - V3.px, dy = e.y - V3.py;
    if ((dx || dy) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) faceTowards(dx, dy);
    V3.px = e.x;
    V3.py = e.y;
  });
  Bus.on('attack', (a, target) => {
    if (a === S.player) faceTowards(target.x - a.x, target.y - a.y);
  });
  Bus.on('teleport', () => {
    V3.px = S.player.x;
    V3.py = S.player.y;
  });
  V3.ok = true;
  return true;
}

const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function faceTowards(dx, dy) {
  V3.yawTarget = V3.yaw + angleDiff(Math.atan2(dy, dx), V3.yaw);
}

// A screen-space direction (x right, y down) to a grid step, relative to where the camera looks.
function relativeDir(sx, sy) {
  const fx = Math.cos(V3.yaw), fz = Math.sin(V3.yaw);
  const wx = -sx * fz - sy * fx, wz = sx * fx - sy * fz;
  return SWIPE_DIRS[Math.round(Math.atan2(wz, wx) / (Math.PI / 4))];
}

function texture(canvas) {
  if (canvas.tex3d) return canvas.tex3d;
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  canvas.tex3d = t;
  return t;
}

function levelMaterials(theme) {
  if (V3.materials[theme]) return V3.materials[theme];
  const TS = tilesetFor(theme);
  const lambert = (c) => new THREE.MeshLambertMaterial({ map: texture(c) });
  const top = lambert(TS.wallTop), face = lambert(TS.face), torch = lambert(TS.faceTorch);
  top.color.setScalar(2.4); // the 2D wall-top texture is near black; lift it so wall blocks read as solid stone
  return (V3.materials[theme] = {
    floors: TS.floors.map(lambert),
    stairs: lambert(TS.stairs),
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    wall: [face, face, top, top, face, face],
    torch: [torch, torch, top, top, torch, torch],
  });
}

function buildLevel3D() {
  for (const { mesh } of V3.level) {
    V3.scene.remove(mesh);
    mesh.dispose();
  }
  V3.level = [];
  const mats = levelMaterials(S.theme);
  const groups = { floors: [[], [], [], []], stairs: [], wall: [], torch: [] };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y), t = S.tiles[i];
      if (t === T_WALL) {
        // only walls touching open ground can ever be seen
        if (!DIRS8.some(([dx, dy]) => inBounds(x + dx, y + dy) && S.tiles[idx(x + dx, y + dy)] !== T_WALL)) continue;
        const torch = THEMES[S.theme].torches && S.deco[i] % 11 === 0 && y + 1 < MAP_H && S.tiles[i + MAP_W] !== T_WALL;
        (torch ? groups.torch : groups.wall).push(i);
      } else if (t === T_STAIRS) {
        groups.stairs.push(i);
      } else {
        const d = S.deco[i];
        groups.floors[d < 54 ? d & 1 : d < 59 ? 2 : 3].push(i);
      }
    }
  }
  const add = (cells, geo, mat) => {
    if (!cells.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.frustumCulled = false; // instance bounds are not tracked, so never cull the batch
    V3.scene.add(mesh);
    V3.level.push({ mesh, cells });
  };
  groups.floors.forEach((cells, v) => add(cells, V3.geo.flat, mats.floors[v]));
  add(groups.stairs, V3.geo.flat, mats.stairs);
  add(groups.wall, V3.geo.wall, mats.wall);
  add(groups.torch, V3.geo.wall, mats.torch);
  V3.torchCells = groups.torch;
  refreshTiles3D();
}

// Unexplored tiles are collapsed to nothing; remembered ones are tinted cold and dark.
function refreshTiles3D() {
  const { matrix, hidden, color } = V3.tmp;
  for (const { mesh, cells } of V3.level) {
    for (let n = 0; n < cells.length; n++) {
      const i = cells[n];
      if (S.explored[i]) {
        matrix.makeTranslation((i % MAP_W) + 0.5, 0, ((i / MAP_W) | 0) + 0.5);
        mesh.setMatrixAt(n, matrix);
      } else {
        mesh.setMatrixAt(n, hidden);
      }
      if (visible[i]) color.setRGB(1, 1, 1);
      else color.setRGB(MEMORY_TINT[0], MEMORY_TINT[1], MEMORY_TINT[2]);
      mesh.setColorAt(n, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}

function makeCard(sprName, size, opacity = 1, fog = true) {
  const mat = new THREE.MeshBasicMaterial({
    map: texture(SPR[sprName].img), side: THREE.DoubleSide,
    alphaTest: 0.5, transparent: opacity < 1, opacity, fog,
  });
  const mesh = new THREE.Mesh(V3.geo.card, mat);
  mesh.rotation.order = 'YXZ';
  mesh.scale.setScalar(size);
  const shadow = new THREE.Mesh(V3.geo.shadow, V3.shadowMat);
  shadow.scale.setScalar(size > 1 ? size * 0.9 : size);
  V3.scene.add(mesh, shadow);
  return { mesh, shadow, mat, spr: sprName };
}

function dropCard(r) {
  V3.scene.remove(r.mesh, r.shadow);
  r.mat.dispose();
}

// Cards are upright planes facing the camera, leaned back a little so they read well from above.
function placeCard(r, x, y, z) {
  r.mesh.position.set(x, y, z);
  r.mesh.rotation.set(-CAM.tilt, V3.cardYaw, 0);
  r.shadow.position.set(x, 0.01, z);
}

function lightAt(x, z) {
  const p = entVis(S.player);
  return clamp(1.25 - Math.hypot(x - p.rx - 0.5, z - p.ry - 0.5) / 8, 0.45, 1);
}

function syncEntities3D(time) {
  const live = new Set();
  const list = S.dead ? S.monsters : [S.player, ...S.monsters];
  for (const e of list) {
    const def = e === S.player ? null : MONSTERS[e.type];
    const spr = def ? def.spr : 'heroBack';
    let r = V3.ents.get(e.id);
    if (!r || r.spr !== spr) {
      if (r) dropCard(r);
      // the boss ignores fog and darkness: it must loom from the far end of its hall
      r = makeCard(spr, def && def.boss ? 2.3 : 0.94, def && def.phase ? 0.8 : 1, !(def && def.boss));
      V3.ents.set(e.id, r);
    }
    live.add(e.id);
    const show = !def || visible[idx(e.x, e.y)] === 1;
    r.mesh.visible = r.shadow.visible = show;
    if (!show) continue;
    const v = entVis(e);
    const bump = v.bump > 0 ? Math.sin((1 - v.bump) * Math.PI) * 0.3 : 0;
    const x = v.rx + v.bdx * bump + 0.5, z = v.ry + v.bdy * bump + 0.5;
    const floating = def && (def.spr === 'bat' || def.spr === 'ghost');
    const hover = floating ? 0.14 + (View.reduced ? 0 : Math.sin(time * 5 + e.id) * 0.05) : 0;
    placeCard(r, x, hover, z);
    const b = def && !def.boss ? lightAt(x, z) : 1;
    r.mat.color.setRGB(b, b * (1 - 0.65 * v.flash), b * (1 - 0.65 * v.flash));
  }
  for (const [id, r] of V3.ents) {
    if (!live.has(id)) {
      dropCard(r);
      V3.ents.delete(id);
    }
  }
}

function syncItems3D(time) {
  for (const it of S.items) {
    let r = V3.items.get(it);
    if (!r) {
      r = makeCard(itemDef(it.id).spr, it.id === 'chest' ? 0.78 : 0.58);
      V3.items.set(it, r);
    }
    const i = idx(it.x, it.y);
    const show = S.explored[i] === 1 && (visible[i] === 1 || it.seen === 1);
    r.mesh.visible = r.shadow.visible = show;
    if (!show) continue;
    const bob = it.id === 'chest' || View.reduced ? 0 : 0.06 + Math.sin(time * 2.4 + it.x * 1.7 + it.y) * 0.04;
    placeCard(r, it.x + 0.5, bob, it.y + 0.5);
    r.mat.color.setScalar(visible[i] ? lightAt(it.x + 0.5, it.y + 0.5) : 0.35);
  }
  const live = new Set(S.items);
  for (const [it, r] of V3.items) {
    if (!live.has(it)) {
      dropCard(r);
      V3.items.delete(it);
    }
  }
}

function syncFades3D() {
  for (const f of View.fades) {
    let r = V3.fades.get(f);
    if (!r) {
      r = makeCard(f.spr, f.big ? 2.3 : 0.94, 0.99);
      V3.fades.set(f, r);
    }
    placeCard(r, f.x + 0.5, 0, f.y + 0.5);
    r.mat.opacity = Math.max(0, 1 - f.t / 0.45);
    r.mat.color.setRGB(1, 0.5, 0.5);
  }
  const live = new Set(View.fades);
  for (const [f, r] of V3.fades) {
    if (!live.has(f)) {
      dropCard(r);
      V3.fades.delete(f);
    }
  }
}

function resize3D() {
  const c = V3.canvas, w = c.clientWidth, h = c.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (!w || !h || (w === V3.w && h === V3.h && dpr === V3.dpr)) return;
  V3.w = w;
  V3.h = h;
  V3.dpr = dpr;
  V3.renderer.setPixelRatio(dpr);
  V3.renderer.setSize(w, h, false);
  // keep a usable horizontal field of view on tall phone screens
  const aspect = w / h, hfov = (CAM.hfov * Math.PI) / 180;
  const vfov = clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect), (50 * Math.PI) / 180, (80 * Math.PI) / 180);
  V3.camera.fov = (vfov * 180) / Math.PI;
  V3.camera.aspect = aspect;
  V3.camera.updateProjectionMatrix();
  V3.lastDraw = 0;
}

function updateCamera3D(dt, time) {
  // while walking to a tapped tile, look where we are heading rather than at each zigzag
  if (Input.auto && Input.auto.kind === 'travel' && View.marker) {
    const p = S.player, dx = View.marker.x - p.x, dy = View.marker.y - p.y;
    if (Math.hypot(dx, dy) > 1.5) V3.yawTarget = V3.yaw + angleDiff(Math.atan2(dy, dx), V3.yaw);
  }
  V3.yaw += (V3.yawTarget - V3.yaw) * (1 - Math.exp(-dt * 4.5));
  const fx = Math.cos(V3.yaw), fz = Math.sin(V3.yaw);
  const pv = entVis(S.player), hx = pv.rx + 0.5, hz = pv.ry + 0.5;
  let jx = 0, jy = 0;
  if (View.shake > 0 && !View.reduced) {
    jx = (Math.random() * 2 - 1) * View.shake * 0.15;
    jy = (Math.random() * 2 - 1) * View.shake * 0.15;
  }
  V3.camera.position.set(hx - fx * CAM.back + jx, CAM.height + jy, hz - fz * CAM.back);
  V3.camera.lookAt(hx + fx * CAM.ahead, 0.35, hz + fz * CAM.ahead);
  V3.cardYaw = Math.atan2(-fx, -fz);

  const flick = View.reduced ? 1 : 1 + 0.06 * Math.sin(time * 7.3) + 0.04 * Math.sin(time * 13.7 + 1.3);
  V3.heroLight.position.set(hx, 1.8, hz);
  V3.heroLight.intensity = 1.7 * flick;

  // the two nearest visible wall torches cast real light
  const near = V3.torchCells
    .filter((i) => visible[i])
    .map((i) => [i, Math.hypot((i % MAP_W) + 0.5 - hx, ((i / MAP_W) | 0) + 0.5 - hz)])
    .sort((a, b) => a[1] - b[1]);
  V3.torchLights.forEach((light, n) => {
    if (!near[n]) {
      light.intensity = 0;
      return;
    }
    const i = near[n][0];
    light.position.set((i % MAP_W) + 0.5, 0.75, ((i / MAP_W) | 0) + 1.15);
    light.intensity = View.reduced ? 1 : 1 + 0.25 * Math.sin(time * 9 + i);
  });
}

function render3D(now, dt) {
  if (!S) return;
  updateView(dt);
  resize3D();
  if (V3.dirty) {
    buildLevel3D();
    V3.dirty = false;
    V3.tilesDirty = false;
  } else if (V3.tilesDirty) {
    refreshTiles3D();
    V3.tilesDirty = false;
  }
  const time = now / 1000;
  updateCamera3D(dt, time);
  const turning = Math.abs(V3.yawTarget - V3.yaw) > 0.002;
  if (!turning && !isAnimating() && now - V3.lastDraw < 50) return;
  V3.lastDraw = now;

  syncEntities3D(time);
  syncItems3D(time);
  syncFades3D();
  const stairsShown = !!S.stairs && S.explored[idx(S.stairs.x, S.stairs.y)] === 1;
  V3.stairsMark.visible = stairsShown;
  if (stairsShown) {
    V3.stairsMark.position.set(S.stairs.x + 0.5, 0.02, S.stairs.y + 0.5);
    V3.stairsMark.material.opacity = 0.35 + 0.25 * Math.sin(time * 3);
  }
  V3.marker.visible = !!View.marker;
  if (View.marker) {
    V3.marker.position.set(View.marker.x + 0.5, 0.03, View.marker.y + 0.5);
    V3.marker.material.opacity = 0.5 + 0.4 * Math.sin(time * 8);
  }
  V3.renderer.render(V3.scene, V3.camera);
  drawOverlay3D(time);
}

// ---- Effects layer: the 2D canvas draws numbers, particles and bars at projected positions ----

function project3D(x, y, z) {
  const v = V3.tmp.vec.set(x, y, z);
  const dist = v.distanceTo(V3.camera.position);
  v.project(V3.camera);
  if (v.z > 1 || v.z < -1) return null;
  const W = View.canvas.width, H = View.canvas.height;
  const unit = H / (2 * Math.tan((V3.camera.fov * Math.PI) / 360) * dist); // pixels per world unit there
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, unit };
}

function drawOverlay3D(time) {
  const ctx = View.ctx, W = View.canvas.width, H = View.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const minText = 13 * View.dpr;

  for (const m of S.monsters) {
    if (!visible[idx(m.x, m.y)]) continue;
    const def = MONSTERS[m.type], v = entVis(m);
    const p = project3D(v.rx + 0.5, (def.boss ? 2.3 : 0.94) + 0.12, v.ry + 0.5);
    if (!p) continue;
    if (m.asleep) {
      const zt = (time * 0.8 + m.id * 0.37) % 1;
      ctx.globalAlpha = 1 - zt;
      drawText('z', p.x + p.unit * (0.2 + zt * 0.15), p.y - zt * p.unit * 0.4, '#bfe9f5', Math.max(minText, p.unit * 0.45));
      ctx.globalAlpha = 1;
    } else if (m.hp < m.maxHp && !def.boss) {
      const w = p.unit * 0.7, h = Math.max(3 * View.dpr, p.unit * 0.08);
      ctx.fillStyle = '#140f1a';
      ctx.fillRect(p.x - w / 2 - h / 2, p.y - h, w + h, h * 2);
      ctx.fillStyle = '#d8454f';
      ctx.fillRect(p.x - w / 2, p.y - h / 2, Math.max(h, w * (m.hp / m.maxHp)), h);
    }
  }

  for (const s of View.shots) {
    const a = s.t / s.dur;
    const p = project3D(s.x0 + (s.x1 - s.x0) * a, 0.55, s.y0 + (s.y1 - s.y0) * a);
    if (!p) continue;
    const z = Math.max(4, p.unit * 0.13);
    ctx.fillStyle = s.color;
    ctx.fillRect(p.x - z / 2, p.y - z / 2, z, z);
  }

  for (const part of View.parts) {
    const p = project3D(part.x, Math.max(0.03, 0.5 - (part.y - part.gy)), part.gy + part.z);
    if (!p) continue;
    const z = Math.max(2, p.unit * 0.06 * part.size);
    ctx.globalAlpha = 1 - part.life / part.max;
    ctx.fillStyle = part.color;
    ctx.fillRect(Math.round(p.x - z / 2), Math.round(p.y - z / 2), z, z);
  }
  ctx.globalAlpha = 1;

  for (const f of View.floats) {
    const a = f.t / f.dur;
    const p = project3D(f.x, 1.15 + a * 0.6, f.gy);
    if (!p) continue;
    ctx.globalAlpha = a < 0.7 ? 1 : 1 - (a - 0.7) / 0.3;
    drawText(f.text, p.x, p.y, f.color, Math.max(minText * 1.2, p.unit * 0.42) * f.scale);
  }
  ctx.globalAlpha = 1;
}

// Tap position -> tile: creatures first, then wall tops, then the floor.
function pick3D(clientX, clientY) {
  const rect = V3.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  V3.raycaster.setFromCamera(ndc, V3.camera);
  const owners = new Map();
  for (const [id, r] of V3.ents) if (r.mesh.visible) owners.set(r.mesh, id);
  const hits = V3.raycaster.intersectObjects([...owners.keys()], false);
  if (hits.length) {
    const id = owners.get(hits[0].object);
    const e = id === S.player.id ? S.player : S.monsters.find((m) => m.id === id);
    if (e) return { x: e.x, y: e.y };
  }
  const { origin, direction } = V3.raycaster.ray;
  if (direction.y >= 0) return { x: -1, y: -1 };
  const top = (WALL_H - origin.y) / direction.y;
  const wx = Math.floor(origin.x + direction.x * top), wz = Math.floor(origin.z + direction.z * top);
  if (inBounds(wx, wz) && S.tiles[idx(wx, wz)] === T_WALL && S.explored[idx(wx, wz)]) return { x: wx, y: wz };
  const ground = -origin.y / direction.y;
  return { x: Math.floor(origin.x + direction.x * ground), y: Math.floor(origin.z + direction.z * ground) };
}
