'use strict';

// Procedural low-poly models: cel-shaded materials with an inked outline (inverted hull).
// Every model faces +Z. Builders return { root, rig, mats } where `rig` holds the pivots the
// animation code moves and `mats` the materials that flash white when hit.

const Models = { gradient: null, outline: null, glowTex: null, ready: false };

function initModels() {
  // three-step ramp for the cel shading
  const c = makeCanvas(4, 1), g = c.getContext('2d');
  ['#4a4a4a', '#9a9a9a', '#e0e0e0', '#ffffff'].forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(i, 0, 1, 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  Models.gradient = t;
  Models.outline = new THREE.MeshBasicMaterial({ color: 0x0a0608, side: THREE.BackSide });
  Models.glowTex = new THREE.CanvasTexture(glowCanvas());
  Models.ready = true;
}

function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: Models.gradient, ...extra });
}

function glowMat(color, opacity = 1) {
  return new THREE.SpriteMaterial({
    map: Models.glowTex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(glowMat(color, opacity));
  s.scale.setScalar(size);
  return s;
}

// A mesh with an inked outline. Geometry must be centred on its origin.
function part(geo, mat, x = 0, y = 0, z = 0, outline = 0.07) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) {
    const o = new THREE.Mesh(geo, Models.outline);
    o.scale.setScalar(1 + outline);
    m.add(o);
  }
  return m;
}

function pivot(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

const GEO = {
  sphere: (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h),
  cyl: (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  cone: (r, h, s = 8) => new THREE.ConeGeometry(r, h, s),
};

function eyes(parent, color, y, z, spread, size = 0.045) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(GEO.sphere(size, 8, 6), mat);
    e.position.set(spread * s, y, z);
    parent.add(e);
  }
  const glow = glowSprite(color, size * 9, 0.7);
  glow.position.set(0, y, z + 0.02);
  parent.add(glow);
}

// ---- Hero ---------------------------------------------------------------------------------------

function buildHero(weapon) {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);
  const skin = toon(0xe2b48a), cloth = toon(0x7a1d2a), leather = toon(0x3b2a2a), bronze = toon(0xd29a3c);
  const hair = toon(0x231014), steel = toon(0xdfe4ee, { emissive: 0x331018 });
  const mats = [skin, cloth, leather, bronze, hair, steel];

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.13 * s, 0.9, 0);
    hip.add(part(GEO.cyl(0.09, 0.075, 0.6), leather, 0, -0.3, 0));
    hip.add(part(GEO.box(0.15, 0.12, 0.26), bronze, 0, -0.62, 0.04));
    legs.push(hip);
  }
  body.add(part(GEO.cyl(0.24, 0.27, 0.28), leather, 0, 0.98, 0));
  const torso = pivot(body, 0, 1.1, 0);
  torso.add(part(GEO.cyl(0.3, 0.23, 0.55), cloth, 0, 0.25, 0));
  const plate = part(GEO.sphere(0.27, 12, 8), bronze, 0, 0.32, 0.07);
  plate.scale.set(1, 0.85, 0.65);
  torso.add(plate);
  for (const s of [-1, 1]) torso.add(part(GEO.sphere(0.13, 10, 8), bronze, 0.34 * s, 0.44, 0));
  const head = pivot(torso, 0, 0.72, 0);
  head.add(part(GEO.sphere(0.2), skin, 0, 0, 0));
  const hairMesh = part(GEO.sphere(0.215), hair, 0, 0.05, -0.04, 0.05);
  hairMesh.scale.set(1, 0.85, 1.05);
  head.add(hairMesh);
  const laurel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 6, 18), toon(0xf2c14e, { emissive: 0x3a2400 }));
  laurel.rotation.x = Math.PI / 2;
  laurel.position.y = 0.09;
  head.add(laurel);

  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.36 * s, 0.42, 0);
    sh.add(part(GEO.cyl(0.07, 0.06, 0.48), skin, 0, -0.24, 0));
    sh.add(part(GEO.sphere(0.075, 8, 6), leather, 0, -0.5, 0));
    arms.push(sh);
  }
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.72, 1, 4), toon(0x8e1a26, { side: THREE.DoubleSide }));
  cape.geometry.translate(0, -0.36, 0);
  const capePivot = pivot(torso, 0, 0.42, -0.24);
  capePivot.add(cape);
  cape.castShadow = true;
  mats.push(cape.material);

  // weapon pivot sits at the right hand side of the body so swings read well from above
  const weaponPivot = pivot(body, 0.3, 1.05, 0.1);
  if (weapon === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI * 0.85), toon(0x6b3a1f));
    bow.rotation.z = Math.PI / 2 - Math.PI * 0.425;
    bow.rotation.y = Math.PI / 2;
    bow.position.set(-0.05, 0, 0.35);
    weaponPivot.add(bow);
    const string = new THREE.Mesh(GEO.cyl(0.006, 0.006, 0.86, 4), new THREE.MeshBasicMaterial({ color: 0xf6e6c0 }));
    string.position.set(-0.05, 0, 0.12);
    weaponPivot.add(string);
    const gem = glowSprite(0xffc777, 0.35, 0.8);
    gem.position.set(-0.05, 0, 0.82);
    weaponPivot.add(gem);
  } else {
    const blade = part(GEO.box(0.07, 0.03, 1.05), steel, 0, 0, 0.66, 0.12);
    weaponPivot.add(blade);
    weaponPivot.add(part(GEO.box(0.3, 0.05, 0.06), bronze, 0, 0, 0.12));
    weaponPivot.add(part(GEO.cyl(0.03, 0.03, 0.22, 6), leather, 0, 0, -0.02).rotateX(Math.PI / 2));
    const edge = glowSprite(0xff5a4a, 0.5, 0.35);
    edge.position.set(0, 0, 1.1);
    weaponPivot.add(edge);
  }
  root.scale.setScalar(1.12);
  return { root, rig: { body, torso, head, legs, arms, cape: capePivot, weapon: weaponPivot }, mats, height: 2 };
}

