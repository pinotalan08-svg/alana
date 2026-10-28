'use strict';

// Three.js view of the chamber. Reads the simulation (Ch, Run) and listens to its events;
// never changes game state. A transparent 2D canvas on top draws numbers, bolts and bars.

const SC = {
  ok: false, quality: 'high', canvas: null, overlay: null, octx: null, dpr: 1, w: 0, h: 0,
  renderer: null, scene: null, camera: null, hemi: null, sun: null, heroLight: null, pool: [],
  room: null, roomMats: [], lava: [], flames: [], doors: [], urns: new Map(), fountain: null,
  hero: null, heroWeapon: '', walk: 0,
  enemies: new Map(), projs: new Map(), picks: new Map(), hazards: new Map(), teles: new Map(),
  fx: [], floats: [], parts: null, shake: 0, flash: 0, time: 0,
  cam: { x: 0, z: 0, ready: false }, tex: {},
};

const CAM_OFF = { y: 15.5, z: 10 };
const WHITE = 0xffffff;

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

  const scene = (SC.scene = new THREE.Scene());
  SC.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 140);
  SC.hemi = new THREE.HemisphereLight(0x6b5a8c, 0x2a1410, 0.75);
  SC.sun = new THREE.DirectionalLight(0xffd2a8, 0.85);
  const s = SC.sun.shadow;
  s.mapSize.set(1024, 1024);
  s.camera.left = s.camera.bottom = -15;
  s.camera.right = s.camera.top = 15;
  s.camera.near = 1;
  s.camera.far = 60;
  s.bias = -0.0015;
  SC.sun.castShadow = true;
  SC.heroLight = new THREE.PointLight(0xff9a50, 1.1, 9, 2);
  scene.add(SC.hemi, SC.sun, SC.sun.target, SC.heroLight);
  // a fixed pool of point lights (braziers, lava), so shaders never recompile
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xff8a3a, 0, 8, 2);
    SC.pool.push(l);
    scene.add(l);
  }
  SC.parts = makeParticles();
  scene.add(SC.parts.small.points, SC.parts.big.points);

  listenScene();
  window.addEventListener('resize', resizeScene);
  resizeScene();
  SC.ok = true;
  return true;
}

function setQuality(q) {
  SC.quality = q;
  SC.sun.castShadow = q === 'high';
  SC.renderer.shadowMap.enabled = q === 'high';
  SC.scene.traverse((o) => {
    if (o.material && o.material.isMaterial) o.material.needsUpdate = true;
  });
  SC.w = 0;
  resizeScene();
}

function resizeScene() {
  const c = SC.canvas, w = c.clientWidth, h = c.clientHeight;
  const dpr = SC.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  if (!w || !h || (w === SC.w && h === SC.h && dpr === SC.dpr)) return;
  SC.w = w;
  SC.h = h;
  SC.dpr = dpr;
  SC.renderer.setPixelRatio(dpr);
  SC.renderer.setSize(w, h, false);
  SC.overlay.width = Math.round(w * dpr);
  SC.overlay.height = Math.round(h * dpr);
  // keep about 11 units visible across a phone held upright, 12 deep when held sideways
  const dist = Math.hypot(CAM_OFF.y, CAM_OFF.z), aspect = w / h;
  const vfov = Math.max(2 * Math.atan(5.6 / (dist * aspect)), 2 * Math.atan(6.4 / dist));
  SC.camera.fov = clamp((vfov * 180) / Math.PI, 30, 70);
  SC.camera.aspect = aspect;
  SC.camera.updateProjectionMatrix();
}

// ---- Textures and shared materials ---------------------------------------------------------------

