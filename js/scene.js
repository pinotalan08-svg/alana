'use strict';

// Three.js view of the chamber. Reads the simulation (Ch, Run) and listens to its events;
// never changes game state. A transparent 2D canvas on top draws numbers, bolts and bars.

const SC = {
  ok: false, quality: 'high', canvas: null, overlay: null, octx: null, dpr: 1, w: 0, h: 0,
  maxDpr: 2, res: 1, frames: [], resTimer: 0,
  renderer: null, scene: null, camera: null, hemi: null, sun: null, heroLight: null, pool: [], fxLights: [],
  room: null, roomMats: [], lava: [], flames: [], doors: [], urns: new Map(), fountain: null,
  cloths: [], shafts: [], debris: [], mists: [], abyss: null,
  hero: null, heroWeapon: '', walk: 0, trail: null,
  enemies: new Map(), projs: new Map(), picks: new Map(), hazards: new Map(), teles: new Map(),
  fx: [], floats: [], parts: null, shake: 0, flash: 0, hurt: 0, time: 0,
  cam: { x: 0, z: 0, ready: false }, tex: {}, shared: new Set(),
};

const CAM_OFF = { y: 15.5, z: 10 };

function initScene(canvas, overlay) {
  if (typeof THREE === 'undefined') return false;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    return false;
  }
  SC.canvas = canvas;
  SC.overlay = overlay;
  SC.octx = overlay.getContext('2d');
  SC.renderer = renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  initModels();
  initPost(renderer);
  for (const t of [Models.glowTex, Models.grime, Models.gradient]) if (t) SC.shared.add(t);

  const scene = (SC.scene = new THREE.Scene());
  SC.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 160);
  SC.hemi = new THREE.HemisphereLight(0x6b5a8c, 0x2a1410, 0.7);
  SC.sun = new THREE.DirectionalLight(0xffd2a8, 0.75);
  const s = SC.sun.shadow;
  s.mapSize.set(2048, 2048);
  s.camera.left = s.camera.bottom = -15;
  s.camera.right = s.camera.top = 15;
  s.camera.near = 1;
  s.camera.far = 60;
  s.bias = -0.0012;
  s.normalBias = 0.02;
  SC.sun.castShadow = true;
  SC.heroLight = new THREE.PointLight(0xff9a50, 1.5, 11, 2);
  scene.add(SC.hemi, SC.sun, SC.sun.target, SC.heroLight);
  // fixed pools of point lights (braziers and lava, then flashes), so shaders never recompile
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xff8a3a, 0, 8, 2);
    SC.pool.push(l);
    scene.add(l);
  }
  for (let i = 0; i < 2; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 7, 2);
    l.userData = { t: 0, life: 1, peak: 0 };
    SC.fxLights.push(l);
    scene.add(l);
  }
  SC.parts = {
    glow: makeCloud(900, fxTex('spark'), true),
    smoke: makeCloud(160, fxTex('smoke'), false),
  };
  scene.add(SC.parts.glow.points, SC.parts.smoke.points);
  SC.trail = makeTrail();
  scene.add(SC.trail.mesh);

  listenScene();
  window.addEventListener('resize', () => (SC.w = 0));
  resizeScene();
  SC.ok = true;
  prewarmTextures();
  return true;
}

// The stone and metal textures are painted procedurally, which takes a moment per biome.
// Paint them one at a time while the player is in the menus, never during a fight.
function prewarmTextures() {
  const jobs = [
    () => ['spark', 'smoke', 'flame', 'ring', 'slash', 'shaft', 'portal', 'tele'].forEach(fxCanvas),
    () => rockSet(),
    ...['crypt', 'cave', 'forge', 'ice', 'void'].flatMap((k) => [() => floorSet(k), () => wallSet(k), () => borderCanvas(k)]),
    () => lavaTexture('forge'),
    () => lavaTexture('void'),
  ];
  const step = () => {
    if (!jobs.length) return;
    if (inRun() && !isPaused()) {
      setTimeout(step, 1000);
      return;
    }
    jobs.shift()();
    setTimeout(step, 60);
  };
  setTimeout(step, 300);
}

function setQuality(q) {
  SC.quality = q;
  const high = q === 'high';
  SC.sun.castShadow = high;
  SC.renderer.shadowMap.enabled = high;
  SC.res = 1;
  SC.scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) m.needsUpdate = true;
  });
  SC.w = 0;
  resizeScene();
}

function resizeScene() {
  const c = SC.canvas, w = c.clientWidth, h = c.clientHeight;
  SC.maxDpr = SC.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1;
  const dpr = Math.max(1, SC.maxDpr * SC.res);
  if (!w || !h || (w === SC.w && h === SC.h && Math.abs(dpr - SC.dpr) < 0.01)) return;
  SC.w = w;
  SC.h = h;
  SC.dpr = dpr;
  SC.renderer.setPixelRatio(dpr);
  SC.renderer.setSize(w, h, false);
  const od = Math.min(window.devicePixelRatio || 1, 2);
  SC.overlay.width = Math.round(w * od);
  SC.overlay.height = Math.round(h * od);
  SC.odpr = od;
  // keep about 11 units visible across a phone held upright, 12 deep when held sideways
  const dist = Math.hypot(CAM_OFF.y, CAM_OFF.z), aspect = w / h;
  const vfov = Math.max(2 * Math.atan(5.6 / (dist * aspect)), 2 * Math.atan(6.4 / dist));
  SC.camera.fov = clamp((vfov * 180) / Math.PI, 30, 70);
  SC.camera.aspect = aspect;
  SC.camera.updateProjectionMatrix();
  const scale = (h * dpr) / 2 / Math.tan((SC.camera.fov * Math.PI) / 360);
  for (const cl of Object.values(SC.parts)) cl.points.material.uniforms.scale.value = scale;
}

// Adaptive resolution: drop pixel density when frames run long, raise it back when there is room.
function adaptResolution(dt) {
  if (SC.quality !== 'high' || !inRun() || isPaused()) return;
  SC.frames.push(dt);
  if (SC.frames.length < 90) return;
  const avg = SC.frames.reduce((a, b) => a + b, 0) / SC.frames.length;
  SC.frames = [];
  const before = SC.res;
  if (avg > 1 / 42 && SC.maxDpr * SC.res > 1.01) SC.res = Math.max(1 / SC.maxDpr, SC.res - 0.15);
  else if (avg < 1 / 57 && SC.res < 1) SC.res = Math.min(1, SC.res + 0.08);
  if (before !== SC.res) SC.w = 0;
}

// ---- Textures and shared materials ---------------------------------------------------------------

function canvasTex(canvas, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function trackMat(m) {
  SC.roomMats.push(m);
  return m;
}

// Effect textures are shared by every chamber and effect, so they are made once and never freed.
function fxTex(name) {
  const key = 'fx-' + name;
  if (!SC.tex[key]) {
    SC.tex[key] = new THREE.CanvasTexture(fxCanvas(name));
    SC.shared.add(SC.tex[key]);
  }
  return SC.tex[key];
}

// Free the GPU buffers of an object that leaves the scene. Shared materials and textures stay.
function disposeObj(root, maps = false) {
  const keep = SC.keep || (SC.keep = new Set(Object.values(Models.props)));
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry && !o.isSprite) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) if (!keep.has(m)) mats.add(m);
  });
  for (const m of mats) {
    if (maps) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) if (m[k] && !SC.shared.has(m[k])) m[k].dispose();
    m.dispose();
  }
  if (root.userData.ownTex) root.userData.ownTex.forEach((t) => t.dispose());
}

function pbrSet(set, rx, ry, extra = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: canvasTex(set.map, rx, ry), normalMap: canvasTex(set.normal, rx, ry), roughnessMap: canvasTex(set.roughness, rx, ry),
    roughness: 1, metalness: 0.03, ...extra,
  });
  if (set.emissive) {
    m.emissiveMap = canvasTex(set.emissive, rx, ry);
    m.emissive = new THREE.Color(1, 1, 1);
    m.emissiveIntensity = extra.glow ?? 1.4;
  }
  return trackMat(m);
}

// ---- Chamber construction ----------------------------------------------------------------------------

function disposeRoom() {
  if (!SC.room) return;
  SC.scene.remove(SC.room);
  disposeObj(SC.room, true);
  Object.assign(SC, { roomMats: [], room: null, lava: [], flames: [], doors: [], fountain: null, cloths: [], shafts: [], debris: [], mists: [], abyss: null });
  SC.urns.clear();
  for (const v of SC.enemies.values()) {
    SC.scene.remove(v.m.root);
    disposeObj(v.m.root);
  }
  SC.enemies.clear();
  for (const map of [SC.projs, SC.picks, SC.hazards, SC.teles]) {
    for (const o of map.values()) {
      SC.scene.remove(o);
      disposeObj(o);
    }
    map.clear();
  }
  for (const f of SC.fx) {
    SC.scene.remove(f.obj);
    disposeObj(f.obj);
  }
  SC.fx = [];
  SC.floats = [];
}

function bannerTexture(biome) {
  const key = 'banner' + biome;
  if (SC.tex[key]) return SC.tex[key];
  const c = makeCanvas(256, 512), g = c.getContext('2d');
  const colors = [['#5a1420', '#2a0810'], ['#143a3a', '#081a1a'], ['#4a1a08', '#200a04'], ['#1e3e66', '#0a1830'], ['#3a1460', '#14062a']][biome];
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 512);
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 484);
  const glyph = ['skull', 'wave', 'flame', 'flake', 'eye'][biome];
  g.drawImage(emblemCanvas(glyph, biome === 3 ? '#cfeaff' : '#e8c060', 180, true), 38, 150, 180, 180);
  g.fillStyle = '#c9a24a';
  for (let x = 0; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 470);
    g.lineTo(x + 16, 512);
    g.lineTo(x + 32, 470);
    g.fill();
  }
  return (SC.tex[key] = c);
}