// ---- Enemies ------------------------------------------------------------------------------------

function buildWretch(def, scale = 1) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const skin = toon(def.color), rag = toon(0x2a2a24), claw = toon(0xd8d2c0);
  const trunk = part(GEO.cyl(0.24, 0.42, 0.95, 9), rag, 0, 0.55, 0);
  trunk.rotation.x = 0.3;
  body.add(trunk);
  const head = pivot(body, 0, 1.08, 0.28);
  head.add(part(GEO.sphere(0.23), skin, 0, 0, 0));
  eyes(head, 0xff3b2f, 0.02, 0.19, 0.08);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(body, 0.34 * s, 0.9, 0.12);
    sh.add(part(GEO.cyl(0.07, 0.05, 0.55), skin, 0, -0.27, 0));
    const c = part(GEO.cone(0.07, 0.32, 5), claw, 0, -0.62, 0.04);
    c.rotation.x = Math.PI;
    sh.add(c);
    arms.push(sh);
  }
  root.scale.setScalar(scale);
  return { root, rig: { body, head, arms }, mats: [skin, rag, claw] };
}

function batWing(color, side) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.3 * side, 0.25, 0.7 * side, 0.2, 0.85 * side, 0.05);
  shape.lineTo(0.62 * side, -0.12);
  shape.lineTo(0.45 * side, -0.02);
  shape.lineTo(0.3 * side, -0.16);
  shape.lineTo(0.15 * side, -0.05);
  shape.lineTo(0, -0.1);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(color, { side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.castShadow = true;
  return m;
}

function buildBat(def) {
  const root = new THREE.Group(), body = pivot(root, 0, 1.2, 0);
  const fur = toon(0x2f2040);
  body.add(part(GEO.sphere(0.24), fur, 0, 0, 0));
  for (const s of [-1, 1]) {
    const ear = part(GEO.cone(0.07, 0.18, 5), fur, 0.12 * s, 0.22, 0.04);
    body.add(ear);
  }
  eyes(body, 0xffd84a, 0.05, 0.2, 0.08, 0.04);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.12 * s, 0, 0);
    const wing = batWing(def.color, s);
    w.add(wing);
    wings.push(w);
  }
  return { root, rig: { body, wings }, mats: [fur, wings[0].children[0].material, wings[1].children[0].material] };
}