function canvasTex(canvas, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function cachedCanvas(key, make) {
  return SC.tex[key] || (SC.tex[key] = make());
}

function trackMat(m) {
  SC.roomMats.push(m);
  return m;
}

// ---- Chamber construction ----------------------------------------------------------------------------

function disposeRoom() {
  if (!SC.room) return;
  SC.scene.remove(SC.room);
  SC.room.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  for (const m of SC.roomMats) {
    if (m.map) m.map.dispose();
    if (m.emissiveMap) m.emissiveMap.dispose();
    m.dispose();
  }
  SC.roomMats = [];
  SC.room = null;
  SC.lava = [];
  SC.flames = [];
  SC.doors = [];
  SC.urns.clear();
  SC.fountain = null;
  for (const v of SC.enemies.values()) SC.scene.remove(v.m.root);
  SC.enemies.clear();
  for (const map of [SC.projs, SC.picks, SC.hazards, SC.teles]) {
    for (const o of map.values()) SC.scene.remove(o.obj || o);
    map.clear();
  }
  for (const f of SC.fx) SC.scene.remove(f.obj);
  SC.fx = [];
  SC.floats = [];
}

function buildRoomScene() {
  disposeRoom();
  const room = Ch.room, B = BIOMES[Ch.biome], g = new THREE.Group();
  SC.room = g;
  SC.scene.background = new THREE.Color(B.fog);
  SC.scene.fog = new THREE.Fog(B.fog, 24, 52);
  SC.hemi.color.set(B.sky);
  SC.hemi.groundColor.set(B.ground);
  SC.sun.color.set(B.light);

  // floating floor slab
  const floorC = cachedCanvas('floor-' + B.floor, () => floorCanvases(B.floor));
  const floorMat = trackMat(new THREE.MeshStandardMaterial({
    map: canvasTex(floorC.map, room.W / 4, room.D / 4), roughness: 0.92, metalness: 0.04,
  }));
  if (floorC.emissive) {
    floorMat.emissiveMap = canvasTex(floorC.emissive, room.W / 4, room.D / 4);
    floorMat.emissive = new THREE.Color(0xff6a1a);
    floorMat.emissiveIntensity = 1.1;
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.W, room.D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);
  const rockMat = trackMat(new THREE.MeshStandardMaterial({
    map: canvasTex(cachedCanvas('rock', rockCanvas), 4, 2), roughness: 1, color: 0x9a8a90,
  }));
  const slab = new THREE.Mesh(new THREE.BoxGeometry(room.W + 0.8, 9, room.D + 0.8), rockMat);
  slab.position.y = -4.52;
  g.add(slab);
  const abyss = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(cachedCanvas('abyss-' + Ch.biome, () => abyssCanvas(B.abyss))), fog: false })),
  );
  abyss.rotation.x = -Math.PI / 2;
  abyss.position.set(0, -34, -10);
  g.add(abyss);

  const wallC = cachedCanvas('wall-' + B.floor, () => wallCanvas(B.floor));
  const stone = trackMat(new THREE.MeshStandardMaterial({ map: canvasTex(wallC, 1, 1), roughness: 0.95 }));
  const wallMat = (w, h) => trackMat(new THREE.MeshStandardMaterial({ map: canvasTex(wallC, w / 4, h / 4), roughness: 0.95 }));

  // far wall, with a gap for each door
  const H = 5.2, z0 = -room.D / 2 - 0.6;
  const gaps = room.doors.map((d) => [d.x - 1.45, d.x + 1.45]);
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
  for (const d of room.doors) {
    const door = buildDoor(stone);
    door.position.set(d.x, 0, -room.D / 2 - 0.15);
    g.add(door);
    const look = rewardLook(d.reward);
    const emblem = new THREE.Sprite(trackMat(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(emblemCanvas(look.glyph, look.color, 256)), transparent: true })));
    emblem.scale.setScalar(1.5);
    emblem.position.set(d.x, 4.75, -room.D / 2 + 0.2);
    const halo = glowSprite(new THREE.Color(look.color), 3, 0.25);
    halo.position.copy(emblem.position);
    g.add(halo, emblem);
    const leaf = door.userData.leaf;
    leaf.material = trackMat(new THREE.MeshBasicMaterial({ color: 0x120a10 }));
    SC.doors.push({ door: d, leaf, halo, emblem, color: new THREE.Color(look.color) });
  }
  // low parapets on the sides and the near edge
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, room.D + 1.6), wallMat(0.8, room.D));
    p.position.set(s * (room.W / 2 + 0.4), 0.55, -0.4);
    p.receiveShadow = true;
    g.add(p);
    const near = new THREE.Mesh(new THREE.BoxGeometry(room.W / 2 - 1.4, 0.7, 0.8), wallMat(room.W / 2, 1));
    near.position.set(s * (room.W / 4 + 0.7), 0.35, room.D / 2 + 0.4);
    g.add(near);
  }

  // props
  const rockToon = trackMat(toon(Ch.biome === 2 ? 0x3a2a26 : Ch.biome === 1 ? 0x3c4c46 : 0x5a5060));
  let light = 0;
  SC.pool.forEach((l) => (l.intensity = 0));
  for (const o of room.obstacles) {
    let m;
    switch (o.kind) {
      case 'pillar': m = buildPillar(stone, o.h || 3); break;
      case 'statue': m = buildStatue(stone); break;
      case 'rock': m = buildRock(rockToon, o.r * 1.35); break;
      case 'crystal': m = buildCrystal(B.accent); break;
      case 'urn': m = buildUrn(); SC.urns.set(o, m); break;
      case 'brazier': {
        m = buildBrazier(B.accent);
        SC.flames.push(...m.userData.flames);
        if (light < SC.pool.length) {
          const l = SC.pool[light++];
          l.color.set(B.accent);
          l.position.set(o.x, 1.8, o.z);
          l.userData.base = 1.3;
        }
        break;
      }
      case 'fountain': m = buildFountain(); SC.fountain = m; break;
      case 'merchant': m = buildMerchant(); break;
      default: m = buildPillar(stone, 2);
    }
    m.position.set(o.x, 0, o.z);
    g.add(m);
  }
  for (const l of room.lava) {
    const lavaMat = trackMat(new THREE.MeshBasicMaterial({ map: canvasTex(cachedCanvas('lava', lavaCanvas), l.r / 1.5, l.r / 1.5) }));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(l.r, 32), lavaMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(l.x, 0.02, l.z);
    const rim = new THREE.Mesh(new THREE.RingGeometry(l.r, l.r + 0.25, 32), trackMat(new THREE.MeshBasicMaterial({ color: 0x1a0805 })));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(l.x, 0.025, l.z);
    const glow = glowSprite(0xff6a1a, l.r * 3, 0.35);
    glow.position.set(l.x, 0.6, l.z);
    g.add(pool, rim, glow);
    SC.lava.push(lavaMat);
  }
  SC.scene.add(g);
  SC.cam.ready = false;
  if (SC.heroWeapon !== Run.weapon) buildHeroModel();
}