function buildRoomScene() {
  disposeRoom();
  const room = Ch.room, B = BIOMES[Ch.biome], g = new THREE.Group();
  SC.room = g;
  SC.scene.background = new THREE.Color(B.fog);
  SC.scene.fog = new THREE.Fog(B.fog, 24, 56);
  SC.hemi.color.set(B.sky);
  SC.hemi.groundColor.set(B.ground);
  SC.sun.color.set(B.light);
  Post.params.tint = new THREE.Color(...[[1.0, 0.97, 1.02], [0.95, 1.02, 1.04], [1.05, 0.98, 0.94], [0.96, 1.0, 1.06], [1.03, 0.95, 1.06]][Ch.biome]);
  const kind = B.floor, stone = STONE[kind];

  // floor, with an inlaid border and a medallion
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.W, room.D), pbrSet(floorSet(kind), room.W / 4, room.D / 4, { glow: kind === 'forge' ? 1.1 : kind === 'void' ? 1.0 : 1.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const inlay = INLAY[kind];
  const decal = (canvas, w, h, x, z, rot, repeat = 1) => {
    const t = canvasTex(canvas, repeat, 1);
    const m = trackMat(new THREE.MeshStandardMaterial({
      map: t, transparent: true, alphaTest: 0.25, metalness: 0.5, roughness: 0.56,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    if (inlay.glow) {
      m.emissive = new THREE.Color(inlay.glow);
      m.emissiveMap = t;
      m.emissiveIntensity = 0.55;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.rotation.set(-Math.PI / 2, 0, rot);
    mesh.position.set(x, 0.01, z);
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const inset = 0.75, bw = 0.62;
  const iw = room.W - inset * 2, id = room.D - inset * 2;
  decal(borderCanvas(kind), iw, bw, 0, -room.D / 2 + inset, 0, iw / 8);
  decal(borderCanvas(kind), iw, bw, 0, room.D / 2 - inset, Math.PI, iw / 8);
  decal(borderCanvas(kind), id, bw, -room.W / 2 + inset, 0, -Math.PI / 2, id / 8);
  decal(borderCanvas(kind), id, bw, room.W / 2 - inset, 0, Math.PI / 2, id / 8);
  if (Ch.kind !== 'rest') {
    const r = Ch.kind === 'boss' ? 4.6 : 3.2;
    decal(medallionCanvas(kind, Ch.biome * 7 + Run.room), r * 2, r * 2, 0, Ch.kind === 'boss' ? -1 : -0.5, 0);
  }

  // floating slab, the abyss below, drifting debris
  const rock = rockSet();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(room.W + 0.8, 9, room.D + 0.8), pbrSet(rock, 6, 3));
  slab.position.y = -4.52;
  g.add(slab);
  const abyss = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), trackMat(new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(abyssTexture(B.abyss)), fog: false })));
  abyss.rotation.x = -Math.PI / 2;
  abyss.position.set(0, -36, -10);
  g.add(abyss);
  SC.abyss = abyss;
  const rockMat = pbrSet(rock, 1, 1);
  const rnd = mulberry32(Run.room * 31 + 7);
  for (let i = 0; i < 9; i++) {
    const side = i % 2 ? 1 : -1, s = 0.6 + rnd() * 1.6;
    const d = new THREE.Mesh(displace(GEO.ico(1, 1), 0.45, i), rockMat);
    d.scale.set(s, s * 0.7, s);
    d.position.set(side * (room.W / 2 + 2.5 + rnd() * 7), -2 - rnd() * 7, -room.D / 2 + rnd() * room.D * 1.2);
    d.userData = { y: d.position.y, ph: rnd() * 6, spin: (rnd() - 0.5) * 0.2 };
    g.add(d);
    SC.debris.push(d);
  }
  const smokeTex = fxTex('smoke');
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Sprite(trackMat(new THREE.SpriteMaterial({ map: smokeTex, color: B.fog, transparent: true, opacity: 0.35, depthWrite: false })));
    const side = i % 2 ? 1 : -1;
    m.scale.setScalar(5 + rnd() * 5);
    m.position.set(side * (room.W / 2 + 1 + rnd() * 3), -0.8 + rnd() * 0.8, -room.D / 2 + rnd() * room.D);
    m.material.color.offsetHSL(0, 0, 0.12);
    m.userData = { x: m.position.x, ph: rnd() * 6 };
    g.add(m);
    SC.mists.push(m);
  }

  // walls
  const wall = wallSet(kind);
  const wallMat = (w, h) => pbrSet(wall, w / 4, h / 4, { glow: 1.2 });
  const H = 5.2, z0 = -room.D / 2 - 0.6;
  const gaps = room.doors.map((d) => [d.x - 1.6, d.x + 1.6]);
  let x = -room.W / 2 - 1;
  for (const [a, b] of [...gaps, [room.W / 2 + 1, room.W / 2 + 1]]) {
    if (a > x + 0.05) {
      const w = a - x;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(w, H, 1.2), wallMat(w, H));
      seg.position.set(x + w / 2, H / 2, z0);
      seg.receiveShadow = true;
      g.add(seg);
    }
    x = b;
  }
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(room.W + 2.4, 0.5, 1.6), wallMat(room.W, 0.5));
  cornice.position.set(0, H + 0.25, z0 + 0.1);
  g.add(cornice);
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, room.D + 1.6), wallMat(0.8, room.D));
    p.position.set(s * (room.W / 2 + 0.4), 0.55, -0.4);
    p.receiveShadow = true;
    g.add(p);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.16, room.D + 1.8), wallMat(1, room.D));
    cap.position.set(s * (room.W / 2 + 0.4), 1.18, -0.4);
    g.add(cap);
    const near = new THREE.Mesh(new THREE.BoxGeometry(room.W / 2 - 1.4, 0.7, 0.8), wallMat(room.W / 2, 1));
    near.position.set(s * (room.W / 4 + 0.7), 0.35, room.D / 2 + 0.4);
    g.add(near);
  }

  // props, merged into a few meshes for the whole chamber
  const PB = newBuilder(Models.props);
  const trim = INLAY[kind].metal;
  for (const d of room.doors) propDoor(PB, g, placeAt(d.x, -room.D / 2 - 0.15), stone, trim);
  const colXs = [-room.W / 2 - 0.2, room.W / 2 + 0.2, ...room.doors.flatMap((d) => [d.x - 1.95, d.x + 1.95])];
  for (const cx of colXs) propWallColumn(PB, g, placeAt(cx, -room.D / 2 + 0.05), stone);
  let lightIdx = 0;
  SC.pool.forEach((l) => {
    l.intensity = 0;
    l.userData.base = 0;
  });
  const flameTex = fxTex('flame');
  for (const o of room.obstacles) {
    const at = placeAt(o.x, o.z, (o.x * 7 + o.z * 3) % (Math.PI * 2));
    switch (o.kind) {
      case 'pillar': propPillar(PB, g, at, stone, o.h || 3, (o.h || 3) < 2.2); break;
      case 'statue': propStatue(PB, g, at, stone); break;
      case 'rock': propRock(PB, g, at, { forge: 0x3a2a26, ice: 0x8aa4bc, void: 0x2a2236 }[kind] || 0x4a5a56, o.r * 1.3, Math.round(o.x * 10 + o.z)); break;
      case 'crystal': propCrystal(PB, g, at, B.accent, Math.round(o.x * 13 + o.z * 7)); break;
      case 'fountain': propFountain(PB, g, at); break;
      case 'merchant': propMerchant(PB, g, placeAt(o.x, o.z + 0.2)); break;
      case 'urn': {
        const UB = newBuilder(Models.props), ug = new THREE.Group();
        propUrn(UB, ug, placeAt(0, 0, o.x));
        bake(UB);
        ug.position.set(o.x, 0, o.z);
        g.add(ug);
        SC.urns.set(o, ug);
        break;
      }
      case 'brazier': {
        propBrazier(PB, g, placeAt(o.x, o.z));
        const flames = [];
        for (let i = 0; i < 3; i++) {
          const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: i ? B.accent : 0xffe6b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
          f.center.set(0.5, 0.05);
          f.position.set(o.x + (i - 1) * 0.12, 1.25, o.z + (i === 1 ? 0.05 : 0));
          f.scale.set(0.6, 1.2, 1);
          g.add(f);
          flames.push(f);
        }
        const halo = glowSprite(B.accent, 2.4, 0.5);
        halo.position.set(o.x, 1.7, o.z);
        g.add(halo);
        SC.flames.push({ x: o.x, z: o.z, flames, halo });
        if (lightIdx < SC.pool.length) {
          const l = SC.pool[lightIdx++];
          l.color.set(B.accent);
          l.position.set(o.x, 2, o.z);
          l.userData.base = 1.6;
        }
        break;
      }
      default: break;
    }
  }
  // scattered decoration along the walls
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, z = -room.D / 2 + 1.6 + rnd() * (room.D - 3.2);
    const xx = side * (room.W / 2 - 0.55);
    if (room.obstacles.some((o) => Math.hypot(o.x - xx, o.z - z) < 1.4)) continue;
    const at = placeAt(xx, z, rnd() * 6);
    if (kind === 'crypt' || kind === 'void') (i % 2 ? propCandles : propBones)(PB, g, at, i + Run.room * 9);
    else if (kind === 'cave') propMushrooms(PB, g, at, B.accent, i + Run.room * 9);
    else if (kind === 'ice') {
      if (i % 2) propCrystal(PB, g, placeAt(xx, z, rnd() * 6, 0.45), B.accent, i + Run.room * 9);
      else propRock(PB, g, at, 0xc8dcec, 0.5, i + Run.room * 9);
    }
    else if (i % 3 === 0) propAnvil(PB, g, at);
    else propCandles(PB, g, at, i);
  }
  bake(PB);

  // banners hanging from the far wall between the doors
  const bannerMat = trackMat(new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bannerTexture(Ch.biome)), side: THREE.DoubleSide, roughness: 0.9 }));
  for (const bx of [-room.W / 2 + 1.6, room.W / 2 - 1.6]) {
    if (room.doors.some((d) => Math.abs(d.x - bx) < 2.4)) continue;
    const cloth = clothMesh(1.2, 2.6, 0xffffff, 0xffffff, bannerMat);
    cloth.position.set(bx, 4.6, -room.D / 2 + 0.05);
    g.add(cloth);
    SC.cloths.push({ mesh: cloth, kind: 'banner', ph: bx });
  }

  // doors: a swirling portal in the reward's colour, the reward emblem above
  const portalTex = fxTex('portal');
  for (const d of room.doors) {
    const look = rewardLook(d.reward), col = new THREE.Color(look.color);
    const portal = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), new THREE.MeshBasicMaterial({ map: portalTex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.2 }));
    portal.scale.set(1, 1.55, 1);
    portal.position.set(d.x, 1.9, -room.D / 2 - 0.05);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 4.4), trackMat(new THREE.MeshBasicMaterial({ color: 0x07040a })));
    dark.position.set(d.x, 1.9, -room.D / 2 - 0.12);
    const emblem = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(emblemCanvas(look.glyph, look.color, 256)), transparent: true }));
    emblem.scale.setScalar(1.45);
    emblem.position.set(d.x, 5.15, -room.D / 2 + 0.45);
    const halo = glowSprite(col, 3.2, 0.25);
    halo.position.copy(emblem.position);
    g.add(dark, portal, halo, emblem);
    SC.doors.push({ door: d, portal, halo, emblem, color: col });
  }

  // light shafts falling from above
  const shaftTex = fxTex('shaft');
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4 + rnd() * 1.5, 11), trackMat(new THREE.MeshBasicMaterial({
      map: shaftTex, color: B.light, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    })));
    m.position.set((rnd() - 0.5) * (room.W - 4), 4.6, -room.D / 2 + 2 + rnd() * room.D * 0.6);
    m.rotation.set(-0.3, 0, (rnd() - 0.5) * 0.5);
    m.userData = { ph: rnd() * 6, base: 0.08 + rnd() * 0.06 };
    g.add(m);
    SC.shafts.push(m);
  }

  for (const l of room.lava) {
    const voidPool = kind === 'void';
    const lavaMat = trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(lavaTexture(voidPool ? 'void' : 'forge'), l.r / 1.4, l.r / 1.4), color: new THREE.Color(1.5, 1.3, 1.2) }));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(l.r, 36), lavaMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(l.x, 0.02, l.z);
    const rim = new THREE.Mesh(new THREE.RingGeometry(l.r - 0.05, l.r + 0.3, 36), trackMat(new THREE.MeshStandardMaterial({ color: 0x140806, roughness: 0.9 })));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(l.x, 0.025, l.z);
    const glow = glowSprite(voidPool ? 0x9a4aff : 0xff6a1a, l.r * 3.2, 0.4);
    glow.position.set(l.x, 0.6, l.z);
    g.add(pool, rim, glow);
    SC.lava.push({ mat: lavaMat, l, color: voidPool ? 0xc080ff : 0xff8a2a });
    if (lightIdx < SC.pool.length) {
      const light = SC.pool[lightIdx++];
      light.color.set(voidPool ? 0x8a3aff : 0xff5a1a);
      light.position.set(l.x, 1.2, l.z);
      light.userData.base = 1.4;
    }
  }
  if (room.fountain) {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.05, 32), trackMat(new THREE.MeshStandardMaterial({ color: 0x2a8ac0, emissive: 0x2a9ad8, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 })));
    water.rotation.x = -Math.PI / 2;
    water.position.set(room.fountain.x, 0.42, room.fountain.z);
    const glow = glowSprite(0x7cd8ff, 3.4, 0.5);
    glow.position.set(room.fountain.x, 1.4, room.fountain.z);
    g.add(water, glow);
    SC.fountain = { water, x: room.fountain.x, z: room.fountain.z };
  }
  SC.scene.add(g);
  SC.cam.ready = false;
  if (SC.heroWeapon !== Run.weapon || SC.heroId !== Run.hero || !SC.hero) buildHeroModel();
  SC.trail.reset();
}