function buildSkeleton(def, scale = 1, armored = false) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const bone = toon(def.color), dark = toon(0x2b2d36), iron = toon(0x4a4f5e);
  const mats = [bone, dark, iron];
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.11 * s, 0.85, 0);
    hip.add(part(GEO.cyl(0.045, 0.04, 0.8, 6), bone, 0, -0.4, 0));
    if (armored) hip.add(part(GEO.box(0.16, 0.3, 0.18), iron, 0, -0.55, 0.03));
    legs.push(hip);
  }
  const torso = pivot(body, 0, 0.9, 0);
  torso.add(part(GEO.cyl(0.04, 0.04, 0.5, 6), bone, 0, 0.25, -0.02));
  const ribs = part(GEO.cyl(0.22, 0.16, 0.36, 10), armored ? iron : bone, 0, 0.42, 0);
  torso.add(ribs);
  const head = pivot(torso, 0, 0.84, 0.02);
  head.add(part(GEO.sphere(0.19), bone, 0, 0, 0));
  head.add(part(GEO.box(0.2, 0.08, 0.14), bone, 0, -0.14, 0.05));
  if (armored) {
    const helm = part(GEO.cyl(0.22, 0.22, 0.24, 12), iron, 0, 0.07, 0);
    head.add(helm);
    head.add(part(GEO.cone(0.05, 0.3, 6), iron, 0, 0.3, 0));
  }
  eyes(head, armored ? 0xb98cff : 0x7fe8ff, 0.01, 0.16, 0.07, 0.04);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.27 * s, 0.56, 0);
    sh.add(part(GEO.cyl(0.04, 0.035, 0.6, 6), bone, 0, -0.3, 0));
    if (armored) sh.add(part(GEO.sphere(0.13, 10, 8), iron, 0, 0.02, 0));
    arms.push(sh);
  }
  const weapon = pivot(body, 0.32, 1.0, 0.12);
  if (armored) {
    const blade = part(GEO.box(0.12, 0.05, 1.6), toon(0xc8c2d8, { emissive: 0x2a1650 }), 0, 0, 0.9, 0.1);
    weapon.add(blade);
    weapon.add(part(GEO.box(0.42, 0.07, 0.08), iron, 0, 0, 0.1));
    const g = glowSprite(0xb98cff, 0.9, 0.5);
    g.position.set(0, 0, 1.6);
    weapon.add(g);
  } else {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 6, 18, Math.PI * 0.85), toon(0x5a3a26));
    bow.rotation.set(0, Math.PI / 2, Math.PI / 2 - Math.PI * 0.425);
    bow.position.set(-0.1, 0.1, 0.3);
    weapon.add(bow);
  }
  root.scale.setScalar(scale);
  return { root, rig: { body, torso, head, legs, arms, weapon }, mats };
}

function buildSlime(def, scale = 1) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const r = def.radius;
  const goo = toon(def.color, { transparent: true, opacity: 0.82, emissive: 0x0d2a08 });
  const blob = part(GEO.sphere(r, 16, 12), goo, 0, r * 0.85, 0, 0.05);
  blob.scale.y = 0.85;
  body.add(blob);
  body.add(part(GEO.sphere(r * 0.45, 10, 8), toon(0x2f6a28), 0, r * 0.7, -r * 0.1, 0));
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff }), black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(GEO.sphere(r * 0.16, 8, 6), white);
    e.position.set(r * 0.3 * s, r * 1.15, r * 0.62);
    body.add(e);
    const p = new THREE.Mesh(GEO.sphere(r * 0.08, 6, 5), black);
    p.position.set(r * 0.3 * s, r * 1.15, r * 0.75);
    body.add(p);
  }
  root.scale.setScalar(scale);
  return { root, rig: { body, blob }, mats: [goo] };
}