function buildHeroModel() {
  if (SC.hero) SC.scene.remove(SC.hero.root);
  SC.hero = buildHero(Run.weapon);
  SC.heroWeapon = Run.weapon;
  for (const m of SC.hero.mats) m.userData.e0 = m.emissive.clone();
  SC.scene.add(SC.hero.root);
}

// ---- Particles (two additive point clouds) -------------------------------------------------------------

function makeCloud(n, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -999;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size, map: Models.glowTex, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points, pos, col, n, next: 0,
    vel: new Float32Array(n * 3), base: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), grav: new Float32Array(n),
  };
}

function makeParticles() {
  return { small: makeCloud(700, 0.32), big: makeCloud(260, 1.1) };
}

function emit(x, y, z, count, color, speed = 3, o = {}) {
  if (!SC.ok) return;
  const cloud = o.big ? SC.parts.big : SC.parts.small;
  const c = new THREE.Color(color);
  const reduced = Prefs.reduced ? 0.4 : 1;
  for (let k = 0; k < Math.ceil(count * reduced); k++) {
    const i = cloud.next;
    cloud.next = (cloud.next + 1) % cloud.n;
    const a = Math.random() * Math.PI * 2, up = o.up ?? 0.6, s = speed * (0.3 + Math.random() * 0.9);
    cloud.pos[i * 3] = x + (Math.random() - 0.5) * (o.spread || 0);
    cloud.pos[i * 3 + 1] = y;
    cloud.pos[i * 3 + 2] = z + (Math.random() - 0.5) * (o.spread || 0);
    cloud.vel[i * 3] = Math.cos(a) * s * (o.flat ?? 1);
    cloud.vel[i * 3 + 1] = up * s + (o.rise || 0);
    cloud.vel[i * 3 + 2] = Math.sin(a) * s * (o.flat ?? 1);
    cloud.base[i * 3] = c.r;
    cloud.base[i * 3 + 1] = c.g;
    cloud.base[i * 3 + 2] = c.b;
    cloud.max[i] = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
    cloud.life[i] = cloud.max[i];
    cloud.grav[i] = o.grav ?? -6;
  }
}

function updateCloud(cloud, dt) {
  const { pos, col, vel, base, life, max, grav } = cloud;
  for (let i = 0; i < cloud.n; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    if (life[i] <= 0) {
      pos[i * 3 + 1] = -999;
      continue;
    }
    vel[i * 3 + 1] += grav[i] * dt;
    vel[i * 3] *= 0.97;
    vel[i * 3 + 2] *= 0.97;
    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + vel[i * 3 + 1] * dt);
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    const f = life[i] / max[i];
    col[i * 3] = base[i * 3] * f;
    col[i * 3 + 1] = base[i * 3 + 1] * f;
    col[i * 3 + 2] = base[i * 3 + 2] * f;
  }
  cloud.points.geometry.attributes.position.needsUpdate = true;
  cloud.points.geometry.attributes.color.needsUpdate = true;
}

// ---- One-shot effects --------------------------------------------------------------------------------

function addFx(obj, life, update) {
  SC.scene.add(obj);
  SC.fx.push({ obj, t: 0, life, update });
}

function ringFx(x, z, r, color, life = 0.45, y = 0.08) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  addFx(m, life, (f, a) => {
    m.scale.setScalar(Math.max(0.01, r * (0.3 + 0.7 * Math.sqrt(a))));
    mat.opacity = 1 - a;
  });
}

function slashFx(P, range, arc, color, thrust) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const geo = new THREE.RingGeometry(thrust ? 0.3 : 0.7, range, 24, 1, -arc / 2, arc);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(P.x, 1.0, P.z);
  m.rotation.y = -Math.atan2(P.face.z, P.face.x);
  addFx(m, 0.16, (f, a) => {
    mat.opacity = 0.85 * (1 - a);
    m.scale.setScalar(0.85 + a * 0.25);
  });
}