function buildHeroModel() {
  if (SC.hero) {
    SC.scene.remove(SC.hero.root);
    disposeObj(SC.hero.root);
  }
  SC.hero = buildHero(Run.weapon, Run.hero);
  SC.heroWeapon = Run.weapon;
  SC.heroId = Run.hero;
  SC.heroXray = addXray(SC.hero.root, new THREE.Color(0.42, 0.24, 0.12));
  SC.scene.add(SC.hero.root);
}

// A faint silhouette drawn wherever scenery stands between the camera and the hero.
// Scenery draws first, then the silhouette (only where it is behind something), then the hero.
function addXray(root, color) {
  // the stencil keeps overlapping body parts from adding up: each pixel is tinted once
  const mat = new THREE.MeshBasicMaterial({
    color, blending: THREE.AdditiveBlending, depthFunc: THREE.GreaterDepth, depthWrite: false, fog: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    o.renderOrder = 2;
    if (o.userData.outline) continue;
    const x = new THREE.Mesh(o.geometry, mat);
    x.renderOrder = 1;
    o.add(x);
  }
  return mat;
}

// ---- Particles: two point clouds with per-particle size and alpha -----------------------------------

function makeCloud(n, tex, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), alpha = new Float32Array(n), size = new Float32Array(n);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, scale: { value: 500 } },
    vertexShader: `attribute float alpha; attribute float size; attribute vec3 pcolor; uniform float scale; varying vec4 vC;
      void main() { vC = vec4(pcolor, alpha); vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; varying vec4 vC;
      void main() { vec4 t = texture2D(map, gl_PointCoord); float a = vC.a * t.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb * t.rgb, a); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points, pos, col, alpha, size, n, next: 0, additive,
    vel: new Float32Array(n * 3), base: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n),
    grav: new Float32Array(n), a0: new Float32Array(n), s0: new Float32Array(n), grow: new Float32Array(n), drag: new Float32Array(n),
  };
}

const tmpCol = typeof THREE !== 'undefined' ? new THREE.Color() : null;

// o: size, grow, life, grav, up, rise, spread, flat, alpha, bright, smoke, drag
function emit(x, y, z, count, color, speed = 3, o = {}) {
  if (!SC.ok) return;
  const cloud = o.smoke ? SC.parts.smoke : SC.parts.glow;
  tmpCol.set(color);
  const k = o.bright ?? (o.smoke ? 1 : 1.6);
  const n = Math.ceil(count * (Prefs.reduced ? 0.4 : SC.quality === 'high' ? 1 : 0.6));
  for (let j = 0; j < n; j++) {
    const i = cloud.next;
    cloud.next = (cloud.next + 1) % cloud.n;
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.9), up = o.up ?? 0.6;
    cloud.pos[i * 3] = x + (Math.random() - 0.5) * (o.spread || 0);
    cloud.pos[i * 3 + 1] = y + (Math.random() - 0.5) * (o.spread || 0) * 0.4;
    cloud.pos[i * 3 + 2] = z + (Math.random() - 0.5) * (o.spread || 0);
    cloud.vel[i * 3] = Math.cos(a) * s * (o.flat ?? 1);
    cloud.vel[i * 3 + 1] = up * s + (o.rise || 0);
    cloud.vel[i * 3 + 2] = Math.sin(a) * s * (o.flat ?? 1);
    cloud.base[i * 3] = tmpCol.r * k;
    cloud.base[i * 3 + 1] = tmpCol.g * k;
    cloud.base[i * 3 + 2] = tmpCol.b * k;
    cloud.max[i] = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
    cloud.life[i] = cloud.max[i];
    cloud.grav[i] = o.grav ?? -6;
    cloud.a0[i] = o.alpha ?? 1;
    cloud.s0[i] = (o.size ?? 0.22) * (0.6 + Math.random() * 0.8);
    cloud.grow[i] = o.grow ?? 0;
    cloud.drag[i] = o.drag ?? 2;
  }
}

function updateCloud(cloud, dt) {
  const { pos, col, alpha, size, vel, base, life, max, grav, a0, s0, grow, drag } = cloud;
  for (let i = 0; i < cloud.n; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    if (life[i] <= 0) {
      pos[i * 3 + 1] = -999;
      alpha[i] = 0;
      continue;
    }
    const d = Math.exp(-drag[i] * dt);
    vel[i * 3] *= d;
    vel[i * 3 + 2] *= d;
    vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] = Math.max(0.04, pos[i * 3 + 1] + vel[i * 3 + 1] * dt);
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    const f = life[i] / max[i], age = max[i] - life[i];
    alpha[i] = a0[i] * (cloud.additive ? f : Math.sin(Math.PI * (1 - f)));
    size[i] = s0[i] + grow[i] * age;
    col[i * 3] = base[i * 3];
    col[i * 3 + 1] = base[i * 3 + 1];
    col[i * 3 + 2] = base[i * 3 + 2];
  }
  const a = cloud.points.geometry.attributes;
  a.position.needsUpdate = a.pcolor.needsUpdate = a.alpha.needsUpdate = a.size.needsUpdate = true;
}

// ---- Sword trail --------------------------------------------------------------------------------------

function makeTrail() {
  const N = 18, geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 3), idx = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  const hist = [], vTip = new THREE.Vector3(), vBase = new THREE.Vector3(), color = new THREE.Color();
  return {
    mesh,
    reset() {
      hist.length = 0;
      mesh.visible = false;
    },
    update(active, rig, hex) {
      if (active) {
        rig.tip.getWorldPosition(vTip);
        rig.base.getWorldPosition(vBase);
        hist.unshift([vTip.x, vTip.y, vTip.z, vBase.x, vBase.y, vBase.z]);
      } else if (hist.length) {
        hist.splice(hist.length - 2, 2);
      }
      if (hist.length > N) hist.length = N;
      mesh.visible = hist.length > 1;
      if (!mesh.visible) return;
      color.set(hex);
      for (let i = 0; i < N; i++) {
        const h = hist[Math.min(i, hist.length - 1)], f = Math.max(0, 1 - i / (hist.length - 1 || 1)) * 2.2;
        pos.set([h[0], h[1], h[2], h[3], h[4], h[5]], i * 6);
        col.set([color.r * f, color.g * f, color.b * f, color.r * f * 0.25, color.g * f * 0.25, color.b * f * 0.25], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---- One-shot effects --------------------------------------------------------------------------------

function addFx(obj, life, update) {
  SC.scene.add(obj);
  SC.fx.push({ obj, t: 0, life, update });
}

function flashLight(x, y, z, color, intensity, life = 0.25) {
  const l = SC.fxLights.reduce((a, b) => (a.userData.t / a.userData.life > b.userData.t / b.userData.life ? a : b));
  l.position.set(x, y, z);
  l.color.set(color);
  l.userData = { t: 0, life, peak: intensity };
  l.intensity = intensity;
}

function ringFx(x, z, r, color, life = 0.45, y = 0.08, bright = 2) {
  const mat = new THREE.MeshBasicMaterial({ map: fxTex('ring'), color: new THREE.Color(color).multiplyScalar(bright), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  addFx(m, life, (f, a) => {
    m.scale.setScalar(Math.max(0.01, r * (0.25 + 0.75 * Math.sqrt(a))));
    mat.opacity = 1 - a;
  });
}

function slashGeometry(inner, outer, arc, reverse) {
  const segs = 20, pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = -arc / 2 + arc * t, u = reverse ? 1 - t : t;
    for (const [r, v] of [[inner, 0], [outer, 1]]) {
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      uv.push(u, v);
    }
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function slashFx(P, range, arc, color, thrust, reverse) {
  const tex = fxTex('slash');
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(slashGeometry(thrust ? 0.4 : 0.6, range, arc, reverse), mat);
  m.position.set(P.x, 1.05, P.z);
  m.rotation.y = -Math.atan2(P.face.z, P.face.x);
  addFx(m, 0.2, (f, a) => {
    mat.opacity = 1 - a * a;
    m.scale.setScalar(0.9 + a * 0.2);
  });
}

function beamFx(x, z, color) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.32, 16, 6, 1, true), mat);
  m.position.set(x, 8, z);
  addFx(m, 0.3, (f, a) => {
    mat.opacity = 1 - a;
    m.scale.x = m.scale.z = 1 + a * 2.5;
  });
  const g = glowSprite(color, 4.5, 1);
  g.position.set(x, 0.6, z);
  addFx(g, 0.35, (f, a) => (g.material.opacity = 1 - a));
  flashLight(x, 2, z, color, 4, 0.3);
}

function burstFx(x, y, z, color, size = 2) {
  const g = glowSprite(color, size, 1);
  g.position.set(x, y, z);
  addFx(g, 0.22, (f, a) => {
    g.material.opacity = 1 - a;
    g.scale.setScalar(size * (0.6 + a * 0.8));
  });
}

const elementColor = (src) => {
  const b = Run && slotBoon(src);
  return b ? ANCIENTS[BOONS[b.id].anc].color : '#ffe2b0';
};

function floatText(x, y, z, text, color, size = 1) {
  SC.floats.push({ x: x + (Math.random() - 0.5) * 0.4, y, z, text: String(text), color, size, t: 0 });
}

function listenScene() {
  Bus.on('chamber', buildRoomScene);
  Bus.on('spawn', (e) => {
    const m = buildEnemyModel(e.type);
    if (e.elite) {
      m.u.rimColor.value.set(0xc070ff);
      m.u.rimStrength.value = 1.2;
      const aura = glowSprite(0xb98cff, e.r * 4, 0.5);
      aura.position.y = 0.2;
      m.root.add(aura);
    }
    m.u.edgeColor.value.set(e.def.boss ? 0xff5a2a : 0xb070ff);
    m.u.dissolve.value = 1;
    const scale = m.root.scale.x * (e.elite ? 1.15 : 1);
    m.root.scale.setScalar(scale);
    SC.scene.add(m.root);
    SC.enemies.set(e, { m, dying: 0, walk: Math.random() * 6, scale, spawn: e.spawnT || 0.01 });
    if (e.spawnT > 0.2) portalFx(e.x, e.z, e.r * 2.6, e.def.boss ? 0xff3a2a : 0xa060ff, e.spawnT + 0.2);
  });
  Bus.on('hit', (e, dmg, crit, src) => {
    const col = crit ? '#ffd23a' : src === 'burn' ? '#ff8a3a' : src === 'storm' ? '#9fd4ff' : src === 'splash' || src === 'wall' ? '#5fe8d0'
      : src === 'shatter' ? '#c8f6ff' : '#ffffff';
    const h = (e.def.boss ? 3.2 : 1.7) * (SC.enemies.get(e)?.scale || 1);
    floatText(e.x, h, e.z, crit ? `${dmg}!` : dmg, col, crit ? 1.45 : src === 'burn' ? 0.75 : 1);
    if (src !== 'burn') {
      const ec = src === 'attack' || src === 'special' || src === 'cast' ? elementColor(src) : col;
      emit(e.x, 1, e.z, crit ? 22 : 12, ec, 6, { life: 0.35, size: 0.16, drag: 4 });
      burstFx(e.x, 1, e.z, ec, crit ? 3 : 1.8);
    }
    if (crit) {
      SC.shake = Math.max(SC.shake, 0.25);
      flashLight(e.x, 1.5, e.z, 0xffd23a, 2.5, 0.2);
    }
  });
  Bus.on('kill', (e) => {
    const v = SC.enemies.get(e);
    if (v) {
      v.dying = 0.001;
      v.m.u.edgeColor.value.set(0xff7a2a);
    }
    emit(e.x, 1, e.z, e.def.boss ? 120 : 30, e.def.color, e.def.boss ? 7 : 4.5, { up: 1, life: 0.7, size: 0.18 });
    emit(e.x, 0.6, e.z, e.def.boss ? 20 : 6, 0x2a2026, 1, { smoke: true, size: 1.2, grow: 1.5, life: 1, grav: 0, rise: 0.6, alpha: 0.5 });
    emit(e.x, 1, e.z, 5, 0xc9a8ff, 1, { rise: 2.2, grav: 0, life: 1.2, size: 0.45 });
  });
  Bus.on('hurt', () => {
    SC.shake = Math.max(SC.shake, 0.45);
    SC.hurt = 1;
    const P = Ch.player;
    emit(P.x, 1, P.z, 18, 0xff3040, 4, { life: 0.4 });
  });
  Bus.on('dash', (P) => {
    emit(P.x, 0.6, P.z, 16, 0xff6a5a, 1.5, { life: 0.4, up: 0.3, size: 0.2 });
    emit(P.x, 0.3, P.z, 5, 0x3a2a30, 1.5, { smoke: true, size: 0.7, grow: 1, life: 0.6, grav: 0, alpha: 0.45 });
    ringFx(P.x, P.z, 1.3, 0xffb0a0, 0.25);
  });
  Bus.on('swing', (P) => {
    const thrust = P.strikeKind === 2 || P.strikeKind === 'dash';
    slashFx(P, P.atk.range + 0.25, thrust ? 0.7 : P.atk.arc, elementColor('attack'), thrust, P.strikeKind === 0);
  });
  Bus.on('spin', (P, r) => {
    ringFx(P.x, P.z, r, elementColor('special'), 0.35, 0.9, 2.5);
    slashFx(P, r, Math.PI * 2, elementColor('special'), false, false);
    emit(P.x, 0.9, P.z, 34, elementColor('special'), 8, { up: 0.1, life: 0.4, flat: 1, size: 0.18 });
  });
  Bus.on('strike', (x, z) => {
    beamFx(x, z, 0x9fd4ff);
    emit(x, 0.5, z, 24, 0x9fd4ff, 6, { life: 0.4, size: 0.15 });
    SC.shake = Math.max(SC.shake, 0.15);
  });
  Bus.on('nova', (x, z, r) => {
    ringFx(x, z, r, 0xa8f0ff, 0.45);
    emit(x, 0.6, z, 30, 0xc8f6ff, 5, { life: 0.6, up: 0.4, size: 0.14 });
    flashLight(x, 1.5, z, 0x9fe6ff, 2.5, 0.35);
  });
  Bus.on('wave', (x, z, r) => {
    ringFx(x, z, r, 0x38d6b8, 0.45);
    emit(x, 0.4, z, 28, 0x5fe8d0, 5, { life: 0.5, up: 1.2, size: 0.16 });
  });
  Bus.on('splash', (e) => emit(e.x, 0.6, e.z, 12, 0x5fe8d0, 4, { life: 0.4, up: 1 }));
  Bus.on('burst', (e) => {
    emit(e.x, 0.8, e.z, 34, 0xff7a2a, 6, { life: 0.5, up: 1 });
    burstFx(e.x, 1, e.z, 0xff8a3a, 3.5);
    flashLight(e.x, 1.5, e.z, 0xff7a2a, 3, 0.3);
  });
  Bus.on('freeze', (e) => emit(e.x, 1, e.z, 18, 0xc8f6ff, 3, { life: 0.7, size: 0.14 }));
  Bus.on('slam', (x, z, r, look) => {
    ringFx(x, z, r, look ? lookColor(look) : 0xffb080, 0.4, 0.08, 1.4);
    emit(x, 0.3, z, 24, look ? lookColor(look) : 0xc0a080, 5, { life: 0.5, up: 0.8, size: 0.14 });
    emit(x, 0.3, z, 10, look === 'ice' ? 0x8aa4bc : look === 'void' ? 0x2a1a3a : 0x5a4a44, 2, { smoke: true, size: 1, grow: 2, life: 0.9, grav: 0, rise: 0.4, alpha: 0.5 });
    SC.shake = Math.max(SC.shake, 0.35);
  });
  Bus.on('blast', (h) => {
    const look = h.look;
    if (look === 'rock') {
      emit(h.x, 0.4, h.z, 32, 0xa08070, 6, { life: 0.5, up: 1.2 });
      emit(h.x, 0.5, h.z, 8, 0x4a3a34, 2, { smoke: true, size: 1.3, grow: 2, life: 1, grav: 0, rise: 0.8, alpha: 0.55 });
    } else if (look === 'ice' || look === 'void') {
      const col = lookColor(look);
      emit(h.x, 0.4, h.z, 26, col, 5, { life: 0.5, up: 1.3, size: 0.16 });
      emit(h.x, 0.5, h.z, 6, look === 'ice' ? 0x9ab4cc : 0x1a0a2a, 2, { smoke: true, size: 1.1, grow: 1.8, life: 0.9, grav: 0, rise: 0.6, alpha: 0.5 });
      burstFx(h.x, 0.6, h.z, col, h.r * 2);
      flashLight(h.x, 1.5, h.z, col, 2.5, 0.3);
    } else {
      const big = look === 'meteor';
      emit(h.x, 0.4, h.z, big ? 70 : 32, 0xff7a2a, big ? 9 : 6, { life: 0.6, up: 1.2 });
      emit(h.x, 0.5, h.z, big ? 16 : 8, 0x2a1a14, 2, { smoke: true, size: 1.3, grow: 2.5, life: 1.1, grav: 0, rise: 0.8, alpha: 0.55 });
      burstFx(h.x, 0.8, h.z, 0xffa040, big ? 7 : 4);
      flashLight(h.x, 1.5, h.z, 0xff7a2a, big ? 6 : 3.5, big ? 0.5 : 0.35);
      if (big) ringFx(h.x, h.z, h.r * 1.3, 0xffb060, 0.5, 0.1, 2.4);
    }
    SC.shake = Math.max(SC.shake, look === 'meteor' ? 0.6 : 0.25);
  });
  Bus.on('beam', (h) => {
    flashLight(h.x, 1.5, h.z, lookColor(h.look), 2.5, 0.3);
    SC.shake = Math.max(SC.shake, 0.15);
  });
  // skills
  Bus.on('skill', (id, P) => {
    const col = SKILLS[id].color;
    ringFx(P.x, P.z, 2.4, col, 0.45, 0.1, 2.4);
    emit(P.x, 1, P.z, 28, col, 4, { life: 0.6, up: 1.2, size: 0.16 });
    flashLight(P.x, 2, P.z, col, 3, 0.45);
    if (id === 'veil') emit(P.x, 0.6, P.z, 12, 0x1a0a2a, 2, { smoke: true, size: 1.1, grow: 1.6, life: 0.9, grav: 0, rise: 0.6, alpha: 0.6 });
  });
  Bus.on('blocked', (P) => {
    if (SC.time - (SC.lastBlock || 0) < 0.15) return;
    SC.lastBlock = SC.time;
    ringFx(P.x, P.z, 1.6, 0xffd98a, 0.25, 1, 2.5);
    emit(P.x, 1, P.z, 10, 0xffe8b0, 4, { life: 0.3, size: 0.12 });
  });
  Bus.on('aegisBurst', (x, z, r) => {
    ringFx(x, z, r, 0xffd98a, 0.45, 0.1, 2.5);
    emit(x, 1, z, 40, 0xffd98a, 7, { life: 0.5, up: 0.6, size: 0.16 });
    burstFx(x, 1, z, 0xffd98a, 5);
    flashLight(x, 1.5, z, 0xffd98a, 4, 0.4);
    SC.shake = Math.max(SC.shake, 0.4);
  });
  Bus.on('renewal', (P, heal) => {
    emit(P.x, 0.5, P.z, 40, 0xff9aa8, 2, { rise: 2.4, grav: 0, life: 1.1, size: 0.16, spread: 1.2 });
    emit(P.x, 0.5, P.z, 16, 0x9affc8, 1.5, { rise: 2, grav: 0, life: 1, size: 0.12, spread: 1.2 });
    floatText(P.x, 2.4, P.z, `+${heal}`, '#7dff9a', 1.2);
  });
  Bus.on('roar', () => (SC.shake = Math.max(SC.shake, 0.8)));
  Bus.on('bossDown', (e) => {
    SC.flash = 1;
    SC.shake = 1.2;
    for (let i = 0; i < 4; i++) emit(e.x, 1 + i, e.z, 30, i % 2 ? 0xffd23a : e.def.color, 8, { life: 1.2, up: 1 });
    flashLight(e.x, 3, e.z, 0xffd23a, 6, 1);
  });
  Bus.on('urn', (o) => {
    emit(o.x, 0.5, o.z, 20, 0xc0703a, 4, { life: 0.5, up: 1, bright: 1 });
    emit(o.x, 0.4, o.z, 4, 0x6a4a3a, 1.5, { smoke: true, size: 0.8, grow: 1, life: 0.7, grav: 0, alpha: 0.5 });
  });
  Bus.on('collect', (k) => {
    const col = k.kind === 'gold' ? 0xffd23a : k.kind === 'heal' ? 0xff5d6c : k.kind === 'crystal' ? 0xff4a6a : 0xffe8b0;
    emit(k.x, 0.8, k.z, k.kind === 'reward' ? 50 : 12, col, 3, { life: 0.7, up: 1.5 });
    if (k.kind === 'reward') flashLight(k.x, 1.5, k.z, 0xffe8b0, 3, 0.5);
  });
  Bus.on('fountain', () => {
    const f = Ch.room.fountain;
    emit(f.x, 1, f.z, 60, 0x7cd8ff, 3, { life: 1, up: 2 });
  });
  Bus.on('defiance', () => {
    const P = Ch.player;
    SC.flash = 0.8;
    ringFx(P.x, P.z, 4, 0xffd98a, 0.8);
  });
  Bus.on('death', () => {
    const P = Ch.player;
    emit(P.x, 1, P.z, 60, 0xff3040, 5, { life: 1, up: 1 });
    if (SC.hero) SC.hero.u.edgeColor.value.set(0xff3040);
  });
  Bus.on('cast', (P) => flashLight(P.x, 1.5, P.z, 0xff3a5a, 1.5, 0.2));
  Bus.on('projectileEnd', (p) => {
    if (p.owner === 'player' && p.kind !== 'crystal') emit(p.x, 1, p.z, 6, 0xffe0a0, 2, { life: 0.25 });
    else if (p.owner === 'enemy') emit(p.x, 1, p.z, 8, { orb: 0x7fffe0, ember: 0xff7a2a, shard: 0xbfefff, void: 0xb070ff }[p.kind] || 0xd0c0b0, 2.5, { life: 0.3 });
  });
}

// Colour of an effect by its element: ice, void, or the default fire.
const lookColor = (look, fallback = 0xff8a3a) => (look === 'ice' ? 0xbfefff : look === 'void' ? 0xb070ff : fallback);

function portalFx(x, z, size, color, life) {
  const tex = fxTex('portal');
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.06, z);
  addFx(m, life, (f, a) => {
    m.rotation.z += 0.08;
    mat.opacity = Math.sin(Math.PI * a);
    if (Math.random() < 0.5) emit(x + (Math.random() - 0.5) * size * 0.6, 0.1, z + (Math.random() - 0.5) * size * 0.6, 1, color, 0.3, { rise: 2, grav: 0, life: 0.7, size: 0.16 });
  });
}

// ---- Per-frame -----------------------------------------------------------------------------------------

function renderScene(dt, time) {
  if (!SC.ok) return;
  adaptResolution(dt);
  resizeScene();
  SC.time = time;
  if (!Ch || !SC.room) {
    SC.renderer.setRenderTarget(null);
    SC.renderer.render(SC.scene, SC.camera);
    return;
  }
  syncHero(dt, time);
  syncEnemies(dt, time);
  syncProjectiles(dt, time);
  syncPickups(dt, time);
  syncHazards(dt, time);
  syncTeles(time);
  for (const f of SC.fx) {
    f.t += dt;
    f.update(f, Math.min(1, f.t / f.life));
  }
  SC.fx = SC.fx.filter((f) => {
    if (f.t < f.life) return true;
    SC.scene.remove(f.obj);
    disposeObj(f.obj);
    return false;
  });
  updateCloud(SC.parts.glow, dt);
  updateCloud(SC.parts.smoke, dt);
  ambientFx(dt, time);
  updateCamera(dt);
  SC.hurt = Math.max(0, SC.hurt - dt * 2.5);
  if (SC.quality === 'high' && Post.ok) {
    Post.params.hurt = SC.hurt;
    Post.params.flash = SC.flash * 0.6;
    renderWithPost(SC.scene, SC.camera, time);
  } else {
    SC.renderer.setRenderTarget(null);
    SC.renderer.render(SC.scene, SC.camera);
  }
  drawOverlay(dt);
}

function waveCloth(c, time, speed, lean) {
  const geo = c.mesh.geometry, pos = geo.attributes.position, rest = c.mesh.userData.rest, h = c.mesh.userData.h;
  const cape = c.kind !== 'banner';
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], t = -y / h;
    const wave = Math.sin(time * (cape ? 7 : 1.8) + t * 4 + x * 3 + c.ph) * (cape ? 0.05 : 0.06) * t;
    // a cape gathers at the shoulders, flares at the hem and falls in vertical folds
    const fold = cape ? Math.sin(x * 16) * 0.035 * (0.35 + t) : 0;
    const xs = cape ? x * (0.75 + 0.4 * t) : x;
    pos.setXYZ(i, xs + wave * 0.5, y + t * t * lean * 0.25, -t * t * lean + wave + fold);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function ambientFx(dt, time) {
  for (const l of SC.pool) {
    if (l.userData.base) l.intensity = l.userData.base * (0.85 + 0.12 * Math.sin(time * 9 + l.position.x) + 0.06 * Math.sin(time * 23 + l.position.z));
  }
  for (const l of SC.fxLights) {
    const u = l.userData;
    if (u.peak) {
      u.t += dt;
      l.intensity = Math.max(0, u.peak * (1 - u.t / u.life));
      if (u.t >= u.life) u.peak = 0;
    }
  }
  const accent = BIOMES[Ch.biome].accent;
  for (const [i, b] of SC.flames.entries()) {
    b.flames.forEach((f, k) => {
      const s = 0.8 + 0.2 * Math.sin(time * (11 + k * 3) + i * 1.7) + 0.1 * Math.sin(time * 29 + k);
      f.scale.set((k === 1 ? 0.75 : 0.55) * (2 - s) * 0.6 + 0.2, (k === 1 ? 1.5 : 1.1) * s, 1);
    });
    b.halo.material.opacity = 0.4 + 0.1 * Math.sin(time * 13 + i);
    if (Math.random() < dt * 8) emit(b.x, 1.6, b.z, 1, accent, 0.4, { rise: 1.8, grav: 0, life: 1, size: 0.08, drag: 0.5 });
    if (Math.random() < dt * 2) emit(b.x, 2.2, b.z, 1, 0x2a2026, 0.2, { smoke: true, rise: 0.8, grav: 0, life: 2, size: 0.6, grow: 0.8, alpha: 0.3 });
  }
  for (const { mat, l, color } of SC.lava) {
    mat.map.offset.x = time * 0.02;
    mat.map.offset.y = Math.sin(time * 0.3) * 0.04;
    if (Math.random() < dt * 4) emit(l.x + (Math.random() - 0.5) * l.r, 0.1, l.z + (Math.random() - 0.5) * l.r, 2, color, 1, { rise: 1.2, life: 0.6, size: 0.1 });
  }
  if (SC.fountain) {
    SC.fountain.water.material.emissiveIntensity = 0.5 + 0.12 * Math.sin(time * 3);
    if (Math.random() < dt * 10) emit(SC.fountain.x, 1.55, SC.fountain.z, 1, 0x9fe6ff, 1.2, { up: 2.5, life: 0.8, size: 0.08 });
  }
  for (const d of SC.debris) {
    d.position.y = d.userData.y + Math.sin(time * 0.6 + d.userData.ph) * 0.3;
    d.rotation.y += d.userData.spin * dt;
  }
  for (const m of SC.mists) {
    m.position.x = m.userData.x + Math.sin(time * 0.15 + m.userData.ph) * 1.2;
    m.material.opacity = 0.25 + 0.1 * Math.sin(time * 0.3 + m.userData.ph);
  }
  for (const s of SC.shafts) s.material.opacity = s.userData.base * (0.8 + 0.25 * Math.sin(time * 0.7 + s.userData.ph));
  if (SC.abyss) SC.abyss.rotation.z = time * 0.01;
  for (const c of SC.cloths) waveCloth(c, time, 0, 0.05);
  // embers drifting up from the abyss, dust in the air
  if (Math.random() < dt * 8) {
    const room = Ch.room, side = Math.random() < 0.5 ? -1 : 1;
    emit(side * (room.W / 2 + 1.5 + Math.random() * 4), -1, (Math.random() - 0.5) * room.D, 1, accent, 0.3, { rise: 1.5, grav: 0.1, life: 3, size: 0.1, drag: 0.2 });
  }
  if (Math.random() < dt * 5) {
    const room = Ch.room;
    emit((Math.random() - 0.5) * room.W, 0.5 + Math.random() * 3, (Math.random() - 0.5) * room.D, 1, 0xfff0d0, 0.15, { rise: 0.1, grav: 0, life: 4, size: 0.05, bright: 0.6, drag: 0.1 });
  }
  const P = Ch.player;
  SC.heroLight.position.set(P.x, 3.4, P.z + 0.8);
  SC.heroLight.intensity = 1.5 + 0.08 * Math.sin(time * 8);
  for (const d of SC.doors) {
    const open = Ch.doorsOpen;
    d.portal.rotation.z = -time * (open ? 1.2 : 0.3);
    d.portal.material.opacity = open ? 0.85 + 0.15 * Math.sin(time * 3) : 0.12;
    d.halo.material.opacity = open ? 0.55 + 0.15 * Math.sin(time * 3) : 0.18;
    d.emblem.position.y = 5.15 + Math.sin(time * 2 + d.door.x) * 0.1;
    if (open && Math.random() < dt * 10) emit(d.door.x + (Math.random() - 0.5) * 1.6, 0.2, -Ch.room.D / 2 + 0.2, 1, d.color, 0.3, { rise: 2, grav: 0, life: 1, size: 0.12 });
  }
  for (const [o, m] of SC.urns) if (o.broken && m.visible) m.visible = false;
}

function updateCamera(dt) {
  const P = Ch.player, room = Ch.room;
  const tx = clamp(P.x, -room.W / 2 + 3.5, room.W / 2 - 3.5) * 0.85;
  const tz = clamp(P.z - 1.6, -room.D / 2 + 2, room.D / 2 - 3.5);
  if (!SC.cam.ready) {
    SC.cam.x = tx;
    SC.cam.z = tz;
    SC.cam.ready = true;
  }
  const k = 1 - Math.exp(-dt * 7);
  SC.cam.x += (tx - SC.cam.x) * k;
  SC.cam.z += (tz - SC.cam.z) * k;
  SC.shake = Math.max(0, SC.shake - dt * 2.2);
  const j = Prefs.reduced ? 0 : SC.shake * SC.shake * 0.5;
  const jx = (Math.random() - 0.5) * j, jz = (Math.random() - 0.5) * j;
  SC.camera.position.set(SC.cam.x + jx, CAM_OFF.y, SC.cam.z + CAM_OFF.z + jz);
  SC.camera.lookAt(SC.cam.x + jx, 0, SC.cam.z + jz);
  SC.sun.position.set(SC.cam.x - 8, 20, SC.cam.z + 6);
  SC.sun.target.position.set(SC.cam.x, 0, SC.cam.z);
}

// ---- Characters ----------------------------------------------------------------------------------------

const rotOf = (dx, dz) => Math.atan2(dx, dz);

function syncHero(dt, time) {
  const P = Ch.player, m = SC.hero, rig = m.rig;
  const speed = Math.hypot(P.vx, P.vz);
  m.root.position.set(P.x, 0, P.z);
  m.root.rotation.y = turnTo(m.root.rotation.y, rotOf(P.face.x, P.face.z), dt * 22);
  SC.walk += dt * Math.min(speed, 8) * 1.6;
  const amp = P.state === 'run' ? Math.min(1, speed / 5) : 0, s = Math.sin(SC.walk);
  rig.legs[0].rotation.x = s * 0.75 * amp;
  rig.legs[1].rotation.x = -s * 0.75 * amp;
  rig.knees[0].rotation.x = Math.max(0, -s) * 0.9 * amp;
  rig.knees[1].rotation.x = Math.max(0, s) * 0.9 * amp;
  rig.arms[0].rotation.set(-s * 0.6 * amp, 0, 0.1);
  rig.elbows[0].rotation.x = -0.3 - 0.3 * amp;
  rig.body.position.y = Math.abs(s) * 0.07 * amp;
  rig.body.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0.12 * amp, 0, 0);
  rig.head.rotation.set(Math.sin(time * 1.3) * 0.04, 0, 0);
  const w = rig.weapon;
  w.rotation.set(0.25, -0.5, 0);
  w.position.set(0.3, 1.05, 0.12);
  rig.arms[1].rotation.set(-0.4, 0, -0.1);
  rig.elbows[1].rotation.x = -0.5;
  let trail = false;
  if (Run.weapon === 'bow') {
    w.rotation.set(0, 0, 0);
    w.position.set(0.05, 1.2, 0.2);
    rig.arms[1].rotation.set(-1.3, 0, 0.2);
    rig.arms[0].rotation.set(-1.3 + (P.charging ? Math.min(P.charge, 0.5) * 0.6 : 0), 0, -0.2);
    if (P.state === 'volley') rig.body.rotation.x = -0.15;
  } else if (P.state === 'attack') {
    const a = P.atk, p = clamp((P.st - a.windup) / (a.active + 0.05), 0, 1);
    trail = P.st > a.windup * 0.6 && P.st < a.windup + a.active + 0.08;
    if (P.strikeKind === 2 || P.strikeKind === 'dash') {
      w.rotation.set(0, 0, 0);
      w.position.set(0.15, 1.1, 0.1 + p * 0.6);
      rig.arms[1].rotation.set(-1.4, 0, 0);
      rig.torso.rotation.set(0.25, 0, 0);
    } else {
      const dir = P.strikeKind === 0 ? 1 : -1;
      w.rotation.set(0, dir * (1.5 - p * 3.0), 0);
      rig.arms[1].rotation.set(-1.2, 0, dir * (0.6 - p * 1.2));
      rig.torso.rotation.set(0.1, dir * (0.45 - p * 0.9), 0);
    }
  } else if (P.state === 'special') {
    const sp = WEAPONS.sword.special, p = clamp(P.st / (sp.windup + 0.15), 0, 1);
    rig.body.rotation.y = -p * Math.PI * 2;
    w.rotation.set(0, Math.PI / 2, 0);
    rig.arms[1].rotation.set(-1.5, 0, 0);
    trail = p > 0.05 && p < 1;
  } else if (P.state === 'cast') {
    rig.arms[1].rotation.set(-2.2 + (P.st / CAST.recover) * 1.2, 0, 0);
  } else if (P.state === 'dash') {
    rig.body.rotation.x = 0.45;
  } else if (P.state === 'dead') {
    rig.body.rotation.x = -Math.min(1, P.st * 2) * 1.4;
    rig.body.position.y = 0.1;
  }
  SC.trail.update(trail, rig, elementColor('attack'));
  const lean = P.state === 'dash' ? 1.1 : 0.12 + amp * 0.55;
  waveCloth({ mesh: rig.cape, kind: 'cape', ph: 0 }, time, speed, lean);
  if (amp > 0.5 && Math.random() < dt * 6) emit(P.x, 0.05, P.z, 1, 0x6a5a5a, 0.4, { smoke: true, size: 0.35, grow: 0.6, life: 0.5, grav: 0, alpha: 0.35 });
  const blink = P.iframes > 0.1 && P.veilT <= 0 && P.state !== 'dash' && P.state !== 'dead' && Math.sin(time * 40) > 0;
  if (P.veilT > 0) {
    // wrapped in shadow: a violet sheen and wisps of smoke
    m.u.flash.value = 0.45 + 0.1 * Math.sin(time * 9);
    m.u.flashColor.value.set(0x5a2a9a);
    if (Math.random() < dt * 14) emit(P.x, 0.4 + Math.random(), P.z, 1, 0x2a1440, 0.5, { smoke: true, size: 0.5, grow: 0.8, life: 0.7, grav: 0, rise: 0.8, alpha: 0.5 });
  } else {
    m.u.flash.value = blink ? 0.35 : P.state === 'dash' ? 0.15 : 0;
    m.u.flashColor.value.set(P.state === 'dash' ? 0xffb0a0 : 0xffffff);
  }
  syncShield(P, time);
  m.u.dissolve.value = P.state === 'dead' ? Math.min(1, Math.max(0, P.st - 0.4) * 0.9) : 0;
  SC.heroXray.visible = P.state !== 'dead';
}

// The Aegis: a golden lattice of light around the hero while it lasts.
function syncShield(P, time) {
  if (!SC.shield) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1.25, 28, 18), new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.9, 0.62, 0.22), transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const lattice = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.3, 0.95, 0.35), wireframe: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    g.add(shell, lattice);
    g.userData.lattice = lattice;
    SC.scene.add(g);
    SC.shield = g;
  }
  const g = SC.shield, on = P.shieldT > 0 && P.state !== 'dead';
  g.visible = on;
  if (!on) return;
  const fading = P.shieldT < 0.6 ? 0.5 + 0.5 * Math.sin(time * 30) : 1;
  g.position.set(P.x, 1, P.z);
  g.scale.setScalar(1 + 0.04 * Math.sin(time * 6));
  g.userData.lattice.rotation.y = time * 0.8;
  g.userData.lattice.rotation.x = time * 0.3;
  g.userData.lattice.material.opacity = 0.35 * fading;
}

function syncEnemies(dt, time) {
  for (const [e, v] of SC.enemies) {
    const m = v.m, rig = m.rig, root = m.root;
    if (v.dying > 0) {
      v.dying += dt;
      const a = v.dying / 0.6;
      m.u.dissolve.value = Math.min(1, a);
      m.u.flash.value = Math.max(0, 0.6 - a);
      root.position.y = -a * 0.15;
      if (a >= 1) {
        SC.scene.remove(root);
        disposeObj(root);
        SC.enemies.delete(e);
      }
      continue;
    }
    m.u.dissolve.value = e.spawnT > 0 ? clamp(e.spawnT / v.spawn, 0, 1) : 0;
    root.position.set(e.x, e.y || 0, e.z);
    root.rotation.y = turnTo(root.rotation.y, rotOf(Math.cos(e.ang), Math.sin(e.ang)), dt * 14);
    const frozen = e.frozen > 0;
    if (e.flash > 0) {
      m.u.flash.value = e.flash * 0.9;
      m.u.flashColor.value.set(0xffffff);
    } else if (frozen) {
      m.u.flash.value = 0.45;
      m.u.flashColor.value.set(0x9fe6ff);
    } else if (e.burn > 0) {
      m.u.flash.value = 0.12 + 0.08 * Math.sin(time * 20);
      m.u.flashColor.value.set(0xff6a1a);
    } else {
      m.u.flash.value = 0;
    }
    if (e.burn > 0 && Math.random() < dt * 12) emit(e.x, 1, e.z, 1, 0xff7a2a, 0.6, { rise: 1.6, grav: 0, life: 0.5, size: 0.14 });
    if (e.chill > 0 && Math.random() < dt * 6) emit(e.x, 1, e.z, 1, 0xc8f6ff, 0.6, { rise: 0.6, grav: 0, life: 0.5, size: 0.1 });
    if (e.mark > 0 && Math.random() < dt * 4) emit(e.x, 2, e.z, 1, 0xb98cff, 0.3, { rise: 0.6, grav: 0, life: 0.6, size: 0.14 });
    if (e.type === 'wraith' && Math.random() < dt * 10) emit(e.x, 0.6, e.z, 1, 0x7fe0d0, 0.3, { rise: 0.8, grav: 0, life: 0.8, size: 0.2, bright: 1 });
    if (e.type === 'shade' && Math.random() < dt * 8) emit(e.x, 0.5, e.z, 1, 0x1a0a2a, 0.3, { smoke: true, rise: 0.6, grav: 0, life: 0.7, size: 0.5, grow: 0.6, alpha: 0.45 });
    if (e.type === 'voidlord' && Math.random() < dt * 12) emit(e.x + (Math.random() - 0.5) * 2.4, 0.3, e.z + (Math.random() - 0.5) * 2.4, 1, 0x2a1240, 0.3, { smoke: true, rise: 1, grav: 0, life: 1.3, size: 0.9, grow: 1, alpha: 0.5 });
    if (e.type === 'queen' && Math.random() < dt * 8) emit(e.x + (Math.random() - 0.5) * 2, 0.3, e.z + (Math.random() - 0.5) * 2, 1, 0xcff4ff, 0.2, { rise: 0.6, grav: 0, life: 1.2, size: 0.08 });
    if (frozen) continue;
    v.walk += dt * Math.min(e.speedNow, 8) * 1.8;
    animateEnemy(e, rig, v, time, Math.min(1, e.speedNow / 3));
  }
}

function animateEnemy(e, rig, v, time, amp) {
  const s = Math.sin(v.walk);
  const winding = e.state === 'windup' || e.state === 'aim' || e.state === 'cast' || e.state === 'sweep' || e.state === 'swipe' || e.state === 'charge' || e.state === 'wave';
  const striking = e.state === 'strike' || e.state === 'charging' || e.state === 'recover';
  if (rig.legs) {
    rig.legs[0].rotation.x = s * 0.7 * amp;
    rig.legs[1].rotation.x = -s * 0.7 * amp;
  }
  if (rig.arms) {
    const lift = winding ? -2.1 : striking ? -0.6 : -s * 0.5 * amp;
    rig.arms.forEach((a, i) => (a.rotation.x = i ? lift : winding ? -1.6 : s * 0.5 * amp));
  }
  if (rig.body) rig.body.position.y = (rig.body.userData.y0 ?? (rig.body.userData.y0 = rig.body.position.y)) + Math.abs(s) * 0.06 * amp;
  if (rig.head && e.type !== 'wyrm') rig.head.rotation.x = winding ? -0.2 : Math.sin(time * 2 + e.id) * 0.05;
  switch (e.def.model || e.type) {
    case 'bat': {
      const f = Math.sin(time * 22 + e.id) * 0.9;
      rig.wings[0].rotation.z = f;
      rig.wings[1].rotation.z = -f;
      rig.body.position.y = 1.2 + Math.sin(time * 5 + e.id) * 0.15;
      break;
    }
    case 'slime':
    case 'slimelet': {
      const sq = e.state === 'hop' ? 1.18 : 1 - 0.08 * Math.sin(time * 6 + e.id);
      rig.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      break;
    }
    case 'wraith':
      rig.body.position.y = 0.35 + Math.sin(time * 3 + e.id) * 0.15;
      rig.body.rotation.z = Math.sin(time * 1.7 + e.id) * 0.06;
      rig.orb.scale.setScalar(0.8 + (e.state === 'cast' ? e.st : 0) + Math.sin(time * 8) * 0.08);
      rig.body.visible = !(e.state === 'blink' && e.st > 0.2 && e.st < 0.5);
      break;
    case 'imp': {
      const f = Math.sin(time * 14 + e.id) * 0.5;
      rig.wings[0].rotation.y = f;
      rig.wings[1].rotation.y = -f;
      rig.body.position.y = 0.25 + Math.sin(time * 4 + e.id) * 0.1;
      rig.orb.scale.setScalar(0.9 + (e.state === 'windup' ? e.st * 1.5 : 0));
      break;
    }
    case 'brute':
    case 'troll':
      if (rig.torso) rig.torso.rotation.x = winding ? -0.35 : striking ? 0.4 : 0;
      break;
    case 'sentinel':
    case 'archer':
      if (rig.weapon) {
        rig.weapon.rotation.y = e.state === 'sweep' ? 1.2 : e.state === 'recover' && e.type === 'sentinel' ? -1.2 : 0;
        rig.weapon.rotation.x = e.state === 'charging' ? -0.3 : 0;
      }
      break;
    case 'golem':
      if (rig.torso) rig.torso.rotation.x = e.state === 'windup' ? -0.3 : e.state === 'spikes' ? 0.25 : 0;
      if (e.state === 'windup' || e.state === 'spikes') rig.arms.forEach((a) => (a.rotation.x = e.state === 'windup' ? -2.4 : -1.2));
      break;
    case 'eye': {
      const aim = e.state === 'aim' || e.state === 'volley';
      rig.body.position.y = 1.45 + Math.sin(time * 2.4 + e.id) * 0.15;
      rig.iris.position.x = Math.sin(time * 1.3 + e.id) * (aim ? 0 : 0.05);
      rig.iris.scale.setScalar(aim ? 1.25 : 1);
      rig.tentacles.forEach((t, i) => {
        t.rotation.x = Math.sin(time * 3 + i) * 0.35;
        t.rotation.z = Math.cos(time * 2.6 + i * 1.7) * 0.3;
      });
      rig.glow.material.opacity = aim ? 0.55 + 0.35 * Math.sin(time * 20) : 0.3;
      break;
    }
    case 'queen': {
      const casting = ['shards', 'blizzard', 'nova', 'lances'].includes(e.state);
      rig.body.position.y = 0.35 + Math.sin(time * 1.8) * 0.12;
      rig.arms[0].rotation.set(casting ? -1.6 : -0.2, 0, casting ? -0.3 : 0.1);
      rig.arms[1].rotation.set(casting ? -1.1 : -0.3, 0, 0);
      rig.orb.scale.setScalar(1 + (casting ? 0.35 : 0.1) * Math.sin(time * 10));
      rig.body.visible = !(e.state === 'blink' && e.st > 0.2 && e.st < 0.5);
      waveCloth({ mesh: rig.cape, kind: 'cape', ph: e.id }, time, 0, 0.18);
      break;
    }
    case 'voidlord': {
      const casting = ['beams', 'orbs', 'grasp', 'slam', 'rings'].includes(e.state);
      rig.body.position.y = 0.5 + Math.sin(time * 1.2) * 0.18;
      rig.orbs.rotation.y = time * (0.4 + (e.data.phase || 1) * 0.2);
      rig.core.scale.setScalar(1 + 0.15 * Math.sin(time * 4) + (casting ? 0.25 : 0));
      rig.arms.forEach((a, i) => a.rotation.set(casting ? -1.3 : -0.15 + Math.sin(time + i) * 0.08, 0, (i ? -1 : 1) * (e.state === 'beams' ? 0.7 : 0.1)));
      if (rig.head) rig.head.rotation.x = casting ? -0.25 : Math.sin(time * 0.8) * 0.06;
      break;
    }
    case 'wyrm': {
      const fl = Math.sin(time * (e.state === 'dive' ? 8 : 2.2)) * (e.state === 'dive' ? 0.8 : 0.25);
      rig.wings[0].rotation.z = fl;
      rig.wings[1].rotation.z = -fl;
      rig.tails.forEach((t, i) => (t.rotation.y = Math.sin(time * 2 - i * 0.6) * 0.22));
      const open = e.data.breathing || e.state === 'breath' ? 0.5 : 0.08 + Math.sin(time * 1.5) * 0.04;
      rig.jaw.rotation.x = open;
      rig.mouthGlow.material.opacity = e.data.breathing ? 1 : e.state === 'breath' ? 0.4 + e.st : 0.4;
      rig.neck.rotation.x = winding ? -0.25 : Math.sin(time * 0.9) * 0.05;
      if (Math.random() < 0.15) emit(e.x + Math.cos(e.ang) * 3, 3.5, e.z + Math.sin(e.ang) * 3, 1, 0x3a2a26, 0.3, { smoke: true, rise: 1, grav: 0, life: 1.4, size: 0.6, grow: 1, alpha: 0.35 });
      if (e.data.breathing) {
        const a = e.data.breathAng;
        for (let i = 0; i < 4; i++) {
          const d = 1.5 + Math.random() * 8.5, spread = (Math.random() - 0.5) * 0.6;
          emit(e.x + Math.cos(a + spread) * d, 0.8 + Math.random(), e.z + Math.sin(a + spread) * d, 1, i ? 0xff7a2a : 0xffd060, 1.5, { grav: 1, life: 0.5, size: 0.9, bright: 2 });
        }
        if (Math.random() < 0.3) flashLight(e.x + Math.cos(a) * 4, 1.5, e.z + Math.sin(a) * 4, 0xff7a2a, 3, 0.3);
      }
      break;
    }
    default: break;
  }
}

// ---- Projectiles, pickups, hazards, telegraphs ------------------------------------------------------------

function projectileObj(p) {
  const g = new THREE.Group();
  if (p.kind === 'crystal') {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.4, 0.6) }));
    c.scale.y = 1.6;
    g.add(c, glowSprite(0xff3a5a, 1.4, 0.9));
  } else if (p.kind === 'rock') {
    g.add(new THREE.Mesh(displace(GEO.ico(0.28, 0), 0.4, 3), Models.props.base));
  } else if (p.owner === 'player') {
    const len = p.pierce ? 1.4 : 0.9;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.8, 1.2) }));
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft, glowSprite(p.pierce ? 0xfff0c0 : 0xffc777, p.pierce ? 1.3 : 0.8, 1));
  } else if (p.kind === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), new THREE.MeshBasicMaterial({ color: 0xe6dcc4 }));
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft, glowSprite(0xff4a3a, 0.9, 0.9));
  } else if (p.kind === 'shard') {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.2, 2.6) }));
    c.scale.set(0.6, 0.6, 2.4);
    g.add(c, glowSprite(0x9fe6ff, 1, 0.9));
  } else if (p.kind === 'void') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.05, 0.4) }));
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 2.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, shell, glowSprite(0xb070ff, 1.5, 0.9));
  } else {
    const col = p.kind === 'orb' ? 0x7fffe0 : 0xff7a2a;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.5) })), glowSprite(col, p.kind === 'orb' ? 1.4 : 1.1, 1));
  }
  return g;
}

function syncProjectiles(dt, time) {
  const live = new Set(Ch.projectiles);
  for (const p of Ch.projectiles) {
    let o = SC.projs.get(p);
    if (!o) {
      o = projectileObj(p);
      SC.scene.add(o);
      SC.projs.set(p, o);
    }
    o.position.set(p.x, p.y || 1, p.z);
    o.rotation.y = rotOf(p.vx, p.vz);
    if (p.kind === 'crystal' || p.kind === 'rock') o.rotation.z += dt * 12;
    const trailCol = p.owner === 'player' ? (p.kind === 'crystal' ? 0xff3a5a : 0xffc777) : { orb: 0x7fffe0, ember: 0xff7a2a, shard: 0x9fe6ff, void: 0xa060ff }[p.kind] || null;
    if (trailCol && Math.random() < dt * 40) emit(p.x, p.y || 1, p.z, 1, trailCol, 0.2, { life: 0.3, grav: 0, size: 0.12 });
  }
  for (const [p, o] of SC.projs) {
    if (!live.has(p)) {
      SC.scene.remove(o);
      disposeObj(o);
      SC.projs.delete(p);
    }
  }
}

function pickupObj(k) {
  const g = new THREE.Group();
  if (k.kind === 'gold') {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), Models.props.metal);
    coin.rotation.x = Math.PI / 2;
    const tint = new THREE.Mesh(coin.geometry, new THREE.MeshStandardMaterial({ color: 0xf7c948, metalness: 0.9, roughness: 0.25, emissive: 0x4a3000 }));
    tint.rotation.x = Math.PI / 2;
    g.add(tint, glowSprite(0xffd23a, 0.9, 0.6));
  } else if (k.kind === 'heal') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.5, 0.6) })), glowSprite(0xff5d6c, 1.3, 0.8));
  } else if (k.kind === 'crystal') {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.4, 0.6) }));
    c.scale.y = 1.7;
    g.add(c, glowSprite(0xff3a5a, 1.5, 0.8));
  } else {
    const look = rewardLook(k.reward), col = new THREE.Color(look.color);
    const tex = new THREE.CanvasTexture(emblemCanvas(look.glyph, look.color, 256));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    g.userData.ownTex = [tex];
    sprite.scale.setScalar(1.35);
    sprite.position.y = 0.75;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 6, 40), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 8), new THREE.MeshBasicMaterial({
      map: fxTex('shaft'), color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    beam.position.y = 3.6;
    g.add(beam, sprite, ring, glowSprite(col, 3, 0.5));
    g.userData.beam = beam;
  }
  return g;
}

function syncPickups(dt, time) {
  const live = new Set(Ch.pickups);
  for (const k of Ch.pickups) {
    let o = SC.picks.get(k);
    if (!o) {
      o = pickupObj(k);
      SC.scene.add(o);
      SC.picks.set(k, o);
    }
    const bob = Math.sin(time * 3 + k.x) * 0.12;
    o.position.set(k.x, (k.kind === 'reward' ? 0.5 : 0.45) + bob, k.z);
    if (k.kind === 'reward') {
      o.userData.beam.position.y = 3.6 - bob;
      o.userData.beam.lookAt(SC.camera.position.x, o.position.y + 3.6, SC.camera.position.z);
      if (Math.random() < dt * 14) emit(k.x + (Math.random() - 0.5), 0.3, k.z + (Math.random() - 0.5), 1, rewardLook(k.reward).color, 0.4, { rise: 1.8, grav: 0, life: 1, size: 0.14 });
    } else {
      o.rotation.y += dt * 2.5;
    }
  }
  for (const [k, o] of SC.picks) {
    if (!live.has(k)) {
      SC.scene.remove(o);
      disposeObj(o);
      SC.picks.delete(k);
    }
  }
}

const TELE_RED = typeof THREE !== 'undefined' ? new THREE.Color(1.8, 0.22, 0.12) : null;

function teleMat(opacity, color) {
  return new THREE.MeshBasicMaterial({
    map: fxTex('tele'), color: color || TELE_RED,
    transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function teleGeometry(shape, arc) {
  if (shape === 'circle') {
    const g = new THREE.CircleGeometry(1, 40);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  if (shape === 'cone') {
    const g = new THREE.CircleGeometry(1, 28, -arc / 2, arc);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0.5, 0, 0);
  return g;
}

function makeTele(shape, arc, color) {
  const geo = teleGeometry(shape, arc);
  const base = new THREE.Mesh(geo, teleMat(shape === 'line' ? 0.25 : 0.55, color));
  const fill = new THREE.Mesh(geo, teleMat(0.5, color));
  if (shape === 'line') base.material.map = fill.material.map = null;
  const g = new THREE.Group();
  g.add(base, fill);
  g.userData = { base, fill, shape, arc };
  SC.scene.add(g);
  return g;
}

function placeTele(g, t, time) {
  const { fill, base, shape } = g.userData;
  const p = clamp(t.p, 0, 1);
  g.position.set(t.x, 0.05, t.z);
  base.material.opacity = (shape === 'line' ? 0.2 : 0.5) + 0.15 * Math.sin(time * 18);
  if (shape === 'circle' || shape === 'cone') {
    base.scale.set(t.r, 1, t.r);
    fill.scale.set(t.r * p, 1, t.r * p);
    g.rotation.y = shape === 'cone' ? -t.ang : 0;
  } else {
    base.scale.set(t.len, 1, t.w);
    fill.scale.set(t.len * p, 1, t.w);
    g.rotation.y = -t.ang;
  }
}

function syncTeles(time) {
  const seen = new Set();
  for (const e of Ch.enemies) {
    if (!e.tele) continue;
    seen.add(e);
    let g = SC.teles.get(e);
    if (!g || g.userData.shape !== e.tele.shape || g.userData.arc !== e.tele.arc) {
      if (g) {
        SC.scene.remove(g);
        disposeObj(g);
      }
      g = makeTele(e.tele.shape, e.tele.arc);
      SC.teles.set(e, g);
    }
    placeTele(g, e.tele, time);
  }
  for (const [e, g] of SC.teles) {
    if (!seen.has(e)) {
      SC.scene.remove(g);
      disposeObj(g);
      SC.teles.delete(e);
    }
  }
}

function syncHazards(dt, time) {
  const live = new Set(Ch.hazards);
  for (const h of Ch.hazards) {
    let o = SC.hazards.get(h);
    if (!o) {
      if (h.kind === 'aoe') {
        const teleCol = h.owner === 'player' ? new THREE.Color(2.2, 1.3, 0.35) : h.look === 'fire' ? new THREE.Color(2, 0.6, 0.15) : TELE_RED;
        o = makeTele('circle', 0, teleCol);
        let fall = null;
        if (h.look === 'rock') fall = new THREE.Mesh(displace(GEO.ico(0.6, 1), 0.35, 5), Models.props.base);
        else if (h.look === 'fire') fall = glowSprite(0xff8a2a, 1.8, 1);
        else if (h.look === 'meteor') {
          fall = new THREE.Group();
          fall.add(new THREE.Mesh(displace(GEO.ico(0.55, 1), 0.3, 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.3) })), glowSprite(0xff8a2a, 3.2, 1));
        } else if (h.look === 'ice') {
          fall = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.9, 2.3) }));
          fall.rotation.x = Math.PI;
        }
        if (fall) {
          o.add(fall);
          o.userData.fall = fall;
        }
      } else if (h.kind === 'ring') {
        const c = new THREE.Color(lookColor(h.look, 0xff6a20)).multiplyScalar(2.2);
        o = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
          color: c, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        SC.scene.add(o);
      } else if (h.kind === 'beam') {
        o = makeBeam(h);
        SC.scene.add(o);
      } else {
        const col = h.look === 'ember' ? new THREE.Color(2, 0.6, 0.15) : h.look === 'void' ? new THREE.Color(1.3, 0.4, 2.4) : new THREE.Color(2, 0.35, 0.08);
        o = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 32).rotateX(-Math.PI / 2), teleMat(h.owner === 'player' ? 0.45 : 0.6, col));
        o.add(disc, glowSprite(col, h.r * 2.8, 0.5));
        SC.scene.add(o);
      }
      SC.hazards.set(h, o);
    }
    if (h.kind === 'aoe') {
      placeTele(o, { x: h.x, z: h.z, r: h.r, p: h.t / Math.max(h.delay, 0.01) }, time);
      if (o.userData.fall) {
        const a = clamp(h.t / h.delay, 0, 1);
        o.userData.fall.position.y = (1 - a) * 12;
        o.userData.fall.visible = !h.fired;
        if ((h.look === 'fire' || h.look === 'meteor') && Math.random() < (h.look === 'meteor' ? 1 : 0.5)) emit(h.x, (1 - a) * 12 + 0.5, h.z, h.look === 'meteor' ? 3 : 1, 0xff7a2a, 0.5, { life: 0.4, grav: 2, size: 0.3 });
      }
      if (h.look === 'void' && !h.fired && Math.random() < 0.6) emit(h.x + (Math.random() - 0.5) * h.r * 1.4, 0.1, h.z + (Math.random() - 0.5) * h.r * 1.4, 1, 0x9a50ff, 0.3, { rise: 2, grav: 0, life: 0.6, size: 0.14 });
    } else if (h.kind === 'beam') {
      syncBeam(o, h, time);
    } else if (h.kind === 'ring') {
      o.position.set(h.x, 0.1, h.z);
      o.visible = h.t > 0;
      const r = Math.max(0.05, h.speed * h.t);
      o.scale.set(r, 1, r);
      if (Math.random() < 0.6 && h.t > 0) {
        const a = Math.random() * Math.PI * 2;
        emit(h.x + Math.cos(a) * r, 0.2, h.z + Math.sin(a) * r, 1, lookColor(h.look), 1, { up: 1.5, life: 0.4, size: 0.14 });
      }
    } else {
      o.position.set(h.x, 0.04, h.z);
      const a = h.t / h.life;
      o.children[0].material.opacity = (h.owner === 'player' ? 0.45 : 0.6) * (a > 0.8 ? (1 - a) * 5 : 1) * (0.85 + 0.15 * Math.sin(time * 12));
      if (Math.random() < dt * 10) emit(h.x + (Math.random() - 0.5) * h.r, 0.2, h.z + (Math.random() - 0.5) * h.r, 1, h.look === 'void' ? 0xa060ff : 0xff7a2a, 0.4, { rise: 1.6, grav: 0, life: 0.6, size: 0.18 });
    }
  }
  for (const [h, o] of SC.hazards) {
    if (!live.has(h)) {
      SC.scene.remove(o);
      disposeObj(o);
      SC.hazards.delete(h);
    }
  }
}

// A beam: a red line while it charges, then a core of white light in a coloured glow.
function makeBeam(h) {
  const g = new THREE.Group();
  const tele = makeTele('line', 0);
  SC.scene.remove(tele);
  g.add(tele);
  const col = new THREE.Color(lookColor(h.look)).multiplyScalar(2.2);
  const plane = (w, color, opacity) => {
    const geo = new THREE.PlaneGeometry(1, w);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0.5, 0, 0);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  };
  const beam = new THREE.Group();
  beam.add(plane(h.w * 2.4, col, 0.45), plane(h.w * 0.9, col.clone().multiplyScalar(1.4), 0.8), plane(h.w * 0.32, new THREE.Color(3, 3, 3), 1));
  beam.position.y = 0.9;
  g.add(beam);
  g.userData = { tele, beam };
  return g;
}

function syncBeam(o, h, time) {
  const { tele, beam } = o.userData;
  o.position.set(h.x, 0, h.z);
  const active = h.t >= h.delay;
  tele.visible = !active;
  beam.visible = active;
  if (!active) {
    placeTele(tele, { x: 0, z: 0, ang: h.ang, len: h.len, w: h.w, p: h.t / h.delay }, time);
    tele.position.y = 0.05;
    return;
  }
  const a = h.t - h.delay, fade = Math.min(1, a / 0.08) * Math.min(1, (h.dur - a) / 0.15 + 0.001);
  beam.rotation.y = -h.ang;
  beam.scale.set(h.len, 1, 0.8 + 0.25 * Math.sin(time * 40));
  beam.children.forEach((c, i) => (c.material.opacity = [0.45, 0.8, 1][i] * Math.max(0, fade)));
  if (Math.random() < 0.7) {
    const d = Math.random() * h.len;
    emit(h.x + Math.cos(h.ang) * d, 0.9, h.z + Math.sin(h.ang) * d, 1, lookColor(h.look), 2, { life: 0.35, up: 1, size: 0.14 });
  }
}

// ---- Hero portraits for the Sanctuary: the real 3D model, rendered once into an image ---------------

function heroPortrait(id) {
  if (!SC.ok) return null;
  SC.portraits = SC.portraits || {};
  if (SC.portraits[id]) return SC.portraits[id];
  const r = SC.renderer, size = 320;
  const m = buildHero('sword', id), rig = m.rig;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff0e0, 0x302030, 0.6));
  const key = new THREE.DirectionalLight(0xffe2c8, 1.25);
  key.position.set(2, 3, 4);
  const back = new THREE.DirectionalLight(HEROES[id].color, 0.9);
  back.position.set(-3, 2, -3);
  scene.add(key, back, m.root);
  m.root.rotation.y = 0.5;
  rig.weapon.rotation.set(0.25, -0.5, 0);
  rig.arms[1].rotation.set(-0.4, 0, -0.1);
  rig.elbows[1].rotation.x = -0.5;
  rig.arms[0].rotation.set(0.1, 0, 0.12);
  waveCloth({ mesh: rig.cape, kind: 'cape', ph: 0 }, 0.3, 0, 0.16);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(0, 1.5, 4.1);
  cam.lookAt(0, 1.1, 0);
  const rt = new THREE.WebGLRenderTarget(size, size);
  const prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
  r.setClearColor(0x000000, 0);
  r.setRenderTarget(rt);
  r.clear();
  r.render(scene, cam);
  const px = new Uint8Array(size * size * 4);
  r.readRenderTargetPixels(rt, 0, 0, size, size, px);
  r.setRenderTarget(null);
  r.setClearColor(prevColor, prevAlpha);
  rt.dispose();
  disposeObj(m.root);
  const c = makeCanvas(size), g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) img.data.set(px.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  g.putImageData(img, 0, 0);
  return (SC.portraits[id] = c.toDataURL());
}

// ---- 2D overlay ----------------------------------------------------------------------------------------

const projV = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
function toScreen(x, y, z) {
  projV.set(x, y, z).project(SC.camera);
  if (projV.z > 1) return null;
  return { x: ((projV.x + 1) / 2) * SC.overlay.width, y: ((1 - projV.y) / 2) * SC.overlay.height };
}

function drawOverlay(dt) {
  const g = SC.octx, W = SC.overlay.width, H = SC.overlay.height, d = SC.odpr || 1;
  g.clearRect(0, 0, W, H);
  g.lineCap = 'round';
  for (const b of Ch.bolts) {
    const a = toScreen(b.x0, 1, b.z0), c = toScreen(b.x1, 1, b.z1);
    if (!a || !c) continue;
    g.globalAlpha = 1 - b.t / 0.3;
    for (const [width, color, blur] of [[7 * d, 'rgba(124,196,255,0.35)', 18 * d], [2.5 * d, '#eaf4ff', 6 * d]]) {
      g.strokeStyle = color;
      g.shadowColor = '#7cc4ff';
      g.shadowBlur = blur;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(a.x, a.y);
      const seed = b.x0 * 13 + b.z1 * 7;
      for (let i = 1; i < 7; i++) {
        const t = i / 7, j = Math.sin(seed + i * 12.9898 + b.t * 40) * 16 * d;
        g.lineTo(a.x + (c.x - a.x) * t + j, a.y + (c.y - a.y) * t - j * 0.6);
      }
      g.lineTo(c.x, c.y);
      g.stroke();
    }
  }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  for (const e of Ch.enemies) {
    if (!e.alive || e.def.boss || e.spawnT > 0 || (e.hp >= e.maxHp && !e.elite)) continue;
    const s = toScreen(e.x, (e.def.flying ? 2 : 1.85) * (e.elite ? 1.15 : 1), e.z);
    if (!s) continue;
    const w = 40 * d, h = 5 * d;
    g.fillStyle = 'rgba(10,6,10,0.85)';
    g.fillRect(s.x - w / 2 - d, s.y - d, w + 2 * d, h + 2 * d);
    const grad = g.createLinearGradient(s.x - w / 2, 0, s.x + w / 2, 0);
    grad.addColorStop(0, e.elite ? '#7a3ac0' : '#9a1a22');
    grad.addColorStop(1, e.elite ? '#d8a0ff' : '#ff5a5e');
    g.fillStyle = grad;
    g.fillRect(s.x - w / 2, s.y, w * (e.hp / e.maxHp), h);
    let ix = s.x - w / 2;
    for (const [on, col] of [[e.burn > 0, '#ff7a2a'], [e.chill > 0 || e.frozen > 0, '#a8f0ff'], [e.mark > 0, '#b98cff']]) {
      if (!on) continue;
      g.fillStyle = col;
      g.beginPath();
      g.arc(ix + 3 * d, s.y + h + 6 * d, 3 * d, 0, Math.PI * 2);
      g.fill();
      ix += 9 * d;
    }
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const f of SC.floats) {
    f.t += dt;
    const s = toScreen(f.x, f.y + f.t * 1.4, f.z);
    if (!s) continue;
    const size = 22 * d * f.size * (f.t < 0.08 ? 1 + (0.08 - f.t) * 6 : 1);
    g.font = `800 ${Math.round(size)}px 'Alegreya Sans', 'Trebuchet MS', sans-serif`;
    g.globalAlpha = f.t < 0.6 ? 1 : Math.max(0, 1 - (f.t - 0.6) / 0.3);
    g.lineWidth = 4 * d;
    g.strokeStyle = 'rgba(12,6,10,0.9)';
    g.strokeText(f.text, s.x, s.y);
    g.fillStyle = f.color;
    g.fillText(f.text, s.x, s.y);
  }
  g.globalAlpha = 1;
  SC.floats = SC.floats.filter((f) => f.t < 0.9);
  const P = Ch.player;
  if (P.charging && P.charge > 0.08) {
    const s = toScreen(P.x, 0.1, P.z);
    if (s) {
      const full = P.charge >= WEAPONS.bow.charged.time;
      g.strokeStyle = full ? '#fff0c0' : 'rgba(255,199,119,0.7)';
      g.lineWidth = 4 * d;
      g.beginPath();
      g.arc(s.x, s.y, 34 * d, -Math.PI / 2, -Math.PI / 2 + Math.min(1, P.charge / WEAPONS.bow.charged.time) * Math.PI * 2);
      g.stroke();
    }
  }
  if (SC.flash > 0) {
    if (SC.quality !== 'high' || !Post.ok) {
      g.fillStyle = `rgba(255,240,220,${SC.flash * 0.7})`;
      g.fillRect(0, 0, W, H);
    }
    SC.flash = Math.max(0, SC.flash - dt * 1.5);
  }
}