function buildWraith(def) {
  const root = new THREE.Group(), body = pivot(root, 0, 0.35, 0);
  const robe = toon(def.color, { transparent: true, opacity: 0.75, emissive: 0x0a3a34, side: THREE.DoubleSide });
  const cloak = new THREE.Mesh(GEO.cyl(0.14, 0.52, 1.35, 12).toNonIndexed(), robe);
  cloak.position.y = 0.6;
  body.add(cloak);
  const head = pivot(body, 0, 1.35, 0.05);
  head.add(part(GEO.sphere(0.24), toon(0x0d1f22), 0, 0, 0));
  eyes(head, 0xa8fff0, 0.02, 0.2, 0.08, 0.045);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(body, 0.3 * s, 1.1, 0.1);
    const sleeve = part(GEO.cone(0.12, 0.6, 7), robe, 0, -0.25, 0.1, 0);
    sleeve.rotation.x = Math.PI - 0.6;
    sh.add(sleeve);
    arms.push(sh);
  }
  const orb = glowSprite(0x7fffe0, 0.8, 0.8);
  orb.position.set(0, 0.95, 0.5);
  body.add(orb);
  return { root, rig: { body, head, arms, orb }, mats: [robe] };
}

function buildBrute(def, scale = 1) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const skin = toon(def.color), iron = toon(0x3d3a3a), hide = toon(0x4a2a1a), horn = toon(0xe8dcc0);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.3 * s, 0.75, 0);
    hip.add(part(GEO.cyl(0.18, 0.15, 0.7), hide, 0, -0.35, 0));
    legs.push(hip);
  }
  const torso = pivot(body, 0, 0.8, 0);
  const chest = part(GEO.box(1.0, 0.85, 0.65), skin, 0, 0.5, 0);
  torso.add(chest);
  torso.add(part(GEO.sphere(0.42, 12, 10), skin, 0, 0.3, 0.2));
  torso.add(part(GEO.box(1.1, 0.18, 0.7), iron, 0, 0.05, 0));
  const head = pivot(torso, 0, 1.1, 0.15);
  head.add(part(GEO.sphere(0.25), skin, 0, 0, 0));
  head.add(part(GEO.cyl(0.28, 0.28, 0.22, 10), iron, 0, 0.1, 0));
  for (const s of [-1, 1]) {
    const h = part(GEO.cone(0.08, 0.42, 6), horn, 0.3 * s, 0.25, 0);
    h.rotation.z = -0.9 * s;
    head.add(h);
  }
  eyes(head, 0xffb02a, -0.02, 0.22, 0.09);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.6 * s, 0.75, 0);
    sh.add(part(GEO.cyl(0.16, 0.13, 0.75), skin, 0, -0.38, 0));
    sh.add(part(GEO.sphere(0.17, 10, 8), skin, 0, -0.8, 0));
    arms.push(sh);
  }
  const club = pivot(arms[1], 0, -0.82, 0.05);
  club.add(part(GEO.cyl(0.07, 0.1, 1.2, 8), hide, 0, 0, 0.5).rotateX(Math.PI / 2));
  club.add(part(GEO.sphere(0.24, 10, 8), iron, 0, 0, 1.1));
  root.scale.setScalar(scale);
  return { root, rig: { body, torso, head, legs, arms, weapon: club }, mats: [skin, iron, hide] };
}

function buildImp(def) {
  const root = new THREE.Group(), body = pivot(root, 0, 0.25, 0);
  const skin = toon(def.color), dark = toon(0x3a0d12), horn = toon(0x2a1a14);
  body.add(part(GEO.sphere(0.32, 12, 10), skin, 0, 0.6, 0));
  const head = pivot(body, 0, 1.05, 0.05);
  head.add(part(GEO.sphere(0.22), skin, 0, 0, 0));
  for (const s of [-1, 1]) {
    const h = part(GEO.cone(0.06, 0.3, 6), horn, 0.14 * s, 0.2, -0.04);
    h.rotation.z = -0.5 * s;
    head.add(h);
  }
  eyes(head, 0xffe14a, 0.02, 0.18, 0.08);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.18 * s, 0.75, -0.2);
    const wing = batWing(0x5a1018, s);
    wing.scale.setScalar(0.8);
    wing.rotation.x = -Math.PI / 2 + 0.6;
    w.add(wing);
    wings.push(w);
  }
  const tail = part(GEO.cone(0.05, 0.6, 5), dark, 0, 0.35, -0.4);
  tail.rotation.x = -1.2;
  body.add(tail);
  const orb = glowSprite(0xff7a2a, 0.9, 0.9);
  orb.position.set(0, 0.7, 0.45);
  body.add(orb);
  return { root, rig: { body, head, wings, orb }, mats: [skin, dark] };
}