function beamFx(x, z, color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 14, 6, 1, true), mat);
  m.position.set(x, 7, z);
  addFx(m, 0.28, (f, a) => {
    mat.opacity = 1 - a;
    m.scale.x = m.scale.z = 1 + a * 2;
  });
  const g = glowSprite(color, 4, 1);
  g.position.set(x, 0.6, z);
  addFx(g, 0.3, (f, a) => (g.material.opacity = 1 - a));
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
    for (const mat of m.mats) {
      if (e.elite) mat.emissive.set(0x3a1050);
      mat.userData.e0 = mat.emissive.clone();
    }
    if (e.elite) {
      const aura = glowSprite(0xb98cff, e.r * 4, 0.5);
      aura.position.y = 0.2;
      m.root.add(aura);
    }
    const scale = m.root.scale.x * (e.elite ? 1.15 : 1);
    m.root.scale.setScalar(0.01);
    SC.scene.add(m.root);
    SC.enemies.set(e, { m, dying: 0, walk: Math.random() * 6, scale });
    if (e.spawnT > 0.2) ringFx(e.x, e.z, e.r * 2.4, e.def.boss ? 0xff3a2a : 0xb070ff, e.spawnT);
    emit(e.x, 0.3, e.z, 14, e.def.boss ? 0xff5a2a : 0x9a60ff, 2, { up: 1.2, life: 0.8 });
  });
  Bus.on('hit', (e, dmg, crit, src) => {
    const col = crit ? '#ffd23a' : src === 'burn' ? '#ff8a3a' : src === 'storm' ? '#9fd4ff' : src === 'splash' || src === 'wall' ? '#5fe8d0'
      : src === 'shatter' ? '#c8f6ff' : '#ffffff';
    const h = (e.def.boss ? 3.2 : 1.7) * (SC.enemies.get(e)?.scale || 1);
    floatText(e.x, h, e.z, crit ? `${dmg}!` : dmg, col, crit ? 1.45 : src === 'burn' ? 0.75 : 1);
    if (src !== 'burn') emit(e.x, 1, e.z, crit ? 16 : 8, src === 'attack' || src === 'special' || src === 'cast' ? elementColor(src) : col, 4, { life: 0.35 });
    if (crit) SC.shake = Math.max(SC.shake, 0.25);
  });
  Bus.on('kill', (e) => {
    const v = SC.enemies.get(e);
    if (v) v.dying = 0.001;
    emit(e.x, 1, e.z, e.def.boss ? 120 : 26, e.def.color, e.def.boss ? 7 : 4.5, { up: 1, life: 0.7 });
    emit(e.x, 1, e.z, 6, 0xc9a8ff, 1, { big: true, rise: 2, grav: 0, life: 1.1 });
  });
  Bus.on('hurt', () => {
    SC.shake = Math.max(SC.shake, 0.45);
    const P = Ch.player;
    emit(P.x, 1, P.z, 18, 0xff3040, 4, { life: 0.4 });
  });
  Bus.on('dash', (P) => {
    emit(P.x, 0.6, P.z, 14, 0xff6a5a, 1.5, { life: 0.35, up: 0.3 });
    ringFx(P.x, P.z, 1.2, 0xffb0a0, 0.25);
  });
  Bus.on('swing', (P) => {
    const thrust = P.strikeKind === 2 || P.strikeKind === 'dash';
    slashFx(P, P.atk.range + 0.2, thrust ? 0.7 : P.atk.arc, new THREE.Color(elementColor('attack')), thrust);
  });
  Bus.on('spin', (P, r) => {
    ringFx(P.x, P.z, r, new THREE.Color(elementColor('special')), 0.35, 0.9);
    emit(P.x, 0.9, P.z, 30, elementColor('special'), 7, { up: 0.1, life: 0.4, flat: 1 });
  });
  Bus.on('strike', (x, z) => {
    beamFx(x, z, 0x9fd4ff);
    emit(x, 0.5, z, 20, 0x9fd4ff, 5, { life: 0.4 });
    SC.shake = Math.max(SC.shake, 0.15);
  });
  Bus.on('nova', (x, z, r) => {
    ringFx(x, z, r, 0xa8f0ff, 0.45);
    emit(x, 0.6, z, 26, 0xc8f6ff, 5, { life: 0.5, up: 0.4 });
  });
  Bus.on('wave', (x, z, r) => {
    ringFx(x, z, r, 0x38d6b8, 0.45);
    emit(x, 0.4, z, 24, 0x5fe8d0, 5, { life: 0.5, up: 1.2 });
  });
  Bus.on('splash', (e) => emit(e.x, 0.6, e.z, 10, 0x5fe8d0, 4, { life: 0.4, up: 1 }));
  Bus.on('burst', (e) => {
    emit(e.x, 0.8, e.z, 30, 0xff7a2a, 6, { life: 0.5, up: 1 });
    emit(e.x, 0.8, e.z, 4, 0xffb060, 1, { big: true, life: 0.4 });
  });
  Bus.on('freeze', (e) => emit(e.x, 1, e.z, 16, 0xc8f6ff, 3, { life: 0.6 }));
  Bus.on('slam', (x, z, r) => {
    ringFx(x, z, r, 0xffb080, 0.4);
    emit(x, 0.3, z, 26, 0xa08070, 5, { life: 0.5, up: 0.8 });
    SC.shake = Math.max(SC.shake, 0.35);
  });
  Bus.on('blast', (h) => {
    const col = h.look === 'rock' ? 0xa08070 : 0xff7a2a;
    emit(h.x, 0.4, h.z, 30, col, 6, { life: 0.5, up: 1.2 });
    if (h.look !== 'rock') emit(h.x, 0.6, h.z, 5, 0xffa040, 1.5, { big: true, life: 0.5 });
    SC.shake = Math.max(SC.shake, 0.25);
  });
  Bus.on('roar', () => (SC.shake = Math.max(SC.shake, 0.8)));
  Bus.on('bossDown', (e) => {
    SC.flash = 1;
    SC.shake = 1.2;
    for (let i = 0; i < 4; i++) emit(e.x, 1 + i, e.z, 30, i % 2 ? 0xffd23a : e.def.color, 8, { life: 1.2, up: 1 });
  });
  Bus.on('urn', (o) => emit(o.x, 0.5, o.z, 18, 0xb0603a, 4, { life: 0.5, up: 1 }));
  Bus.on('collect', (k) => {
    const col = k.kind === 'gold' ? 0xffd23a : k.kind === 'heal' ? 0xff5d6c : k.kind === 'crystal' ? 0xff4a6a : 0xffe8b0;
    emit(k.x, 0.8, k.z, k.kind === 'reward' ? 40 : 10, col, 3, { life: 0.6, up: 1.5 });
  });
  Bus.on('fountain', () => {
    const f = Ch.room.fountain;
    emit(f.x, 1, f.z, 50, 0x7cd8ff, 3, { life: 1, up: 2 });
  });
  Bus.on('defiance', () => {
    const P = Ch.player;
    SC.flash = 0.8;
    ringFx(P.x, P.z, 4, 0xffd98a, 0.8);
  });
  Bus.on('death', () => {
    const P = Ch.player;
    emit(P.x, 1, P.z, 60, 0xff3040, 5, { life: 1, up: 1 });
  });
  Bus.on('projectileEnd', (p) => {
    if (p.owner === 'player' && p.kind !== 'crystal') emit(p.x, 1, p.z, 5, 0xffe0a0, 2, { life: 0.25 });
    else if (p.owner === 'enemy') emit(p.x, 1, p.z, 6, p.kind === 'orb' ? 0x7fffe0 : p.kind === 'ember' ? 0xff7a2a : 0xd0c0b0, 2, { life: 0.3 });
  });
}

// ---- Per-frame -----------------------------------------------------------------------------------------

function renderScene(dt, time) {
  if (!SC.ok) return;
  resizeScene();
  SC.time = time;
  if (!Ch || !SC.room) {
    SC.renderer.render(SC.scene, SC.camera);
    return;
  }
  syncHero(dt, time);
  syncEnemies(dt, time);
  syncProjectiles(dt, time);
  syncPickups(dt, time);
  syncHazards(dt, time);
  syncTeles();
  for (const f of SC.fx) {
    f.t += dt;
    f.update(f, Math.min(1, f.t / f.life));
  }
  SC.fx = SC.fx.filter((f) => {
    if (f.t < f.life) return true;
    SC.scene.remove(f.obj);
    if (f.obj.geometry) f.obj.geometry.dispose();
    if (f.obj.material) f.obj.material.dispose();
    return false;
  });
  updateCloud(SC.parts.small, dt);
  updateCloud(SC.parts.big, dt);
  ambientFx(dt, time);
  updateCamera(dt);
  SC.renderer.render(SC.scene, SC.camera);
  drawOverlay(dt);
}

function ambientFx(dt, time) {
  for (const l of SC.pool) {
    if (l.userData.base) l.intensity = l.userData.base * (0.85 + 0.15 * Math.sin(time * 9 + l.position.x) + 0.08 * Math.sin(time * 23));
  }
  for (const [i, f] of SC.flames.entries()) {
    const s = 0.75 + 0.18 * Math.sin(time * 11 + i * 1.7) + 0.08 * Math.sin(time * 27 + i);
    f.scale.setScalar(s * (i % 3 === 0 ? 1 : 0.85));
    if (Math.random() < dt * 3) emit(f.parent.position.x, 1.6, f.parent.position.z, 1, BIOMES[Ch.biome].accent, 0.4, { rise: 1.6, grav: 0, life: 0.9 });
  }
  for (const m of SC.lava) {
    m.map.offset.x = time * 0.03;
    m.map.offset.y = Math.sin(time * 0.4) * 0.05;
  }
  if (SC.fountain) SC.fountain.userData.water.material.opacity = 0.75 + 0.1 * Math.sin(time * 3);
  // embers drifting up from the abyss around the platform
  if (Math.random() < dt * 6) {
    const room = Ch.room, side = Math.random() < 0.5 ? -1 : 1;
    emit(side * (room.W / 2 + 1.5 + Math.random() * 3), -1, (Math.random() - 0.5) * room.D, 1, BIOMES[Ch.biome].accent, 0.3, { rise: 1.5, grav: 0.2, life: 3 });
  }
  const P = Ch.player;
  SC.heroLight.position.set(P.x, 2.2, P.z);
  SC.heroLight.intensity = 1.1 + 0.08 * Math.sin(time * 8);
  for (const d of SC.doors) {
    const open = Ch.doorsOpen;
    const c = d.leaf.material.color;
    if (open) c.copy(d.color).multiplyScalar(0.45 + 0.15 * Math.sin(time * 3));
    else c.set(0x120a10);
    d.halo.material.opacity = open ? 0.55 + 0.15 * Math.sin(time * 3) : 0.18;
    d.emblem.position.y = 4.75 + Math.sin(time * 2 + d.door.x) * 0.1;
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

function setFlash(mats, amount, tint) {
  for (const m of mats) {
    if (!m.userData.e0) continue;
    m.emissive.copy(m.userData.e0);
    if (tint) m.emissive.lerp(tint, 0.7);
    if (amount > 0) m.emissive.lerp(new THREE.Color(WHITE), amount);
  }
}

const rotOf = (dx, dz) => Math.atan2(dx, dz);

function syncHero(dt, time) {
  const P = Ch.player, m = SC.hero, rig = m.rig;
  const speed = Math.hypot(P.vx, P.vz);
  m.root.position.set(P.x, 0, P.z);
  const want = rotOf(P.face.x, P.face.z);
  m.root.rotation.y = turnTo(m.root.rotation.y, want, dt * 22);
  SC.walk += dt * Math.min(speed, 8) * 1.6;
  const amp = P.state === 'run' ? Math.min(1, speed / 5) : 0;
  rig.legs[0].rotation.x = Math.sin(SC.walk) * 0.75 * amp;
  rig.legs[1].rotation.x = -Math.sin(SC.walk) * 0.75 * amp;
  rig.arms[0].rotation.x = -Math.sin(SC.walk) * 0.6 * amp;
  rig.body.position.y = Math.abs(Math.sin(SC.walk)) * 0.07 * amp;
  rig.torso.rotation.x = 0.12 * amp;
  rig.cape.rotation.x = 0.15 + amp * 0.65 + Math.sin(time * 4) * 0.05;
  rig.body.rotation.set(0, 0, 0);
  const w = rig.weapon;
  w.rotation.set(0.2, -0.5, 0);
  w.position.set(0.3, 1.05, 0.1);
  rig.arms[1].rotation.set(-0.4, 0, 0);
  if (Run.weapon === 'bow') {
    w.rotation.set(0, 0, 0);
    w.position.set(0.05, 1.2, 0.2);
    rig.arms[1].rotation.set(-1.3, 0, 0.2);
    rig.arms[0].rotation.set(-1.3 + (P.charging ? Math.min(P.charge, 0.5) * 0.6 : 0), 0, -0.2);
    if (P.state === 'volley') rig.body.rotation.x = -0.15;
  } else if (P.state === 'attack') {
    const a = P.atk, p = clamp((P.st - a.windup) / (a.active + 0.05), 0, 1);
    if (P.strikeKind === 2 || P.strikeKind === 'dash') {
      w.rotation.set(0, 0, 0);
      w.position.set(0.15, 1.1, 0.1 + p * 0.6);
      rig.arms[1].rotation.set(-1.4, 0, 0);
      rig.torso.rotation.x = 0.25;
    } else {
      const dir = P.strikeKind === 0 ? 1 : -1;
      w.rotation.set(0, dir * (1.4 - p * 2.8), 0);
      rig.arms[1].rotation.set(-1.2, 0, dir * (0.6 - p * 1.2));
      rig.torso.rotation.y = dir * (0.4 - p * 0.8);
    }
  } else if (P.state === 'special') {
    const s = WEAPONS.sword.special, p = clamp(P.st / (s.windup + 0.15), 0, 1);
    rig.body.rotation.y = -p * Math.PI * 2;
    w.rotation.set(0, Math.PI / 2, 0);
    rig.arms[1].rotation.set(-1.5, 0, 0);
  } else if (P.state === 'cast') {
    rig.arms[1].rotation.set(-2.2 + (P.st / CAST.recover) * 1.2, 0, 0);
  } else if (P.state === 'dash') {
    rig.body.rotation.x = 0.45;
    rig.cape.rotation.x = 1.2;
  } else if (P.state === 'dead') {
    rig.body.rotation.x = -Math.min(1, P.st * 2) * 1.4;
    rig.body.position.y = 0.1;
  }
  const blink = P.iframes > 0.1 && P.state !== 'dash' && Math.sin(time * 40) > 0;
  m.root.visible = !blink;
  setFlash(m.mats, P.state === 'dash' ? 0.25 : 0, null);
}

function syncEnemies(dt, time) {
  const frozenTint = new THREE.Color(0x7fd8ff), burnTint = new THREE.Color(0xff4a10);
  for (const [e, v] of SC.enemies) {
    const m = v.m, rig = m.rig, root = m.root;
    if (v.dying > 0) {
      v.dying += dt;
      const a = v.dying / 0.45;
      root.scale.setScalar(Math.max(0.01, v.scale * (1 - a * 0.6)));
      root.position.y = -a * 0.8;
      root.rotation.z = a * 0.6;
      setFlash(m.mats, 1 - a, null);
      if (a >= 1) {
        SC.scene.remove(root);
        SC.enemies.delete(e);
      }
      continue;
    }
    const grow = e.spawnT > 0 ? 1 - e.spawnT / (e.def.boss ? 1.4 : 0.9) : 1;
    root.scale.setScalar(Math.max(0.01, v.scale * clamp(grow, 0.05, 1)));
    root.position.set(e.x, e.y || 0, e.z);
    root.rotation.y = turnTo(root.rotation.y, rotOf(Math.cos(e.ang), Math.sin(e.ang)), dt * 14);
    const frozen = e.frozen > 0;
    setFlash(m.mats, e.flash, frozen ? frozenTint : e.burn > 0 ? burnTint : null);
    if (e.burn > 0 && Math.random() < dt * 10) emit(e.x, 1, e.z, 1, 0xff7a2a, 0.6, { rise: 1.4, grav: 0, life: 0.5 });
    if (e.chill > 0 && Math.random() < dt * 6) emit(e.x, 1, e.z, 1, 0xc8f6ff, 0.6, { rise: 0.6, grav: 0, life: 0.5 });
    if (frozen) continue;
    v.walk += dt * Math.min(e.speedNow, 8) * 1.8;
    const amp = Math.min(1, e.speedNow / 3);
    animateEnemy(e, rig, v, time, amp);
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
  switch (e.type) {
    case 'bat': {
      const f = Math.sin(time * 22 + e.id) * 0.9;
      rig.wings[0].rotation.z = f;
      rig.wings[1].rotation.z = -f;
      rig.body.position.y = 1.2 + Math.sin(time * 5 + e.id) * 0.15;
      break;
    }
    case 'slime':
    case 'slimelet': {
      const sq = e.state === 'hop' ? 1.15 : 1 - 0.08 * Math.sin(time * 6 + e.id);
      rig.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      break;
    }
    case 'wraith':
      rig.body.position.y = 0.35 + Math.sin(time * 3 + e.id) * 0.15;
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
    case 'wyrm': {
      const fl = Math.sin(time * (e.state === 'dive' ? 8 : 2.2)) * (e.state === 'dive' ? 0.8 : 0.25);
      rig.wings[0].rotation.z = fl;
      rig.wings[1].rotation.z = -fl;
      rig.tails.forEach((t, i) => (t.rotation.y = Math.sin(time * 2 - i * 0.6) * 0.25));
      const open = e.data.breathing || e.state === 'breath' ? 0.5 : 0.08 + Math.sin(time * 1.5) * 0.04;
      rig.jaw.rotation.x = open;
      rig.mouthGlow.material.opacity = e.data.breathing ? 1 : e.state === 'breath' ? 0.4 + e.st : 0.4;
      rig.neck.rotation.x = winding ? -0.25 : 0;
      if (e.data.breathing) {
        const a = e.data.breathAng;
        for (let i = 0; i < 3; i++) {
          const d = 1.5 + Math.random() * 8.5, spread = (Math.random() - 0.5) * 0.6;
          emit(e.x + Math.cos(a + spread) * d, 0.8 + Math.random(), e.z + Math.sin(a + spread) * d, 1, i ? 0xff7a2a : 0xffd060, 1.5, { big: true, grav: 1, life: 0.5 });
        }
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
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xff3a5a }));
    c.scale.y = 1.6;
    g.add(c, glowSprite(0xff3a5a, 1.2, 0.9));
  } else if (p.kind === 'rock') {
    g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.28), toon(0x6a5a4a)));
  } else if (p.owner === 'player') {
    const len = p.pierce ? 1.4 : 0.9;
    const s = glowSprite(p.pierce ? 0xfff0c0 : 0xffc777, p.pierce ? 1.2 : 0.7, 1);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 5), new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft, s);
  } else if (p.kind === 'arrow') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), new THREE.MeshBasicMaterial({ color: 0xe6dcc4 }));
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft, glowSprite(0xff4a3a, 0.8, 0.9));
  } else {
    const col = p.kind === 'orb' ? 0x7fffe0 : 0xff7a2a;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })), glowSprite(col, p.kind === 'orb' ? 1.3 : 1, 1));
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
    if (p.kind === 'ember' || p.kind === 'orb') {
      if (Math.random() < dt * 20) emit(p.x, 1, p.z, 1, p.kind === 'orb' ? 0x7fffe0 : 0xff7a2a, 0.3, { life: 0.3, grav: 0 });
    }
  }
  for (const [p, o] of SC.projs) {
    if (!live.has(p)) {
      SC.scene.remove(o);
      SC.projs.delete(p);
    }
  }
}