function buildTroll(def) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const skin = toon(def.color), moss = toon(0x3f7a3a), stone = toon(0x8a8478), hide = toon(0x3a2a1a);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.45 * s, 0.9, 0);
    hip.add(part(GEO.cyl(0.26, 0.22, 0.9), skin, 0, -0.45, 0));
    legs.push(hip);
  }
  const torso = pivot(body, 0, 1.0, 0);
  const trunk = part(GEO.sphere(1, 16, 12), skin, 0, 0.75, 0);
  trunk.scale.set(1.15, 0.95, 0.9);
  torso.add(trunk);
  torso.add(part(GEO.box(1.5, 0.3, 1.0), hide, 0, 0.1, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    torso.add(part(GEO.sphere(0.28, 8, 6), moss, Math.cos(a) * 0.7, 1.4 + Math.sin(i) * 0.1, Math.sin(a) * 0.5 - 0.2, 0.05));
  }
  const head = pivot(torso, 0, 1.65, 0.65);
  head.add(part(GEO.sphere(0.42), skin, 0, 0, 0));
  head.add(part(GEO.box(0.5, 0.18, 0.3), skin, 0, -0.25, 0.25));
  eyes(head, 0xffd84a, 0.06, 0.38, 0.15, 0.06);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    head.add(part(new THREE.DodecahedronGeometry(0.12), stone, Math.cos(a) * 0.33, 0.38, Math.sin(a) * 0.33, 0.05));
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 1.05 * s, 1.15, 0.2);
    sh.add(part(GEO.cyl(0.26, 0.22, 1.3), skin, 0, -0.65, 0));
    sh.add(part(GEO.sphere(0.36, 10, 8), skin, 0, -1.35, 0));
    arms.push(sh);
  }
  return { root, rig: { body, torso, head, legs, arms }, mats: [skin, moss, hide] };
}

function dragonWing(color, side) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(1.2 * side, 0.9);
  shape.lineTo(3.4 * side, 1.4);
  shape.lineTo(3.0 * side, 0.2);
  shape.lineTo(2.4 * side, -0.4);
  shape.lineTo(1.6 * side, 0.05);
  shape.lineTo(1.0 * side, -0.6);
  shape.lineTo(0.4 * side, -0.4);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), toon(color, { side: THREE.DoubleSide }));
  m.castShadow = true;
  return m;
}

function buildWyrm(def) {
  const root = new THREE.Group(), body = pivot(root, 0, 0, 0);
  const scale = toon(def.color), belly = toon(0xe8823a, { emissive: 0x401204 }), horn = toon(0xe6dcc0), membrane = 0x5a121c;
  const mats = [scale, belly];
  const trunk = part(GEO.sphere(1, 18, 14), scale, 0, 1.5, 0);
  trunk.scale.set(1.5, 1.05, 2.0);
  body.add(trunk);
  const under = part(GEO.sphere(1, 14, 10), belly, 0, 1.2, 0.35, 0.03);
  under.scale.set(1.15, 0.7, 1.6);
  body.add(under);
  for (const [x, z] of [[-0.95, 1.1], [0.95, 1.1], [-0.95, -1.1], [0.95, -1.1]]) {
    body.add(part(GEO.cyl(0.3, 0.24, 1.1), scale, x, 0.55, z));
  }
  // neck chain up to the head
  const neck = pivot(body, 0, 2.0, 1.6);
  for (let i = 0; i < 3; i++) neck.add(part(GEO.sphere(0.55 - i * 0.07, 12, 10), scale, 0, i * 0.45, i * 0.35));
  const head = pivot(neck, 0, 1.45, 1.25);
  head.add(part(GEO.box(0.95, 0.6, 1.1), scale, 0, 0, 0));
  head.add(part(GEO.box(0.7, 0.35, 0.7), scale, 0, -0.05, 0.75));
  const jaw = pivot(head, 0, -0.3, 0.25);
  jaw.add(part(GEO.box(0.75, 0.18, 1.05), belly, 0, 0, 0.35));
  for (const s of [-1, 1]) {
    const h = part(GEO.cone(0.13, 0.9, 6), horn, 0.35 * s, 0.4, -0.35);
    h.rotation.x = -1.1;
    h.rotation.z = -0.3 * s;
    head.add(h);
  }
  eyes(head, 0xffe14a, 0.15, 0.56, 0.3, 0.08);
  const mouthGlow = glowSprite(0xff7a2a, 1.4, 0.6);
  mouthGlow.position.set(0, -0.2, 1.2);
  head.add(mouthGlow);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.8 * s, 2.3, 0.2);
    const wing = dragonWing(membrane, s);
    wing.rotation.x = -0.5;
    w.add(wing);
    mats.push(wing.material);
    wings.push(w);
  }
  const tail = pivot(body, 0, 1.3, -1.8);
  let seg = tail;
  const tails = [];
  for (let i = 0; i < 5; i++) {
    const p = pivot(seg, 0, 0, i === 0 ? 0 : -0.75);
    const c = part(GEO.cone(0.42 - i * 0.07, 0.9, 8), scale, 0, 0, -0.35);
    c.rotation.x = -Math.PI / 2;
    p.add(c);
    tails.push(p);
    seg = p;
  }
  return { root, rig: { body, neck, head, jaw, wings, tails, mouthGlow }, mats };
}