function pickupObj(k) {
  const g = new THREE.Group();
  if (k.kind === 'gold') {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), toon(0xf7c948, { emissive: 0x4a3000 }));
    coin.rotation.x = Math.PI / 2;
    g.add(coin, glowSprite(0xffd23a, 0.9, 0.6));
  } else if (k.kind === 'heal') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5d6c })), glowSprite(0xff5d6c, 1.2, 0.8));
  } else if (k.kind === 'crystal') {
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.25), new THREE.MeshBasicMaterial({ color: 0xff3a5a }));
    c.scale.y = 1.7;
    g.add(c, glowSprite(0xff3a5a, 1.4, 0.8));
  } else {
    const look = rewardLook(k.reward);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(emblemCanvas(look.glyph, look.color, 256)), transparent: true }));
    sprite.scale.setScalar(1.3);
    sprite.position.y = 0.7;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: look.color }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    g.add(sprite, ring, glowSprite(new THREE.Color(look.color), 3, 0.5));
    g.userData.ring = ring;
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
    o.rotation.y += dt * 2.5;
    if (k.kind === 'reward' && Math.random() < dt * 12) {
      emit(k.x + (Math.random() - 0.5), 0.3, k.z + (Math.random() - 0.5), 1, rewardLook(k.reward).color, 0.4, { rise: 1.6, grav: 0, life: 1 });
    }
  }
  for (const [k, o] of SC.picks) {
    if (!live.has(k)) {
      SC.scene.remove(o);
      SC.picks.delete(k);
    }
  }
}