function buildEnemyModel(type) {
  const def = ENEMIES[type];
  switch (type) {
    case 'wretch': return buildWretch(def);
    case 'bat': return buildBat(def);
    case 'archer': return buildSkeleton(def);
    case 'slime':
    case 'slimelet': return buildSlime(def);
    case 'wraith': return buildWraith(def);
    case 'brute': return buildBrute(def);
    case 'imp': return buildImp(def);
    case 'sentinel': return buildSkeleton(def, 2.1, true);
    case 'troll': return buildTroll(def);
    case 'wyrm': return buildWyrm(def);
    default: return buildWretch(def);
  }
}

// ---- Props --------------------------------------------------------------------------------------

function buildPillar(mat, h) {
  const g = new THREE.Group();
  const base = part(GEO.box(1.15, 0.3, 1.15), mat, 0, 0.15, 0, 0.03);
  const shaft = part(GEO.cyl(0.42, 0.46, h, 14), mat, 0, 0.3 + h / 2, 0, 0.03);
  g.add(base, shaft);
  if (h > 2) g.add(part(GEO.box(1.05, 0.28, 1.05), mat, 0, 0.3 + h + 0.14, 0, 0.03));
  base.receiveShadow = shaft.receiveShadow = true;
  return g;
}

function buildBrazier(color) {
  const g = new THREE.Group();
  const bronze = toon(0x8a5a2a);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = part(GEO.cyl(0.04, 0.04, 1.0, 5), bronze, Math.cos(a) * 0.22, 0.5, Math.sin(a) * 0.22, 0.1);
    leg.rotation.z = Math.cos(a) * 0.25;
    leg.rotation.x = -Math.sin(a) * 0.25;
    g.add(leg);
  }
  const pts = [[0.05, 0], [0.38, 0.05], [0.48, 0.28], [0.44, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = part(new THREE.LatheGeometry(pts, 14), bronze, 0, 0.98, 0, 0.05);
  g.add(bowl);
  const flames = [];
  for (let i = 0; i < 3; i++) {
    const f = glowSprite(i === 0 ? 0xffe0a0 : color, 0.9 - i * 0.1, 0.9);
    f.position.y = 1.35 + i * 0.25;
    g.add(f);
    flames.push(f);
  }
  g.userData.flames = flames;
  return g;
}

function buildUrn() {
  const g = new THREE.Group();
  const clay = toon(0xb0603a), band = toon(0x2a1a14);
  const pts = [[0.0, 0], [0.22, 0.02], [0.32, 0.25], [0.3, 0.5], [0.16, 0.66], [0.18, 0.78], [0.0, 0.78]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  g.add(part(new THREE.LatheGeometry(pts, 14), clay, 0, 0, 0, 0.05));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 6, 18), band);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.36;
  g.add(ring);
  return g;
}