const teleMat = (opacity, color = 0xff3a2a) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

function teleGeometry(shape, arc) {
  if (shape === 'circle') {
    const g = new THREE.CircleGeometry(1, 36);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  if (shape === 'cone') {
    const g = new THREE.CircleGeometry(1, 24, -arc / 2, arc);
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
  const base = new THREE.Mesh(geo, teleMat(0.16, color));
  const fill = new THREE.Mesh(geo, teleMat(0.32, color));
  const edge = shape === 'circle' ? new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 40).rotateX(-Math.PI / 2), teleMat(0.7, color)) : null;
  const g = new THREE.Group();
  g.add(base, fill);
  if (edge) g.add(edge);
  g.userData = { base, fill, edge, shape, arc };
  SC.scene.add(g);
  return g;
}

function placeTele(g, t) {
  const { fill, base, edge, shape } = g.userData;
  const p = clamp(t.p, 0, 1);
  g.position.set(t.x, 0.05, t.z);
  if (shape === 'circle') {
    base.scale.set(t.r, 1, t.r);
    fill.scale.set(t.r * p, 1, t.r * p);
    edge.scale.set(t.r, 1, t.r);
    g.rotation.y = 0;
  } else if (shape === 'cone') {
    base.scale.set(t.r, 1, t.r);
    fill.scale.set(t.r * p, 1, t.r * p);
    g.rotation.y = -t.ang;
  } else {
    base.scale.set(t.len, 1, t.w);
    fill.scale.set(t.len * p, 1, t.w);
    g.rotation.y = -t.ang;
  }
}

function syncTeles() {
  const seen = new Set();
  for (const e of Ch.enemies) {
    if (!e.tele) continue;
    seen.add(e);
    let g = SC.teles.get(e);
    if (!g || g.userData.shape !== e.tele.shape || g.userData.arc !== e.tele.arc) {
      if (g) SC.scene.remove(g);
      g = makeTele(e.tele.shape, e.tele.arc, 0xff3a2a);
      SC.teles.set(e, g);
    }
    placeTele(g, e.tele);
  }
  for (const [e, g] of SC.teles) {
    if (!seen.has(e)) {
      SC.scene.remove(g);
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
        o = makeTele('circle', 0, h.look === 'fire' ? 0xff6a1a : 0xff3a2a);
        if (h.look === 'rock' || h.look === 'fire') {
          const fall = h.look === 'rock' ? new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), toon(0x6a5a4a)) : glowSprite(0xff8a2a, 1.6, 1);
          o.add(fall);
          o.userData.fall = fall;
        }
      } else if (h.kind === 'ring') {
        o = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 64).rotateX(-Math.PI / 2), teleMat(0.85, 0xff5a2a));
        SC.scene.add(o);
      } else {
        const col = h.look === 'ember' ? 0xff6a1a : 0xff4a10;
        o = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CircleGeometry(h.r, 28).rotateX(-Math.PI / 2), teleMat(h.owner === 'player' ? 0.35 : 0.5, col));
        o.add(disc, glowSprite(col, h.r * 2.6, 0.5));
        SC.scene.add(o);
      }
      SC.hazards.set(h, o);
    }
    if (h.kind === 'aoe') {
      placeTele(o, { x: h.x, z: h.z, r: h.r, p: h.t / Math.max(h.delay, 0.01) });
      if (o.userData.fall) {
        const a = clamp(h.t / h.delay, 0, 1);
        o.userData.fall.position.y = (1 - a) * 12;
        o.userData.fall.visible = !h.fired;
      }
    } else if (h.kind === 'ring') {
      o.position.set(h.x, 0.1, h.z);
      const r = Math.max(0.05, h.speed * h.t);
      o.scale.set(r, 1, r);
    } else {
      o.position.set(h.x, 0.04, h.z);
      const a = h.t / h.life;
      o.children[0].material.opacity = (h.owner === 'player' ? 0.35 : 0.5) * (a > 0.8 ? (1 - a) * 5 : 1);
      if (Math.random() < dt * 8) emit(h.x + (Math.random() - 0.5) * h.r, 0.2, h.z + (Math.random() - 0.5) * h.r, 1, 0xff7a2a, 0.4, { rise: 1.4, grav: 0, life: 0.6 });
    }
  }
  for (const [h, o] of SC.hazards) {
    if (!live.has(h)) {
      SC.scene.remove(o);
      SC.hazards.delete(h);
    }
  }
}

// ---- 2D overlay ----------------------------------------------------------------------------------------

const projV = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
function toScreen(x, y, z) {
  projV.set(x, y, z).project(SC.camera);
  if (projV.z > 1) return null;
  return { x: ((projV.x + 1) / 2) * SC.overlay.width, y: ((1 - projV.y) / 2) * SC.overlay.height };
}

function drawOverlay(dt) {
  const g = SC.octx, W = SC.overlay.width, H = SC.overlay.height, d = SC.dpr;
  g.clearRect(0, 0, W, H);
  // lightning arcs
  g.lineCap = 'round';
  for (const b of Ch.bolts) {
    const a = toScreen(b.x0, 1, b.z0), c = toScreen(b.x1, 1, b.z1);
    if (!a || !c) continue;
    g.globalAlpha = 1 - b.t / 0.3;
    g.strokeStyle = '#d8ecff';
    g.shadowColor = '#7cc4ff';
    g.shadowBlur = 14 * d;
    g.lineWidth = 2.5 * d;
    g.beginPath();
    g.moveTo(a.x, a.y);
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      g.lineTo(a.x + (c.x - a.x) * t + (Math.random() - 0.5) * 18 * d, a.y + (c.y - a.y) * t + (Math.random() - 0.5) * 18 * d);
    }
    g.lineTo(c.x, c.y);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.globalAlpha = 1;
  // health bars over hurt or elite enemies
  for (const e of Ch.enemies) {
    if (!e.alive || e.def.boss || e.spawnT > 0 || (e.hp >= e.maxHp && !e.elite)) continue;
    const s = toScreen(e.x, (e.def.flying ? 2 : 1.75) * (e.elite ? 1.15 : 1), e.z);
    if (!s) continue;
    const w = 38 * d, h = 5 * d;
    g.fillStyle = 'rgba(10,6,10,0.85)';
    g.fillRect(s.x - w / 2 - d, s.y - d, w + 2 * d, h + 2 * d);
    g.fillStyle = e.elite ? '#c07cff' : '#e0393e';
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
  // damage numbers
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
  // bow charge ring around the hero
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
    g.fillStyle = `rgba(255,240,220,${SC.flash * 0.7})`;
    g.fillRect(0, 0, W, H);
    SC.flash = Math.max(0, SC.flash - dt * 1.5);
  }
}