function buildCrystal(color) {
  const g = new THREE.Group();
  const mat = toon(color, { emissive: color, emissiveIntensity: 0.55 });
  for (let i = 0; i < 4; i++) {
    const c = part(new THREE.OctahedronGeometry(0.28), mat, (i % 2 ? 0.2 : -0.18) * (i > 1 ? -1 : 1), 0.5 + i * 0.05, (i > 1 ? 0.15 : -0.12), 0.05);
    c.scale.set(0.7, 2.2 - i * 0.3, 0.7);
    c.rotation.z = (i - 1.5) * 0.25;
    g.add(c);
  }
  const glow = glowSprite(color, 2.6, 0.45);
  glow.position.y = 0.8;
  g.add(glow);
  return g;
}

function buildRock(mat, s) {
  const r = part(new THREE.DodecahedronGeometry(0.6), mat, 0, 0.35 * s, 0, 0.04);
  r.scale.set(s, s * 0.8, s * 0.9);
  r.rotation.y = Math.random() * Math.PI;
  return r;
}

function buildStatue(mat) {
  const g = new THREE.Group();
  g.add(part(GEO.box(1.0, 0.6, 1.0), mat, 0, 0.3, 0, 0.03));
  g.add(part(GEO.cyl(0.25, 0.45, 1.5, 10), mat, 0, 1.35, 0, 0.04));
  g.add(part(GEO.sphere(0.26), mat, 0, 2.25, 0.05, 0.04));
  const wing = part(GEO.box(0.12, 1.0, 0.6), mat, 0.3, 1.8, -0.2, 0.04);
  wing.rotation.z = -0.4;
  const wing2 = wing.clone();
  wing2.position.x = -0.3;
  wing2.rotation.z = 0.4;
  g.add(wing, wing2);
  return g;
}

function buildFountain() {
  const g = new THREE.Group();
  const stone = toon(0x8a8296);
  const pts = [[0, 0], [1.1, 0], [1.2, 0.45], [1.05, 0.5], [0.95, 0.2], [0, 0.2]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(part(new THREE.LatheGeometry(pts, 24), stone, 0, 0, 0, 0.03));
  g.add(part(GEO.cyl(0.14, 0.2, 1.3, 10), stone, 0, 0.8, 0, 0.05));
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), new THREE.MeshBasicMaterial({ color: 0x4fd0ff, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.4;
  g.add(water);
  const glow = glowSprite(0x7cd8ff, 3, 0.6);
  glow.position.y = 1.2;
  g.add(glow);
  g.userData.water = water;
  return g;
}

function buildMerchant() {
  const g = new THREE.Group();
  const robe = toon(0x3a2050), wood = toon(0x5a3a22);
  g.add(part(GEO.cone(0.55, 1.6, 10), robe, 0, 0.8, -0.6));
  g.add(part(GEO.sphere(0.28), toon(0x1a1020), 0, 1.65, -0.6));
  const hood = part(GEO.cone(0.34, 0.5, 10), robe, 0, 1.85, -0.65);
  g.add(hood);
  eyes(g, 0xffd166, 1.66, -0.38, 0.09);
  g.add(part(GEO.box(2.0, 0.12, 0.8), wood, 0, 0.85, 0.25));
  for (const x of [-0.85, 0.85]) g.add(part(GEO.box(0.12, 0.8, 0.7), wood, x, 0.4, 0.25));
  const lamp = glowSprite(0xffc777, 2.2, 0.5);
  lamp.position.set(0, 1.4, 0.2);
  g.add(lamp);
  return g;
}

function buildDoor(mat) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(part(GEO.box(0.5, 3.0, 0.7), mat, 1.15 * s, 1.5, 0, 0.03));
  const arch = part(new THREE.TorusGeometry(1.15, 0.28, 8, 16, Math.PI), mat, 0, 3.0, 0, 0.03);
  g.add(arch);
  const leafMat = new THREE.MeshBasicMaterial({ color: 0x120a10 });
  const leaf = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.6), leafMat);
  leaf.position.set(0, 1.8, -0.05);
  g.add(leaf);
  g.userData.leaf = leaf;
  return g;
}
