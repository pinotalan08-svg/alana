'use strict';

// Procedural 3D models. Each model is assembled from many small primitives, then merged per
// pivot and material so a detailed character costs only a handful of draw calls. Characters
// use cel shading with a rim light, an inked outline (vertices pushed along their normals) and
// a dissolve effect for spawning and dying. Every model faces +Z.

const Models = { ready: false, gradient: null, glowTex: null, grime: null, props: null };

const GEO = {
  sphere: (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h),
  dome: (r, w = 16, h = 8) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: (rt, rb, h, s = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open),
  box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
  cone: (r, h, s = 10) => new THREE.ConeGeometry(r, h, s),
  torus: (r, t, rs = 8, ts = 24, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc),
  lathe: (pts, s = 20) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), s),
  tube: (pts, r, segs = 20, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), segs, r, rs, false),
  ico: (r, d = 1) => new THREE.IcosahedronGeometry(r, d),
  extrude: (shape, depth, bevel = 0.01) => new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10,
  }),
};

// ---- Shader injections ----------------------------------------------------------------------------

const NOISE_GLSL = `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

const DISSOLVE_GLSL = `
  if (dissolve > 0.0) {
    float dn = noise3(vObjPos * 6.0) * 0.7 + noise3(vObjPos * 17.0) * 0.3;
    if (dn < dissolve) discard;
    gl_FragColor.rgb += edgeColor * 4.0 * (1.0 - smoothstep(0.0, 0.08, dn - dissolve));
  }`;

function charUniforms(rim, rimStrength) {
  return {
    rimColor: { value: new THREE.Color(rim) }, rimStrength: { value: rimStrength },
    dissolve: { value: 0 }, edgeColor: { value: new THREE.Color(0xff7a2a) },
    flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 1, 1) }, outlineWidth: { value: 0.022 },
  };
}

function injectVertex(shader, extra = '') {
  shader.vertexShader = 'varying vec3 vObjPos;\nuniform float outlineWidth;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>\n vObjPos = position;\n${extra}`,
  );
}

function injectFragmentHead(shader) {
  shader.fragmentShader = `varying vec3 vObjPos;\nuniform vec3 rimColor; uniform float rimStrength; uniform float dissolve;
    uniform vec3 edgeColor; uniform float flash; uniform vec3 flashColor;\n${NOISE_GLSL}\n` + shader.fragmentShader;
}

// Cel-shaded material with rim light, hit flash and dissolve (shared uniforms per model).
function charMaterial(u, opts = {}) {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap: Models.gradient, map: Models.grime,
    transparent: !!opts.transparent, opacity: opts.opacity ?? 1, side: opts.side || THREE.FrontSide, depthWrite: !opts.transparent,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    injectVertex(shader);
    injectFragmentHead(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <output_fragment>', `
      float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.4);
      outgoingLight += rimColor * rimF * rimStrength;
      outgoingLight = mix(outgoingLight, flashColor, flash);
      #include <output_fragment>
      ${DISSOLVE_GLSL}`);
  };
  m.customProgramCacheKey = () => 'char' + (opts.transparent ? 't' : '');
  return m;
}

function glowMaterial(u) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    injectVertex(shader);
    injectFragmentHead(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>\n${DISSOLVE_GLSL}`);
  };
  m.customProgramCacheKey = () => 'glow';
  return m;
}

// Inked outline: the back faces, pushed out along their normals.
function outlineMaterial(u) {
  const m = new THREE.MeshBasicMaterial({ color: 0x0b0608, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    injectVertex(shader, 'transformed += normal * outlineWidth;');
    injectFragmentHead(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>\n${DISSOLVE_GLSL.replace('gl_FragColor.rgb += edgeColor * 4.0', 'gl_FragColor.rgb = edgeColor * 2.0')}`);
  };
  m.customProgramCacheKey = () => 'outline';
  return m;
}

function initModels() {
  const c = makeCanvas(4, 1), g = c.getContext('2d');
  ['#55505a', '#9a949e', '#dcd8de', '#ffffff'].forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(i, 0, 1, 1);
  });
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  Models.gradient = t;
  Models.glowTex = new THREE.CanvasTexture(glowCanvas());
  Models.grime = new THREE.CanvasTexture(fxCanvas('grime'));
  Models.grime.wrapS = Models.grime.wrapT = THREE.RepeatWrapping;
  // props share one set of materials: rough stone, polished metal, glow, glass, outline
  const pu = charUniforms(0x000000, 0);
  pu.outlineWidth.value = 0.014;
  Models.props = {
    base: new THREE.MeshStandardMaterial({ vertexColors: true, map: Models.grime, roughness: 0.82, metalness: 0.02 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, map: Models.grime, roughness: 0.32, metalness: 0.85 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    clear: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false }),
    outline: outlineMaterial(pu),
  };
  Models.ready = true;
}

function glowSprite(color, size, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: Models.glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(size);
  return s;
}

// ---- Builder: collect parts, merge them per pivot and material ---------------------------------------

function newBuilder(mats) {
  return { mats, buckets: new Map() };
}

const tmpObj = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);

// o: p [x,y,z], r [x,y,z] (Euler), s number|[x,y,z], q Quaternion, layer, outline, at Matrix4 (placement)
function put(B, pivot, geo, color, o = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  tmpObj.position.set(...(o.p || [0, 0, 0]));
  if (o.q) tmpObj.quaternion.copy(o.q);
  else tmpObj.rotation.set(...(o.r || [0, 0, 0]));
  const s = o.s ?? 1;
  if (Array.isArray(s)) tmpObj.scale.set(...s);
  else tmpObj.scale.setScalar(s);
  tmpObj.updateMatrix();
  const m = o.at ? new THREE.Matrix4().multiplyMatrices(o.at, tmpObj.matrix) : tmpObj.matrix;
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(color), k = o.bright || 1, cols = new Float32Array(n * 3);
  const shade = o.shade; // optional per-vertex tint by height: (y) => multiplier
  const pos = g.attributes.position.array;
  for (let i = 0; i < n; i++) {
    const f = (shade ? shade(pos[i * 3 + 1], pos[i * 3], pos[i * 3 + 2]) : 1) * k;
    cols[i * 3] = c.r * f;
    cols[i * 3 + 1] = c.g * f;
    cols[i * 3 + 2] = c.b * f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const layer = o.layer || 'base';
  const key = `${pivot.uuid}|${layer}|${o.outline === false || layer === 'glow' || layer === 'clear' ? 0 : 1}`;
  if (!B.buckets.has(key)) B.buckets.set(key, { pivot, layer, outline: !key.endsWith('0'), geos: [] });
  B.buckets.get(key).geos.push(g);
}

// A tapered limb between two points.
function limb(B, pivot, a, b, r0, r1, color, o = {}) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const dir = Bv.clone().sub(A), len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
  const mid = A.clone().add(Bv).multiplyScalar(0.5);
  put(B, pivot, GEO.cyl(r1, r0, len, o.seg || 10), color, { ...o, p: [mid.x, mid.y, mid.z], q });
}

// A horn or tail: a chain of tapering segments along a curve.
function hornTube(B, pivot, pts, r0, r1, color, o = {}) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const steps = o.steps || 6;
  for (let i = 0; i < steps; i++) {
    const a = curve.getPoint(i / steps), b = curve.getPoint((i + 1) / steps);
    const ra = r0 + (r1 - r0) * (i / steps), rb = r0 + (r1 - r0) * ((i + 1) / steps);
    limb(B, pivot, [a.x, a.y, a.z], [b.x, b.y, b.z], ra, Math.max(0.002, rb), color, o);
  }
}

function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

function bake(B, castShadow = true) {
  const meshes = [];
  for (const b of B.buckets.values()) {
    const geo = mergeGeos(b.geos);
    const mat = B.mats[b.layer] || B.mats.base;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow && b.layer !== 'glow' && b.layer !== 'clear';
    mesh.receiveShadow = b.layer === 'base' || b.layer === 'metal';
    b.pivot.add(mesh);
    meshes.push(mesh);
    if (b.outline && B.mats.outline) {
      const ol = new THREE.Mesh(geo, B.mats.outline);
      ol.userData.outline = true;
      b.pivot.add(ol);
    }
  }
  B.buckets.clear();
  return meshes;
}

function pivot(parent, x, y, z) {
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

// A model's materials share one set of uniforms: flash, dissolve and rim apply to all its parts.
function newCharacter(rim, rimStrength = 0.55, outline = 0.022) {
  const u = charUniforms(rim, rimStrength);
  u.outlineWidth.value = outline;
  const mats = {
    base: charMaterial(u), metal: null, glow: glowMaterial(u),
    clear: charMaterial(u, { transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    outline: outlineMaterial(u),
  };
  mats.metal = mats.base;
  const root = new THREE.Group();
  return { root, u, B: newBuilder(mats), mats, rig: {} };
}

function finishCharacter(c, extra = {}) {
  bake(c.B);
  c.root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  return { root: c.root, rig: c.rig, u: c.u, mats: Object.values(c.mats), ...extra };
}

// ---- Shapes ----------------------------------------------------------------------------------------

function bladeShape(len, w, tip = 0.18) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w * 0.42, len - tip);
  s.lineTo(0, len);
  s.lineTo(w * 0.42, len - tip);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  return s;
}

function wingShape(span, height, scallops = 4) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(span * 0.35, height * 0.9, span, height);
  for (let i = scallops; i > 0; i--) {
    const x0 = (span * i) / scallops, x1 = (span * (i - 1)) / scallops;
    s.quadraticCurveTo((x0 + x1) / 2, height * (0.15 + 0.1 * (i % 2)) - height * 0.25, x1, i === 1 ? 0 : height * 0.2 * (x1 / span));
  }
  return s;
}

function displace(geo, amount, seed) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, rnd = (x, y, z) => {
    const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed) * 43758.5453;
    return h - Math.floor(h);
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (rnd(Math.round(x * 100), Math.round(y * 100), Math.round(z * 100)) - 0.5) * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Open cloth tube with a ragged hem.
function tattered(rt, rb, h, seed, segs = 16) {
  const g = new THREE.CylinderGeometry(rt, rb, h, segs, 4, true);
  const p = g.attributes.position, rnd = mulberry32(seed);
  const cut = Array.from({ length: segs + 1 }, () => rnd());
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < -h / 2 + 1e-4) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * segs) % (segs + 1);
      p.setY(i, y + cut[k] * h * 0.28);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Cloth that the scene animates every frame (cape, banners, robes).
function clothMesh(w, h, colorTop, colorBottom, mat, trim) {
  const geo = new THREE.PlaneGeometry(w, h, 6, 10);
  geo.translate(0, -h / 2, 0);
  const n = geo.attributes.position.count, cols = new Float32Array(n * 3);
  const a = new THREE.Color(colorTop), b = new THREE.Color(colorBottom), t = trim ? new THREE.Color(trim) : null;
  for (let i = 0; i < n; i++) {
    const x = geo.attributes.position.getX(i), y = geo.attributes.position.getY(i);
    const f = -y / h;
    const c = a.clone().lerp(b, f);
    if (t && (f > 0.9 || Math.abs(x) > w / 2 - 0.035)) c.copy(t);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.userData.rest = Float32Array.from(geo.attributes.position.array);
  mesh.userData.h = h;
  return mesh;
}

// ---- Hero -----------------------------------------------------------------------------------------

// Palette and silhouette for each playable hero; one builder makes all four.
const HERO_STYLES = {
  kael: {
    skin: 0xe2b48a, hair: 0x2a1214, hairTip: 0x7a1e22, tunic: 0x8e1a26, leather: 0x4a3028, bronze: 0xa8742e,
    gold: 0xf2c14e, steel: 0xdfe4ee, dark: 0x1a1012, cape: [0x7a1220, 0x4a0a14], rim: 0xffc070, edge: 0xff5a3a, width: 1, height: 1,
  },
  sira: {
    skin: 0xc8906c, hair: 0x15101c, hairTip: 0x2a1a3a, tunic: 0x2c1c3e, leather: 0x1c1420, bronze: 0x4a4458,
    gold: 0x5fd8c8, steel: 0xd8e8ee, dark: 0x0a0810, cape: [0x2a1a3a, 0x0e0a16], rim: 0x7fe8d8, edge: 0x5fe8d8, width: 0.9, height: 1.02,
  },
  brann: {
    skin: 0xd09a74, hair: 0x9a5426, hairTip: 0xc0743a, tunic: 0x24365a, leather: 0x4a3426, bronze: 0x8c949e,
    gold: 0xe0a848, steel: 0xe8ecf0, dark: 0x1a1012, cape: [0x2a4a8a, 0x101c3a], rim: 0xffd080, edge: 0xffb040, width: 1.16, height: 1.05,
  },
  maelis: {
    skin: 0xf2cdb0, hair: 0xe8eeff, hairTip: 0x9cc8ff, tunic: 0xe6e0f2, leather: 0x5a4a86, bronze: 0x7aa8d8,
    gold: 0x9fe6ff, steel: 0xeaf6ff, dark: 0x1a1430, cape: [0x3a6ab8, 0x16285a], rim: 0x9fd4ff, edge: 0x7fd8ff, width: 0.96, height: 1,
  },
};
const HERO_COL = HERO_STYLES.kael;

// A sphere with an opening in front: a hood.
const hoodGeo = (r) => new THREE.SphereGeometry(r, 18, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.78);

function buildHead(B, head, id, H) {
  put(B, head, GEO.sphere(0.18, 18, 14), H.skin, { s: [0.92, 1.05, 1] });
  put(B, head, GEO.sphere(0.1, 12, 8), H.skin, { p: [0, -0.1, 0.05], s: [1, 0.8, 1] });
  put(B, head, GEO.cone(0.025, 0.07, 6), H.skin, { p: [0, -0.01, 0.18], r: [Math.PI / 2, 0, 0], outline: false });
  for (const s of [-1, 1]) {
    if (id === 'sira') put(B, head, GEO.sphere(0.024, 8, 6), H.gold, { p: [0.065 * s, 0.03, 0.155], layer: 'glow', bright: 2.4 });
    else put(B, head, GEO.sphere(0.022, 8, 6), id === 'maelis' ? 0x2a4a8a : H.dark, { p: [0.065 * s, 0.03, 0.155], outline: false });
    put(B, head, GEO.box(0.07, 0.016, 0.02), H.hair, { p: [0.065 * s, 0.075, 0.16], r: [0, 0, 0.2 * s], outline: false });
    put(B, head, GEO.sphere(0.035, 8, 6), H.skin, { p: [0.17 * s, -0.01, 0], s: [0.5, 1, 0.8] });
  }
  if (id === 'sira') {
    // deep hood, a mask over the mouth, a point falling down the back
    put(B, head, hoodGeo(0.225), H.tunic, { p: [0, 0.02, -0.01], s: [1, 1.05, 1.08] });
    put(B, head, GEO.cone(0.12, 0.34, 10), H.tunic, { p: [0, 0.02, -0.25], r: [-2.1, 0, 0] });
    put(B, head, GEO.cyl(0.135, 0.15, 0.13, 16, true), H.gold, { p: [0, -0.1, 0.02] });
    put(B, head, GEO.cyl(0.11, 0.19, 0.18, 16, true), H.tunic, { p: [0, -0.22, 0] });
    return;
  }
  if (id === 'brann') {
    // horned helm, a braided beard
    put(B, head, GEO.dome(0.205, 16, 8), H.bronze, { p: [0, 0.03, -0.01], layer: 'metal' });
    put(B, head, GEO.torus(0.2, 0.025, 6, 22), H.gold, { p: [0, 0.04, -0.01], r: [Math.PI / 2, 0, 0], layer: 'metal' });
    put(B, head, GEO.box(0.035, 0.14, 0.03), H.bronze, { p: [0, 0.02, 0.2], layer: 'metal' });
    for (const s of [-1, 1]) {
      hornTube(B, head, [[0.17 * s, 0.1, 0], [0.3 * s, 0.18, -0.02], [0.36 * s, 0.34, -0.04], [0.32 * s, 0.46, -0.08]], 0.05, 0.008, 0xf0e4c8, { steps: 5 });
    }
    put(B, head, GEO.cone(0.15, 0.36, 12), H.hair, { p: [0, -0.24, 0.08], r: [Math.PI - 0.2, 0, 0] });
    put(B, head, GEO.box(0.16, 0.04, 0.05), H.hair, { p: [0, -0.07, 0.17], r: [0, 0, 0] });
    for (const s of [-1, 1]) put(B, head, GEO.cone(0.035, 0.22, 6), H.hairTip, { p: [0.07 * s, -0.36, 0.1], r: [Math.PI - 0.3, 0, 0.15 * s] });
    return;
  }
  put(B, head, GEO.sphere(0.195, 16, 10, 0), H.hair, { p: [0, 0.04, -0.03], s: [1.02, 0.95, 1.05] });
  if (id === 'maelis') {
    // long silver hair down the back, a glowing circlet with a gem
    for (let k = 0; k < 9; k++) {
      const a = -1.1 + (k / 8) * 2.2;
      put(B, head, GEO.cone(0.075, 0.62, 6), k % 3 === 1 ? H.hairTip : H.hair, {
        p: [Math.sin(a) * 0.13, -0.2, -0.08 + Math.cos(a) * -0.06], r: [Math.PI + 0.25, 0, -a * 0.25],
      });
    }
    put(B, head, GEO.torus(0.192, 0.012, 6, 28), H.gold, { p: [0, 0.07, -0.01], r: [Math.PI / 2 - 0.15, 0, 0], layer: 'glow', bright: 1.6 });
    put(B, head, GEO.ico(0.035, 0), 0xbff2ff, { p: [0, 0.1, 0.19], layer: 'glow', bright: 2.6 });
    return;
  }
  for (let k = 0; k < 9; k++) {
    const a = -1.2 + (k / 8) * 2.4;
    put(B, head, GEO.cone(0.06, 0.22, 6), k % 3 === 1 ? H.hairTip : H.hair, {
      p: [Math.sin(a) * 0.12, 0.13, -0.06 + Math.cos(a) * 0.04], r: [-1.9 + Math.random() * 0.3, 0, -a * 0.6],
    });
  }
  // laurel crown
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    put(B, head, GEO.sphere(0.03, 6, 4), H.gold, {
      p: [Math.sin(a) * 0.2, 0.1 + Math.sin(a * 2) * 0.01, Math.cos(a) * 0.19], r: [0.5, a, 0.4], s: [0.55, 0.32, 1.4], layer: 'glow', bright: 1.15,
    });
  }
}

function buildHero(weapon, id = 'kael') {
  const H = HERO_STYLES[id] || HERO_STYLES.kael;
  const c = newCharacter(H.rim, 0.6, 0.02);
  const { B, root } = c;
  const body = pivot(root, 0, 0, 0);
  const legs = [], knees = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.12 * s, 0.92, 0);
    limb(B, hip, [0, 0, 0], [0, -0.42, 0.02], 0.1, 0.08, H.tunic);
    put(B, hip, GEO.sphere(0.075, 10, 8), H.skin, { p: [0, -0.43, 0.02] });
    const knee = pivot(hip, 0, -0.43, 0.02);
    limb(B, knee, [0, 0, 0], [0, -0.4, -0.02], 0.07, 0.06, id === 'sira' ? H.leather : H.skin);
    put(B, knee, GEO.cyl(0.082, 0.07, 0.28, 12), H.bronze, { p: [0, -0.2, 0.012], layer: 'metal' });
    put(B, knee, GEO.box(0.13, 0.07, 0.27), H.leather, { p: [0, -0.44, 0.04] });
    for (let k = 0; k < 3; k++) put(B, knee, GEO.torus(0.07, 0.01, 4, 12), H.leather, { p: [0, -0.32 + k * 0.05, 0], r: [Math.PI / 2, 0, 0], outline: false });
    legs.push(hip);
    knees.push(knee);
  }
  if (id === 'maelis') {
    // a long robe, split at the front, trimmed with light
    put(B, body, GEO.lathe([[0.4, 0.06], [0.42, 0.08], [0.36, 0.3], [0.28, 0.7], [0.24, 0.98], [0, 1.0]], 22), H.tunic, {});
    put(B, body, GEO.torus(0.41, 0.02, 6, 30), H.gold, { p: [0, 0.08, 0], r: [Math.PI / 2, 0, 0], layer: 'glow', bright: 1.3, outline: false });
    put(B, body, GEO.box(0.06, 0.9, 0.02), H.leather, { p: [0, 0.52, 0.3], r: [0.12, 0, 0] });
  } else {
    // pteruges: leather strips around the hips
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      put(B, body, GEO.box(0.085, 0.27, 0.03), k % 2 ? H.tunic : H.leather, {
        p: [Math.sin(a) * 0.25, 0.83, Math.cos(a) * 0.23], r: [Math.cos(a) * 0.22, a, -Math.sin(a) * 0.22], outline: false,
      });
    }
  }
  put(B, body, GEO.torus(0.25, 0.035, 6, 20), H.leather, { p: [0, 0.98, 0], r: [Math.PI / 2, 0, 0] });
  put(B, body, GEO.box(0.09, 0.08, 0.04), H.gold, { p: [0, 0.98, 0.25], layer: 'metal' });
  const torso = pivot(body, 0, 1.0, 0);
  put(B, torso, GEO.lathe([[0.0, 0], [0.23, 0], [0.27, 0.18], [0.33, 0.42], [0.3, 0.56], [0.14, 0.64], [0, 0.65]], 18), H.tunic, { s: [1, 1, 0.78] });
  if (id !== 'sira') put(B, torso, GEO.sphere(0.29, 16, 12), H.bronze, { p: [0, 0.38, 0.07], s: [1, 0.85, 0.55], layer: 'metal' });
  put(B, torso, GEO.box(0.05, 0.62, 0.03), H.leather, { p: [0.02, 0.33, 0.23], r: [0, 0, 0.62] });
  const pad = id === 'brann' ? 1.35 : 1;
  for (const s of [-1, 1]) {
    if (id === 'sira') {
      put(B, torso, GEO.dome(0.12, 12, 6), H.leather, { p: [0.33 * s, 0.52, 0], r: [0, 0, -0.5 * s], s: [1, 0.6, 1] });
      continue;
    }
    put(B, torso, GEO.dome(0.15, 14, 6), H.bronze, { p: [0.34 * s, 0.52, 0], r: [0, 0, -0.5 * s], s: [pad, 0.7 * pad, 1.05 * pad], layer: 'metal' });
    put(B, torso, GEO.torus(0.13 * pad, 0.018, 4, 16), H.gold, { p: [0.36 * s, 0.47, 0], r: [Math.PI / 2, 0.5 * s, 0], outline: false });
  }
  if (id === 'brann') put(B, torso, GEO.torus(0.27, 0.11, 8, 22), H.cape[0], { p: [0, 0.6, -0.03], r: [Math.PI / 2 + 0.15, 0, 0] });
  if (id === 'sira') {
    put(B, torso, GEO.torus(0.17, 0.06, 8, 18), H.gold, { p: [0, 0.62, 0.02], r: [Math.PI / 2 + 0.2, 0, 0] });
    for (const s of [-1, 1]) put(B, torso, GEO.box(0.03, 0.66, 0.025), H.leather, { p: [0.08 * s, 0.33, 0.235], r: [0, 0, 0.55 * s] });
  }
  put(B, torso, GEO.cyl(0.07, 0.08, 0.12, 10), H.skin, { p: [0, 0.68, 0] });
  const head = pivot(torso, 0, 0.84, 0.01);
  buildHead(B, head, id, H);
  const arms = [], elbows = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.36 * s, 0.48, 0);
    limb(B, sh, [0, 0, 0], [0.02 * s, -0.3, 0], 0.07, 0.06, id === 'maelis' || id === 'sira' ? H.tunic : H.skin);
    const el = pivot(sh, 0.02 * s, -0.3, 0);
    limb(B, el, [0, 0, 0], [0, -0.27, 0.03], 0.058, 0.05, H.skin);
    put(B, el, GEO.cyl(0.066, 0.06, 0.15, 10), H.bronze, { p: [0, -0.15, 0.02], layer: 'metal' });
    put(B, el, GEO.sphere(0.06, 10, 8), H.skin, { p: [0, -0.31, 0.03] });
    arms.push(sh);
    elbows.push(el);
  }
  const capePivot = pivot(torso, 0, 0.56, -0.2);
  const capeSize = id === 'sira' ? [0.5, 0.72] : id === 'brann' ? [0.72, 1.0] : id === 'maelis' ? [0.62, 1.1] : [0.6, 0.98];
  const cape = clothMesh(capeSize[0], capeSize[1], H.cape[0], H.cape[1], charMaterial(c.u, { side: THREE.DoubleSide }), H.gold);
  capePivot.add(cape);

  const weaponPivot = pivot(body, 0.3, 1.05, 0.12);
  const tip = new THREE.Object3D(), base = new THREE.Object3D();
  weaponPivot.add(tip, base);
  if (weapon === 'bow') {
    const curve = [[0, -0.55, 0.02], [0, -0.42, 0.1], [0, -0.2, 0.04], [0, 0, 0.0], [0, 0.2, 0.04], [0, 0.42, 0.1], [0, 0.55, 0.02]];
    put(B, weaponPivot, GEO.tube(curve.map(([x, y, z]) => [x, y, z + 0.32]), 0.03, 24, 6), id === 'maelis' ? 0xd8e4f4 : 0x6b3a1f, {});
    put(B, weaponPivot, GEO.cyl(0.006, 0.006, 1.06, 4), 0xf6e6c0, { p: [0, 0, 0.35], outline: false });
    for (const y of [-0.56, 0.56]) put(B, weaponPivot, GEO.sphere(0.035, 8, 6), H.gold, { p: [0, y, 0.34], layer: 'glow', bright: 1.3 });
    put(B, weaponPivot, GEO.sphere(0.05, 10, 8), H.edge, { p: [0, 0, 0.33], layer: 'glow', bright: 2.2 });
    tip.position.set(0, 0.55, 0.34);
    base.position.set(0, -0.55, 0.34);
  } else {
    const len = id === 'brann' ? 1.15 : id === 'sira' ? 0.85 : 1.0;
    const blade = GEO.extrude(bladeShape(len, id === 'brann' ? 0.13 : 0.1, 0.2), 0.016, 0.008);
    put(B, weaponPivot, blade, H.steel, { p: [0, 0, 0.18], r: [Math.PI / 2, 0, 0], layer: 'metal' });
    put(B, weaponPivot, GEO.box(0.012, 0.012, len * 0.7), H.edge, { p: [0, 0.018, 0.18 + len * 0.37], layer: 'glow', bright: 2.4 });
    put(B, weaponPivot, GEO.torus(0.11, 0.022, 6, 16, Math.PI), H.gold, { p: [0, 0, 0.17], r: [Math.PI / 2, 0, Math.PI], layer: 'metal' });
    put(B, weaponPivot, GEO.cyl(0.026, 0.026, 0.2, 8), H.leather, { p: [0, 0, 0.05], r: [Math.PI / 2, 0, 0] });
    put(B, weaponPivot, GEO.sphere(0.04, 10, 8), H.gold, { p: [0, 0, -0.06], layer: 'metal' });
    tip.position.set(0, 0, 0.18 + len);
    base.position.set(0, 0, 0.3);
  }
  root.scale.set(1.12 * H.width, 1.12 * H.height, 1.12 * H.width);
  return finishCharacter(c, { rig: { body, torso, head, legs, knees, arms, elbows, cape, capePivot, weapon: weaponPivot, tip, base } });
}

// ---- Enemies --------------------------------------------------------------------------------------

function eyes(B, pv, color, y, z, spread, size = 0.04, bright = 3) {
  for (const s of [-1, 1]) put(B, pv, GEO.sphere(size, 8, 6), color, { p: [spread * s, y, z], layer: 'glow', bright });
}

function buildWretch(def) {
  const look = def.look || {};
  const c = newCharacter(look.eye ? look.eye : 0xff6a4a, 0.5), { B, root } = c, skin = def.color, rag = look.rag ?? 0x2e2c26, bone = look.bone ?? 0xc8bfa8;
  const body = pivot(root, 0, 0, 0);
  for (const s of [-1, 1]) limb(B, body, [0.12 * s, 0.6, 0], [0.14 * s, 0, 0.08], 0.06, 0.05, skin);
  put(B, body, tattered(0.22, 0.46, 1.0, 7), rag, { p: [0, 0.62, -0.02], r: [0.28, 0, 0] });
  put(B, body, GEO.sphere(0.3, 14, 10), 0x3a3a30, { p: [0, 0.98, -0.06], s: [1, 0.8, 0.9] });
  const head = pivot(body, 0, 1.12, 0.26);
  put(B, head, GEO.sphere(0.18, 14, 10), bone, { s: [0.9, 1, 1.05] });
  put(B, head, GEO.box(0.16, 0.06, 0.12), bone, { p: [0, -0.13, 0.06] });
  for (let k = 0; k < 5; k++) put(B, head, GEO.cone(0.015, 0.05, 4), 0xf0e8d0, { p: [-0.05 + k * 0.025, -0.1, 0.12], r: [Math.PI, 0, 0], outline: false });
  put(B, head, GEO.cone(0.27, 0.42, 12, true), rag, { p: [0, 0.06, -0.06], r: [-0.35, 0, 0] });
  eyes(B, head, look.eye ?? 0xff3b2f, 0.02, 0.15, 0.065, 0.034, 3.5);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(body, 0.32 * s, 0.95, 0.12);
    limb(B, sh, [0, 0, 0], [0.05 * s, -0.36, 0.08], 0.065, 0.05, skin);
    limb(B, sh, [0.05 * s, -0.36, 0.08], [0.02 * s, -0.66, 0.16], 0.05, 0.04, skin);
    for (let k = -1; k <= 1; k++) {
      put(B, sh, GEO.cone(0.022, 0.2, 5), bone, { p: [0.02 * s + k * 0.03, -0.75, 0.2], r: [Math.PI - 0.5, 0, k * 0.2] });
    }
    arms.push(sh);
  }
  return finishCharacter(c, { rig: { body, head, arms } });
}

function buildBat(def) {
  const c = newCharacter(0xc89cff, 0.6, 0.016), { B, root } = c, fur = 0x2a1c3a, mem = def.color;
  const body = pivot(root, 0, 1.2, 0);
  put(B, body, GEO.sphere(0.22, 14, 10), fur, { s: [1, 0.95, 1.1] });
  put(B, body, GEO.sphere(0.15, 12, 8), fur, { p: [0, 0.14, 0.15] });
  for (const s of [-1, 1]) {
    put(B, body, GEO.cone(0.06, 0.22, 6), fur, { p: [0.08 * s, 0.32, 0.12], r: [-0.2, 0, -0.35 * s] });
    put(B, body, GEO.cone(0.012, 0.05, 4), 0xffffff, { p: [0.03 * s, 0.06, 0.28], r: [Math.PI, 0, 0], outline: false });
  }
  eyes(B, body, 0xffd84a, 0.17, 0.27, 0.055, 0.03, 3);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.15 * s, 0.05, 0);
    put(B, w, GEO.extrude(wingShape(0.85, 0.32, 4), 0.012, 0), mem, { r: [-Math.PI / 2, 0, 0], s: [s, 1, 1], p: [0, 0, 0.16] });
    for (let k = 0; k < 4; k++) limb(B, w, [0, 0.01, 0.1], [s * (0.25 + k * 0.17), 0.01, 0.1 - 0.3 + k * 0.05], 0.012, 0.006, fur, { outline: false });
    wings.push(w);
  }
  return finishCharacter(c, { rig: { body, wings } });
}

function buildSkeleton(def, scale = 1, armored = false) {
  const c = newCharacter(armored ? 0xb98cff : 0x9fe6f2, armored ? 0.75 : 0.55, armored ? 0.016 : 0.018);
  const { B, root } = c, bone = def.color, iron = 0x3e4250, violet = 0xb98cff;
  const body = pivot(root, 0, 0, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.11 * s, 0.86, 0);
    limb(B, hip, [0, 0, 0], [0, -0.42, 0.02], 0.04, 0.035, bone);
    put(B, hip, GEO.sphere(0.05, 8, 6), bone, { p: [0, -0.43, 0.02] });
    limb(B, hip, [0, -0.43, 0.02], [0, -0.82, -0.02], 0.035, 0.03, bone);
    put(B, hip, GEO.box(0.1, 0.05, 0.2), bone, { p: [0, -0.84, 0.05] });
    if (armored) {
      put(B, hip, GEO.cyl(0.09, 0.08, 0.36, 10), iron, { p: [0, -0.2, 0.01], layer: 'metal' });
      put(B, hip, GEO.cyl(0.08, 0.075, 0.3, 10), iron, { p: [0, -0.62, 0], layer: 'metal' });
    }
    legs.push(hip);
  }
  put(B, body, GEO.torus(0.13, 0.04, 6, 14), bone, { p: [0, 0.9, 0], r: [Math.PI / 2, 0, 0] });
  const torso = pivot(body, 0, 0.92, 0);
  for (let k = 0; k < 5; k++) put(B, torso, GEO.sphere(0.04, 8, 6), bone, { p: [0, 0.06 + k * 0.1, -0.06] });
  for (let k = 0; k < 4; k++) {
    put(B, torso, GEO.torus(0.17 - k * 0.012, 0.022, 5, 14, Math.PI * 1.55), bone, { p: [0, 0.22 + k * 0.08, 0], r: [Math.PI / 2, 0, -Math.PI * 0.27 + Math.PI / 2], s: [1, 0.85, 1] });
  }
  put(B, torso, GEO.box(0.04, 0.3, 0.03), bone, { p: [0, 0.33, 0.15] });
  if (armored) {
    put(B, torso, GEO.lathe([[0, 0], [0.2, 0], [0.27, 0.2], [0.3, 0.42], [0.22, 0.56], [0, 0.58]], 16), iron, { p: [0, 0.05, 0], s: [1, 1, 0.8], layer: 'metal' });
    put(B, torso, GEO.box(0.04, 0.4, 0.02), violet, { p: [0, 0.32, 0.245], layer: 'glow', bright: 2 });
    for (const s of [-1, 1]) {
      put(B, torso, GEO.dome(0.16, 12, 6), iron, { p: [0.3 * s, 0.56, 0], r: [0, 0, -0.5 * s], layer: 'metal' });
      for (let k = 0; k < 3; k++) put(B, torso, GEO.cone(0.03, 0.14, 6), 0x8a8e9c, { p: [0.33 * s + k * 0.04 * s, 0.66, -0.06 + k * 0.06], r: [0, 0, -0.6 * s] });
    }
  }
  const head = pivot(torso, 0, 0.78, 0.02);
  put(B, head, GEO.sphere(0.17, 14, 12), bone, { s: [0.95, 1, 1.05] });
  put(B, head, GEO.box(0.16, 0.07, 0.13), bone, { p: [0, -0.15, 0.05] });
  for (const s of [-1, 1]) put(B, head, GEO.sphere(0.05, 8, 6), 0x161018, { p: [0.065 * s, 0.01, 0.13], outline: false });
  eyes(B, head, armored ? violet : 0x7fe8ff, 0.01, 0.16, 0.065, 0.022, 4);
  if (armored) {
    put(B, head, GEO.cyl(0.2, 0.2, 0.26, 16), iron, { p: [0, 0.04, 0], layer: 'metal' });
    put(B, head, GEO.box(0.26, 0.03, 0.05), violet, { p: [0, 0.02, 0.19], layer: 'glow', bright: 2.5 });
    for (let k = 0; k < 7; k++) put(B, head, GEO.cone(0.03, 0.34, 5), 0x8e1a26, { p: [0, 0.22, -0.12 + k * 0.03], r: [-1.2 + k * 0.25, 0, 0] });
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.26 * s, 0.56, 0);
    limb(B, sh, [0, 0, 0], [0.03 * s, -0.3, 0], 0.035, 0.03, bone);
    put(B, sh, GEO.sphere(0.04, 8, 6), bone, { p: [0.03 * s, -0.3, 0] });
    limb(B, sh, [0.03 * s, -0.3, 0], [0.02 * s, -0.56, 0.08], 0.03, 0.025, bone);
    if (armored) put(B, sh, GEO.cyl(0.07, 0.06, 0.2, 10), iron, { p: [0.02 * s, -0.45, 0.04], layer: 'metal' });
    arms.push(sh);
  }
  const weapon = pivot(body, 0.32, 1.0, 0.12);
  if (armored) {
    put(B, weapon, GEO.extrude(bladeShape(1.6, 0.17, 0.3), 0.03, 0.012), 0xc8c2d8, { p: [0, 0, 0.2], r: [Math.PI / 2, 0, 0], layer: 'metal' });
    put(B, weapon, GEO.box(0.03, 0.03, 1.2), violet, { p: [0, 0.03, 0.85], layer: 'glow', bright: 3 });
    put(B, weapon, GEO.box(0.46, 0.08, 0.09), iron, { p: [0, 0, 0.16], layer: 'metal' });
    put(B, weapon, GEO.cyl(0.035, 0.035, 0.3, 8), 0x3a2a2a, { p: [0, 0, 0], r: [Math.PI / 2, 0, 0] });
    const shield = new THREE.Shape();
    shield.moveTo(-0.32, 0.4);
    shield.lineTo(0.32, 0.4);
    shield.lineTo(0.3, -0.1);
    shield.quadraticCurveTo(0.2, -0.42, 0, -0.55);
    shield.quadraticCurveTo(-0.2, -0.42, -0.3, -0.1);
    shield.lineTo(-0.32, 0.4);
    put(B, arms[0], GEO.extrude(shield, 0.05, 0.02), iron, { p: [-0.12, -0.45, 0.12], r: [0, -1.2, 0], layer: 'metal' });
    put(B, arms[0], GEO.box(0.06, 0.6, 0.02), violet, { p: [-0.07, -0.42, 0.18], r: [0, -1.2, 0], layer: 'glow', bright: 2 });
  } else {
    const curve = [[0, -0.48, 0.0], [0, -0.3, 0.12], [0, 0, 0.05], [0, 0.3, 0.12], [0, 0.48, 0]];
    put(B, weapon, GEO.tube(curve.map(([x, y, z]) => [x - 0.1, y + 0.1, z + 0.25]), 0.025, 20, 5), 0x5a3a26);
    put(B, weapon, GEO.cyl(0.004, 0.004, 0.96, 3), 0xe8e0c8, { p: [-0.1, 0.1, 0.25], outline: false });
    put(B, body, GEO.cyl(0.07, 0.06, 0.5, 10), 0x4a3022, { p: [0.12, 1.25, -0.2], r: [0.4, 0, -0.3] });
    for (let k = 0; k < 3; k++) limb(B, body, [0.1 + k * 0.03, 1.45, -0.28], [0.16 + k * 0.03, 1.62, -0.36], 0.01, 0.01, 0xe0d0b0, { outline: false });
  }
  root.scale.setScalar(scale);
  return finishCharacter(c, { rig: { body, torso, head, legs, arms, weapon } });
}

function buildSlime(def) {
  const c = newCharacter(0xd8ffb0, 0.9, 0.02), { B, root } = c, r = def.radius;
  const body = pivot(root, 0, 0, 0);
  put(B, body, displace(GEO.ico(r, 3), 0.12, 3), def.color, { p: [0, r * 0.82, 0], s: [1, 0.85, 1], layer: 'clear', bright: 1.15 });
  put(B, body, GEO.sphere(r * 0.42, 12, 10), 0x2f6a28, { p: [0, r * 0.7, -r * 0.1], outline: false });
  put(B, body, GEO.sphere(r * 0.12, 8, 6), 0xd8d0b0, { p: [r * 0.25, r * 0.5, 0.1], outline: false });
  for (let k = 0; k < 5; k++) put(B, body, GEO.sphere(r * 0.06, 6, 4), 0xc8ffb0, { p: [Math.sin(k * 2.1) * r * 0.5, r * (0.4 + k * 0.12), Math.cos(k * 2.1) * r * 0.4], layer: 'glow', bright: 1.2 });
  for (const s of [-1, 1]) {
    put(B, body, GEO.sphere(r * 0.17, 10, 8), 0xffffff, { p: [r * 0.3 * s, r * 1.15, r * 0.6] });
    put(B, body, GEO.sphere(r * 0.08, 8, 6), 0x111111, { p: [r * 0.3 * s, r * 1.17, r * 0.74], outline: false });
  }
  put(B, body, GEO.sphere(r * 0.1, 8, 6), 0xffffff, { p: [-r * 0.35, r * 1.35, r * 0.25], layer: 'glow', bright: 1.6 });
  return finishCharacter(c, { rig: { body } });
}

function buildWraith(def) {
  const c = newCharacter(0xa8fff0, 1.0, 0.0), { B, root } = c, robe = def.color;
  const body = pivot(root, 0, 0.35, 0);
  put(B, body, tattered(0.16, 0.55, 1.45, 11, 18), robe, { p: [0, 0.6, 0], layer: 'clear' });
  put(B, body, tattered(0.12, 0.42, 1.2, 12, 14), 0x1a4a48, { p: [0, 0.75, 0.02], layer: 'clear' });
  const head = pivot(body, 0, 1.38, 0.04);
  put(B, head, GEO.sphere(0.26, 14, 10, 0), robe, { s: [1, 1.1, 1.05], layer: 'clear' });
  put(B, head, GEO.sphere(0.19, 12, 10), 0x050a0c, { p: [0, -0.02, 0.06], outline: false });
  eyes(B, head, 0xa8fff0, 0.0, 0.22, 0.07, 0.035, 5);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(body, 0.3 * s, 1.12, 0.1);
    put(B, sh, GEO.cone(0.13, 0.62, 10, true), robe, { p: [0, -0.24, 0.12], r: [Math.PI - 0.7, 0, 0], layer: 'clear' });
    for (let k = -1; k <= 1; k++) limb(B, sh, [0, -0.42, 0.3], [k * 0.04, -0.55, 0.42], 0.012, 0.008, 0xd8e8e0, { outline: false });
    arms.push(sh);
  }
  const orb = glowSprite(0x7fffe0, 0.8, 0.9);
  orb.position.set(0, 0.95, 0.55);
  body.add(orb);
  return finishCharacter(c, { rig: { body, head, arms, orb } });
}

function buildBrute(def) {
  const c = newCharacter(0xffb070, 0.5, 0.026), { B, root } = c, skin = def.color, iron = 0x3d3a3a, hide = 0x4a2a1a, horn = 0xe8dcc0;
  const body = pivot(root, 0, 0, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.3 * s, 0.75, 0);
    limb(B, hip, [0, 0, 0], [0.02 * s, -0.38, 0], 0.17, 0.15, hide);
    limb(B, hip, [0.02 * s, -0.38, 0], [0, -0.72, 0.03], 0.14, 0.13, skin);
    put(B, hip, GEO.box(0.24, 0.1, 0.32), iron, { p: [0, -0.74, 0.06], layer: 'metal' });
    legs.push(hip);
  }
  const torso = pivot(body, 0, 0.8, 0);
  put(B, torso, GEO.lathe([[0, 0], [0.42, 0.02], [0.5, 0.3], [0.56, 0.62], [0.4, 0.86], [0, 0.9]], 18), skin, { s: [1.05, 1, 0.85] });
  put(B, torso, GEO.sphere(0.36, 14, 10), skin, { p: [0, 0.3, 0.22] });
  put(B, torso, GEO.torus(0.48, 0.06, 6, 20), hide, { p: [0, 0.08, 0], r: [Math.PI / 2, 0, 0], s: [1.05, 0.85, 1] });
  for (let k = -1; k <= 1; k++) put(B, torso, GEO.sphere(0.06, 8, 6), horn, { p: [k * 0.15, 0.06, 0.42] });
  for (const s of [-1, 1]) {
    put(B, torso, GEO.dome(0.26, 12, 6), iron, { p: [0.55 * s, 0.78, 0], r: [0, 0, -0.6 * s], layer: 'metal' });
    for (let k = 0; k < 3; k++) put(B, torso, GEO.cone(0.045, 0.22, 6), 0x9a9690, { p: [0.62 * s, 0.9 - k * 0.04, -0.1 + k * 0.1], r: [0, 0, -0.9 * s] });
  }
  const head = pivot(torso, 0, 0.98, 0.18);
  put(B, head, GEO.sphere(0.24, 14, 10), skin, { s: [1.05, 0.95, 1] });
  put(B, head, GEO.box(0.3, 0.12, 0.2), skin, { p: [0, -0.12, 0.1] });
  for (const s of [-1, 1]) put(B, head, GEO.cone(0.035, 0.14, 6), horn, { p: [0.1 * s, -0.08, 0.2], r: [-0.4, 0, -0.2 * s] });
  put(B, head, GEO.dome(0.27, 14, 6), iron, { p: [0, 0.03, -0.01], layer: 'metal' });
  for (const s of [-1, 1]) hornTube(B, head, [[0.2 * s, 0.1, 0], [0.38 * s, 0.22, -0.05], [0.44 * s, 0.45, -0.12], [0.38 * s, 0.6, -0.2]], 0.07, 0.01, horn, { steps: 5 });
  eyes(B, head, 0xffb02a, 0.0, 0.21, 0.08, 0.03, 3);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.62 * s, 0.72, 0);
    limb(B, sh, [0, 0, 0], [0.05 * s, -0.42, 0.04], 0.16, 0.13, skin);
    limb(B, sh, [0.05 * s, -0.42, 0.04], [0.02 * s, -0.8, 0.1], 0.13, 0.11, skin);
    put(B, sh, GEO.cyl(0.15, 0.14, 0.18, 10), iron, { p: [0.04 * s, -0.6, 0.07], layer: 'metal' });
    put(B, sh, GEO.sphere(0.16, 10, 8), skin, { p: [0.02 * s, -0.86, 0.1] });
    arms.push(sh);
  }
  const club = pivot(arms[1], 0.02, -0.86, 0.1);
  limb(B, club, [0, 0, -0.1], [0, 0.1, 1.0], 0.06, 0.09, 0x5a3a22);
  put(B, club, GEO.sphere(0.22, 12, 10), iron, { p: [0, 0.11, 1.05], layer: 'metal' });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    put(B, club, GEO.cone(0.04, 0.16, 6), 0x9a9690, { p: [Math.cos(a) * 0.2, 0.11 + Math.sin(a) * 0.2, 1.05], r: [0, 0, a - Math.PI / 2] });
  }
  return finishCharacter(c, { rig: { body, torso, head, legs, arms, weapon: club } });
}

function buildImp(def) {
  const c = newCharacter(0xffc060, 0.6, 0.02), { B, root } = c, skin = def.color, dark = 0x3a0d12, horn = 0x2a1a14;
  const body = pivot(root, 0, 0.25, 0);
  put(B, body, GEO.sphere(0.3, 14, 10), skin, { p: [0, 0.6, 0], s: [1, 1.1, 0.9] });
  put(B, body, GEO.sphere(0.2, 12, 8), 0xf0806a, { p: [0, 0.55, 0.14] });
  for (const s of [-1, 1]) {
    limb(B, body, [0.12 * s, 0.35, 0], [0.16 * s, 0.0, 0.05], 0.06, 0.05, skin);
    limb(B, body, [0.25 * s, 0.75, 0], [0.2 * s, 0.5, 0.35], 0.05, 0.04, skin);
  }
  const head = pivot(body, 0, 1.05, 0.05);
  put(B, head, GEO.sphere(0.21, 14, 10), skin);
  for (const s of [-1, 1]) {
    hornTube(B, head, [[0.12 * s, 0.14, -0.02], [0.22 * s, 0.3, -0.08], [0.2 * s, 0.46, -0.2]], 0.05, 0.005, horn, { steps: 4 });
    put(B, head, GEO.cone(0.05, 0.2, 5), skin, { p: [0.22 * s, 0.03, -0.02], r: [0, 0, -1.2 * s] });
  }
  put(B, head, GEO.box(0.16, 0.03, 0.03), dark, { p: [0, -0.08, 0.19], outline: false });
  eyes(B, head, 0xffe14a, 0.03, 0.17, 0.075, 0.035, 3.5);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.18 * s, 0.78, -0.2);
    put(B, w, GEO.extrude(wingShape(0.6, 0.3, 3), 0.01, 0), 0x5a1018, { r: [-Math.PI / 2 + 0.6, 0, 0], s: [s, 1, 1] });
    wings.push(w);
  }
  hornTube(B, body, [[0, 0.4, -0.25], [0, 0.25, -0.5], [0, 0.35, -0.75], [0, 0.55, -0.85]], 0.04, 0.015, dark, { steps: 6 });
  put(B, body, GEO.cone(0.07, 0.14, 4), dark, { p: [0, 0.6, -0.88], r: [0.3, 0, 0] });
  put(B, body, GEO.sphere(0.12, 12, 8), 0xffa040, { p: [0, 0.6, 0.45], layer: 'glow', bright: 2.5 });
  const orb = glowSprite(0xff7a2a, 1.0, 0.9);
  orb.position.set(0, 0.6, 0.45);
  body.add(orb);
  return finishCharacter(c, { rig: { body, head, wings, orb } });
}

function buildTroll(def) {
  const c = newCharacter(0xb0ffb0, 0.45, 0.03), { B, root } = c, skin = def.color, moss = 0x3f7a3a, stone = 0x8a8478, hide = 0x3a2a1a;
  const body = pivot(root, 0, 0, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.45 * s, 0.9, 0);
    limb(B, hip, [0, 0, 0], [0.04 * s, -0.48, 0.02], 0.27, 0.23, skin);
    limb(B, hip, [0.04 * s, -0.48, 0.02], [0, -0.86, 0.05], 0.22, 0.2, skin);
    for (let k = -1; k <= 1; k++) put(B, hip, GEO.cone(0.05, 0.12, 5), 0xd8d0b8, { p: [k * 0.1, -0.88, 0.25], r: [Math.PI / 2, 0, 0] });
    legs.push(hip);
  }
  const torso = pivot(body, 0, 1.0, 0);
  put(B, torso, GEO.sphere(1, 18, 14), skin, { p: [0, 0.75, 0], s: [1.15, 0.95, 0.9] });
  put(B, torso, GEO.sphere(0.6, 14, 10), 0x8aa894, { p: [0, 0.5, 0.42], s: [1, 0.9, 0.7] });
  put(B, torso, tattered(0.95, 1.0, 0.5, 5, 18), hide, { p: [0, 0.05, 0] });
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    put(B, torso, displace(GEO.ico(0.26, 1), 0.3, k), k % 3 ? moss : stone, { p: [Math.cos(a) * 0.7, 1.35 + Math.sin(k) * 0.12, Math.sin(a) * 0.45 - 0.3] });
  }
  const head = pivot(torso, 0, 1.6, 0.68);
  put(B, head, GEO.sphere(0.42, 16, 12), skin, { s: [1.05, 0.9, 1] });
  put(B, head, GEO.box(0.55, 0.2, 0.32), skin, { p: [0, -0.24, 0.24] });
  for (const s of [-1, 1]) put(B, head, GEO.cone(0.06, 0.3, 6), 0xf0e8d0, { p: [0.18 * s, -0.12, 0.42], r: [-0.3, 0, -0.3 * s] });
  eyes(B, head, 0xffd84a, 0.08, 0.37, 0.15, 0.05, 3.5);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    put(B, head, displace(GEO.ico(0.11, 0), 0.4, k + 20), stone, { p: [Math.cos(a) * 0.32, 0.38, Math.sin(a) * 0.32] });
  }
  put(B, head, GEO.sphere(0.07, 8, 6), 0x5fe0ff, { p: [0, 0.48, 0.2], layer: 'glow', bright: 2.5 });
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 1.05 * s, 1.15, 0.2);
    limb(B, sh, [0, 0, 0], [0.1 * s, -0.7, 0.05], 0.28, 0.23, skin);
    limb(B, sh, [0.1 * s, -0.7, 0.05], [0.05 * s, -1.3, 0.15], 0.23, 0.22, skin);
    put(B, sh, GEO.sphere(0.36, 12, 10), skin, { p: [0.05 * s, -1.38, 0.15] });
    put(B, sh, displace(GEO.ico(0.22, 1), 0.3, s + 9), moss, { p: [0, 0.05, -0.05] });
    arms.push(sh);
  }
  return finishCharacter(c, { rig: { body, torso, head, legs, arms } });
}

function buildWyrm(def) {
  const c = newCharacter(0xffa060, 0.6, 0.03), { B, root } = c;
  const scale = new THREE.Color(def.color).multiplyScalar(0.8).getHex(), dark = 0x4a0c14, belly = 0xd8743a, horn = 0xe6dcc0, membrane = 0x5a121c;
  const body = pivot(root, 0, 0, 0);
  put(B, body, GEO.sphere(1, 20, 16), scale, { p: [0, 1.55, -0.1], s: [1.45, 1.05, 2.0] });
  put(B, body, GEO.sphere(1, 16, 12), belly, { p: [0, 1.25, 0.25], s: [1.1, 0.68, 1.6] });
  for (let k = 0; k < 6; k++) put(B, body, GEO.box(0.9 - k * 0.06, 0.05, 0.12), 0xffb060, { p: [0, 0.62 + k * 0.03, 1.2 - k * 0.42], layer: 'glow', bright: 1.6, outline: false });
  for (let k = 0; k < 7; k++) put(B, body, GEO.cone(0.13, 0.42, 6), dark, { p: [0, 2.55 - Math.abs(k - 2) * 0.05, 1.2 - k * 0.45], r: [-0.35, 0, 0] });
  // overlapping armour plates along the spine and flanks
  for (let k = 0; k < 6; k++) {
    for (const sx of [-1, 1]) put(B, body, GEO.sphere(0.42, 10, 6), dark, { p: [0.55 * sx, 2.25 - Math.abs(k - 2) * 0.06, 1.1 - k * 0.48], r: [0.2, 0, -0.55 * sx], s: [1.1, 0.28, 0.9] });
  }
  for (const [x, z] of [[-0.95, 1.0], [0.95, 1.0], [-0.95, -1.15], [0.95, -1.15]]) {
    limb(B, body, [x, 1.3, z], [x * 1.1, 0.55, z + 0.15], 0.32, 0.26, scale);
    limb(B, body, [x * 1.1, 0.55, z + 0.15], [x * 1.08, 0.08, z + 0.3], 0.24, 0.2, scale);
    for (let k = -1; k <= 1; k++) put(B, body, GEO.cone(0.06, 0.2, 6), horn, { p: [x * 1.08 + k * 0.12, 0.06, z + 0.55], r: [Math.PI / 2, 0, 0] });
  }
  const neck = pivot(body, 0, 2.05, 1.55);
  for (let i = 0; i < 4; i++) {
    put(B, neck, GEO.sphere(0.56 - i * 0.06, 14, 10), scale, { p: [0, i * 0.36, i * 0.3] });
    put(B, neck, GEO.cone(0.09, 0.3, 6), dark, { p: [0, i * 0.36 + 0.48 - i * 0.05, i * 0.3 - 0.2], r: [-0.5, 0, 0] });
  }
  const head = pivot(neck, 0, 1.45, 1.2);
  const flat = [1, 1, 0.62];
  put(B, head, GEO.sphere(0.5, 18, 14), scale, { s: [0.95, 0.72, 1.1] });
  // a long tapering snout, flattened top to bottom, with a rounded nose
  put(B, head, GEO.cyl(0.25, 0.42, 1.0, 14), scale, { p: [0, -0.04, 0.72], r: [Math.PI / 2, 0, 0], s: flat });
  put(B, head, GEO.sphere(0.26, 14, 10), scale, { p: [0, -0.04, 1.22], s: [1, 0.62, 0.8] });
  put(B, head, GEO.cyl(0.1, 0.22, 0.9, 8), dark, { p: [0, 0.18, 0.7], r: [Math.PI / 2 + 0.12, 0, 0], s: [1, 1, 0.3] });
  for (const s of [-1, 1]) {
    put(B, head, GEO.sphere(0.045, 8, 6), 0xff7a2a, { p: [0.11 * s, 0.06, 1.38], layer: 'glow', bright: 3 });
    // heavy brow ridges sweeping back over the eyes, cheek spines
    put(B, head, GEO.cone(0.13, 0.55, 7), dark, { p: [0.24 * s, 0.26, 0.3], r: [-Math.PI / 2 + 0.25, 0, -0.25 * s] });
    for (let k = 0; k < 3; k++) put(B, head, GEO.cone(0.05, 0.32 - k * 0.06, 6), dark, { p: [0.4 * s, -0.12 - k * 0.08, -0.05 - k * 0.12], r: [-Math.PI / 2 + 0.2, 0, -(0.9 + k * 0.15) * s] });
    for (let k = 0; k < 5; k++) put(B, head, GEO.cone(0.03, 0.11, 4), 0xfff4e0, { p: [(0.2 - k * 0.012) * s * (1 + k * 0.12), -0.21, 1.2 - k * 0.15], r: [Math.PI, 0, 0], outline: false });
    hornTube(B, head, [[0.3 * s, 0.25, -0.15], [0.5 * s, 0.5, -0.55], [0.55 * s, 0.62, -0.95], [0.45 * s, 0.82, -1.3]], 0.14, 0.012, horn, { steps: 6 });
    hornTube(B, head, [[0.42 * s, 0.0, -0.1], [0.68 * s, -0.06, -0.42], [0.82 * s, 0.04, -0.68]], 0.07, 0.01, horn, { steps: 4 });
  }
  for (let k = 0; k < 3; k++) put(B, head, GEO.cone(0.07, 0.3 - k * 0.05, 6), dark, { p: [0, 0.34 - k * 0.04, -0.1 - k * 0.22], r: [-0.9, 0, 0] });
  eyes(B, head, 0xffe14a, 0.2, 0.42, 0.26, 0.07, 4);
  const jaw = pivot(head, 0, -0.26, 0.15);
  put(B, jaw, GEO.cyl(0.2, 0.36, 1.05, 12), belly, { p: [0, -0.02, 0.5], r: [Math.PI / 2, 0, 0], s: [1, 1, 0.34] });
  for (let k = 0; k < 6; k++) {
    for (const s of [-1, 1]) put(B, jaw, GEO.cone(0.032, 0.12, 4), 0xfff4e0, { p: [(0.15 + k * 0.025) * s, 0.08, 0.92 - k * 0.13], outline: false });
  }
  const mouthGlow = glowSprite(0xff7a2a, 1.4, 0.6);
  mouthGlow.position.set(0, -0.15, 1.15);
  head.add(mouthGlow);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = pivot(body, 0.8 * s, 2.3, 0.2);
    limb(B, w, [0, 0, 0], [1.4 * s, 1.1, -0.2], 0.12, 0.08, scale);
    limb(B, w, [1.4 * s, 1.1, -0.2], [3.4 * s, 1.5, -0.5], 0.08, 0.05, scale);
    for (const [fx, fy, fz] of [[3.0, 0.2, -0.6], [2.4, -0.4, -0.5], [1.6, -0.5, -0.35]]) limb(B, w, [1.4 * s, 1.1, -0.2], [fx * s, fy, fz], 0.05, 0.02, scale);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(1.4, 1.1);
    sh.lineTo(3.4, 1.5);
    sh.quadraticCurveTo(3.1, 0.8, 3.0, 0.2);
    sh.quadraticCurveTo(2.7, -0.05, 2.4, -0.4);
    sh.quadraticCurveTo(2.0, -0.3, 1.6, -0.5);
    sh.quadraticCurveTo(0.9, -0.5, 0.4, -0.35);
    put(B, w, GEO.extrude(sh, 0.02, 0), membrane, { s: [s, 1, 1], p: [0, 0, -0.3], r: [-0.12, 0, 0], layer: 'clear' });
    wings.push(w);
  }
  const tail = pivot(body, 0, 1.35, -1.9);
  let seg = tail;
  const tails = [];
  for (let i = 0; i < 6; i++) {
    const p = pivot(seg, 0, -0.04, i === 0 ? 0 : -0.66);
    limb(B, p, [0, 0, 0], [0, -0.04, -0.7], 0.4 - i * 0.06, 0.34 - i * 0.06, scale);
    put(B, p, GEO.cone(0.08, 0.26, 6), dark, { p: [0, 0.33 - i * 0.05, -0.3], r: [-0.6, 0, 0] });
    if (i === 5) put(B, p, GEO.extrude(bladeShape(0.6, 0.4, 0.3), 0.04, 0.01), dark, { p: [0, 0, -0.65], r: [-Math.PI / 2, 0, 0] });
    tails.push(p);
    seg = p;
  }
  return finishCharacter(c, { rig: { body, neck, head, jaw, wings, tails, mouthGlow } });
}

// ---- Glacier and Void --------------------------------------------------------------------------------

function buildGolem(def) {
  const c = newCharacter(0x9fe6ff, 0.7, 0.026), { B, root } = c, ice = def.color, rock = 0x4e5c6c, glow = 0x7fe8ff;
  const body = pivot(root, 0, 0, 0);
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = pivot(body, 0.34 * s, 0.82, 0);
    limb(B, hip, [0, 0, 0], [0.02 * s, -0.66, 0.04], 0.24, 0.2, rock);
    put(B, hip, displace(GEO.ico(0.27, 0), 0.3, 3 + s), ice, { p: [0.02 * s, -0.7, 0.1], s: [1.1, 0.65, 1.35] });
    legs.push(hip);
  }
  const torso = pivot(body, 0, 0.85, 0);
  put(B, torso, displace(GEO.ico(0.62, 1), 0.22, 7), rock, { p: [0, 0.48, 0], s: [1.3, 1.0, 0.95] });
  put(B, torso, displace(GEO.ico(0.5, 1), 0.3, 8), ice, { p: [0, 0.62, 0.12], s: [1.25, 0.9, 0.8] });
  put(B, torso, GEO.ico(0.15, 0), glow, { p: [0, 0.52, 0.56], layer: 'glow', bright: 2.4 });
  // a ridge of crystals growing out of the back and shoulders
  for (let k = 0; k < 7; k++) {
    const a = -1.2 + (k / 6) * 2.4;
    put(B, torso, GEO.cone(0.11, 0.55 + (k % 3) * 0.15, 6), 0xd8f4ff, { p: [Math.sin(a) * 0.55, 0.95 + Math.cos(a) * 0.1, -0.35], r: [-0.6, 0, -a * 0.5] });
  }
  const head = pivot(torso, 0, 1.12, 0.22);
  put(B, head, displace(GEO.ico(0.27, 0), 0.25, 9), rock, { s: [1.2, 0.9, 1] });
  put(B, head, GEO.box(0.36, 0.06, 0.1), 0x1a2430, { p: [0, 0.02, 0.2], outline: false });
  eyes(B, head, glow, 0.03, 0.24, 0.1, 0.045, 3.5);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.82 * s, 0.78, 0);
    put(B, sh, displace(GEO.ico(0.3, 0), 0.3, 11 + s), ice, { s: [1.2, 0.9, 1.1] });
    for (let k = 0; k < 3; k++) put(B, sh, GEO.cone(0.07, 0.42 - k * 0.08, 5), 0xd8f4ff, { p: [0.1 * s, 0.22, -0.12 + k * 0.12], r: [0, 0, -0.5 * s] });
    limb(B, sh, [0, -0.1, 0], [0.1 * s, -0.62, 0.1], 0.2, 0.17, rock);
    put(B, sh, displace(GEO.ico(0.32, 0), 0.35, 13 + s), ice, { p: [0.12 * s, -0.86, 0.14], s: [1, 1.1, 1] });
    arms.push(sh);
  }
  return finishCharacter(c, { rig: { body, torso, head, legs, arms } });
}

function buildEye(def) {
  const c = newCharacter(0xd08aff, 0.9, 0.02), { B, root } = c, flesh = def.color, dark = 0x1a0a2a;
  const body = pivot(root, 0, 1.45, 0);
  put(B, body, GEO.sphere(0.48, 18, 14), flesh, { s: [1, 0.95, 1] });
  put(B, body, GEO.torus(0.36, 0.07, 8, 24), dark, { p: [0, 0, 0.3], s: [1, 1, 0.8] });
  put(B, body, GEO.sphere(0.34, 16, 12), 0xf4ecf4, { p: [0, 0, 0.26], s: [1, 1, 0.55], outline: false });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    put(B, body, GEO.cone(0.07, 0.36, 6), dark, { p: [Math.cos(a) * 0.4, Math.sin(a) * 0.4, -0.2], r: [-Math.PI / 2 + Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] });
  }
  const iris = pivot(body, 0, 0, 0.42);
  put(B, iris, GEO.sphere(0.15, 14, 10), 0xc070ff, { s: [1, 1, 0.5], layer: 'glow', bright: 2.4 });
  put(B, iris, GEO.sphere(0.07, 10, 8), 0x05020a, { p: [0, 0, 0.05], s: [0.6, 1, 0.5], outline: false });
  const tentacles = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const t = pivot(body, Math.cos(a) * 0.22, -0.3, Math.sin(a) * 0.22 - 0.05);
    hornTube(B, t, [[0, 0, 0], [Math.cos(a) * 0.12, -0.35, Math.sin(a) * 0.12], [Math.cos(a) * 0.05, -0.75, Math.sin(a) * 0.2], [Math.cos(a) * 0.15, -1.05, Math.sin(a) * 0.1]], 0.07, 0.01, flesh, { steps: 5 });
    tentacles.push(t);
  }
  const glow = glowSprite(0xb060ff, 1.4, 0.4);
  glow.position.set(0, 0, 0.5);
  body.add(glow);
  return finishCharacter(c, { rig: { body, iris, tentacles, glow } });
}

function buildQueen(def) {
  const c = newCharacter(0xbfe8ff, 0.9, 0.024), { B, root } = c, robe = def.color, deep = 0x3a64a8, skin = 0xdce8f4, ice = 0x9fe6ff;
  const body = pivot(root, 0, 0.35, 0);
  put(B, body, GEO.lathe([[0.95, 0], [0.88, 0.12], [0.62, 0.62], [0.4, 1.2], [0.3, 1.5], [0, 1.56]], 26), robe, { shade: (y) => 0.55 + 0.45 * clamp((y - 0.35) / 1.5, 0, 1) });
  put(B, body, GEO.torus(0.92, 0.035, 6, 36), ice, { p: [0, 0.06, 0], r: [Math.PI / 2, 0, 0], layer: 'glow', bright: 1.8, outline: false });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    put(B, body, GEO.cone(0.08, 0.45 + (k % 3) * 0.15, 5), 0xd8f4ff, { p: [Math.cos(a) * 0.85, 0.2, Math.sin(a) * 0.85], r: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9] });
  }
  const torso = pivot(body, 0, 1.5, 0);
  put(B, torso, GEO.lathe([[0.3, 0], [0.34, 0.2], [0.3, 0.42], [0.14, 0.52], [0, 0.54]], 18), deep, { s: [1, 1, 0.8] });
  put(B, torso, GEO.ico(0.08, 0), ice, { p: [0, 0.3, 0.26], layer: 'glow', bright: 2.6 });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) put(B, torso, GEO.cone(0.06, 0.5 - k * 0.1, 5), 0xd8f4ff, { p: [0.3 * s, 0.48, -0.08 + k * 0.08], r: [0, 0, -(0.5 + k * 0.3) * s] });
  }
  const head = pivot(torso, 0, 0.66, 0.02);
  put(B, head, GEO.sphere(0.16, 16, 12), skin, { s: [0.9, 1.08, 1] });
  put(B, head, hoodGeo(0.18), 0xf0f6ff, { p: [0, 0.03, -0.01], s: [1.02, 1, 1.05] });
  for (let k = 0; k < 7; k++) {
    const a = -0.9 + (k / 6) * 1.8;
    put(B, head, GEO.cone(0.06, 0.7, 6), k % 2 ? 0xdfeaff : 0xb8d8ff, { p: [Math.sin(a) * 0.12, -0.25, -0.1], r: [Math.PI + 0.2, 0, -a * 0.2] });
  }
  // the crown: a ring of ice spikes, the tallest in the middle
  for (let k = 0; k < 7; k++) {
    const a = -1.3 + (k / 6) * 2.6, h = 0.2 + (1 - Math.abs(a) / 1.3) * 0.3;
    put(B, head, GEO.cone(0.035, h, 5), ice, { p: [Math.sin(a) * 0.15, 0.17 + h / 2, Math.cos(a) * 0.1], r: [-0.15, 0, -a * 0.35], layer: k === 3 ? 'glow' : 'base', bright: 1.8 });
  }
  eyes(B, head, 0x9ff4ff, 0.02, 0.14, 0.055, 0.025, 4);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 0.32 * s, 0.4, 0);
    limb(B, sh, [0, 0, 0], [0.06 * s, -0.42, 0.06], 0.06, 0.05, skin);
    put(B, sh, GEO.cone(0.16, 0.42, 12, true), deep, { p: [0.05 * s, -0.36, 0.05], r: [Math.PI, 0, 0] });
    arms.push(sh);
  }
  const staff = pivot(arms[1], 0.06, -0.5, 0.1);
  limb(B, staff, [0, -0.9, 0], [0, 1.0, 0], 0.025, 0.025, 0xc8d8ec);
  put(B, staff, GEO.torus(0.09, 0.015, 5, 14), ice, { p: [0, 1.02, 0], layer: 'glow', bright: 1.6 });
  const orb = pivot(staff, 0, 1.18, 0);
  put(B, orb, GEO.ico(0.13, 0), 0xcff8ff, { s: [0.8, 1.5, 0.8], layer: 'glow', bright: 2.4 });
  const halo = glowSprite(0x9fe6ff, 1.6, 0.7);
  orb.add(halo);
  const capePivot = pivot(torso, 0, 0.46, -0.2);
  const cape = clothMesh(1.1, 1.9, deep, 0x16285a, charMaterial(c.u, { side: THREE.DoubleSide }), ice);
  capePivot.add(cape);
  root.scale.setScalar(1.3);
  return finishCharacter(c, { rig: { body, torso, head, arms, staff, orb, cape } });
}

function buildVoidLord(def) {
  const c = newCharacter(0xc080ff, 1.0, 0.035), { B, root } = c;
  const armor = 0x2e2042, dark = 0x100818, trim = 0xa070e0, bone = 0xd8cce8, glow = 0xc070ff;
  const body = pivot(root, 0, 0.5, 0);
  put(B, body, tattered(0.95, 1.6, 2.0, 21, 20), dark, { p: [0, 1.0, 0] });
  put(B, body, tattered(0.8, 1.3, 1.6, 22, 16), 0x2a1440, { p: [0, 1.25, 0.05] });
  const torso = pivot(body, 0, 1.9, 0);
  put(B, torso, GEO.lathe([[0.75, 0], [1.0, 0.4], [1.12, 0.9], [0.92, 1.3], [0.42, 1.48], [0, 1.52]], 22), armor, { s: [1, 1, 0.78] });
  put(B, torso, GEO.torus(0.8, 0.05, 6, 30), trim, { p: [0, 0.12, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.78, 1], layer: 'metal' });
  for (let k = 0; k < 4; k++) {
    put(B, torso, GEO.torus(0.5 - k * 0.05, 0.035, 5, 16, Math.PI), bone, { p: [0, 0.45 + k * 0.2, 0.62], r: [0, 0, Math.PI], s: [1, 0.6, 1] });
  }
  const core = pivot(torso, 0, 0.62, 0.78);
  put(B, core, GEO.ico(0.24, 1), glow, { layer: 'glow', bright: 2.6 });
  const coreGlow = glowSprite(0xb060ff, 2.6, 0.7);
  core.add(coreGlow);
  for (const s of [-1, 1]) {
    put(B, torso, GEO.dome(0.48, 16, 8), armor, { p: [1.05 * s, 1.22, 0], r: [0, 0, -0.45 * s], s: [1, 0.75, 1] });
    for (let k = 0; k < 3; k++) put(B, torso, GEO.cone(0.09, 0.7 - k * 0.15, 6), bone, { p: [(1.1 + k * 0.08) * s, 1.5 - k * 0.08, -0.25 + k * 0.25], r: [-0.2, 0, -(0.35 + k * 0.2) * s] });
  }
  const head = pivot(torso, 0, 1.62, 0.2);
  put(B, head, hoodGeo(0.6), dark, { p: [0, 0.08, -0.08], s: [1.05, 1.1, 1.1] });
  put(B, head, GEO.sphere(0.4, 16, 12), bone, { s: [0.88, 1.05, 1] });
  put(B, head, GEO.box(0.42, 0.16, 0.3), bone, { p: [0, -0.32, 0.12] });
  for (let k = 0; k < 6; k++) put(B, head, GEO.cone(0.025, 0.1, 4), 0xf4ecff, { p: [-0.15 + k * 0.06, -0.24, 0.28], r: [Math.PI, 0, 0], outline: false });
  put(B, head, GEO.sphere(0.11, 12, 10), glow, { p: [0, 0.06, 0.34], layer: 'glow', bright: 3.2 });
  for (const s of [-1, 1]) {
    put(B, head, GEO.sphere(0.045, 8, 6), glow, { p: [0.2 * s, 0.14, 0.3], layer: 'glow', bright: 2.6 });
    hornTube(B, head, [[0.25 * s, 0.25, 0], [0.5 * s, 0.6, -0.1], [0.55 * s, 1.05, -0.3], [0.4 * s, 1.4, -0.55]], 0.12, 0.01, dark, { steps: 6 });
    hornTube(B, head, [[0.3 * s, 0.05, -0.05], [0.65 * s, 0.15, -0.25], [0.85 * s, 0.4, -0.5]], 0.07, 0.008, bone, { steps: 4 });
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = pivot(torso, 1.15 * s, 1.1, 0);
    limb(B, sh, [0, 0, 0], [0.2 * s, -0.95, 0.2], 0.26, 0.21, armor);
    put(B, sh, GEO.torus(0.22, 0.04, 5, 16), trim, { p: [0.1 * s, -0.5, 0.1], r: [Math.PI / 2, 0, 0], layer: 'metal' });
    limb(B, sh, [0.2 * s, -0.95, 0.2], [0.25 * s, -1.75, 0.55], 0.2, 0.17, dark);
    put(B, sh, GEO.sphere(0.24, 12, 10), armor, { p: [0.25 * s, -1.8, 0.58] });
    for (let k = -1.5; k <= 1.5; k++) put(B, sh, GEO.cone(0.05, 0.42, 5), bone, { p: [0.25 * s + k * 0.09, -2.0, 0.7], r: [Math.PI - 0.5, 0, k * 0.15] });
    arms.push(sh);
  }
  const orbs = pivot(body, 0, 2.6, 0);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2, o = pivot(orbs, Math.cos(a) * 2.5, Math.sin(k * 2.1) * 0.5, Math.sin(a) * 2.5);
    put(B, o, GEO.ico(0.2, 0), k % 2 ? glow : 0x7a4ab8, { s: [0.7, 1.4, 0.7], layer: 'glow', bright: 2 });
    o.add(glowSprite(0xa060ff, 1.1, 0.5));
  }
  root.scale.setScalar(1.12);
  return finishCharacter(c, { rig: { body, torso, head, arms, orbs, core } });
}

function buildEnemyModel(type) {
  const def = ENEMIES[type];
  switch (def.model || type) {
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
    case 'golem': return buildGolem(def);
    case 'eye': return buildEye(def);
    case 'queen': return buildQueen(def);
    case 'voidlord': return buildVoidLord(def);
    default: return buildWretch(def);
  }
}

// ---- Props (added to a static builder, merged per room) -----------------------------------------------
// Each prop builder takes the room builder, a pivot and a placement matrix.

const STONE = { crypt: 0x8a8296, cave: 0x5d6f6a, forge: 0x5a4a44, ice: 0xa8c4da, void: 0x3e3450 };

const placeAt = (x, z, rot = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(UP, rot), new THREE.Vector3(s, s, s),
);

function fluted(r, h, flutes = 16) {
  const g = new THREE.CylinderGeometry(r, r * 1.04, h, flutes * 3, 2, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), rr = Math.hypot(x, z);
    if (rr < r * 0.5) continue;
    const a = Math.atan2(z, x), k = 1 - 0.07 * Math.pow(Math.max(0, Math.cos(a * flutes)), 2);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function propPillar(B, pv, at, stone, h, broken) {
  const sh = (y) => 0.75 + Math.min(1, y / 3) * 0.3;
  put(B, pv, GEO.box(1.15, 0.22, 1.15), stone, { p: [0, 0.11, 0], at, shade: sh });
  put(B, pv, GEO.lathe([[0.52, 0], [0.55, 0.06], [0.5, 0.12], [0.46, 0.14]], 24), stone, { p: [0, 0.22, 0], at });
  if (broken) {
    const top = fluted(0.42, h, 16), p = top.attributes.position, rnd = mulberry32(Math.round(h * 100));
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h / 2 - 0.01) p.setY(i, p.getY(i) - rnd() * 0.45);
    top.computeVertexNormals();
    put(B, pv, top, stone, { p: [0, 0.36 + h / 2, 0], at, shade: sh });
    for (let k = 0; k < 3; k++) {
      const a = k * 2.2 + h;
      put(B, pv, displace(GEO.ico(0.2 + k * 0.05, 0), 0.3, k), stone, { p: [Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85], at });
    }
  } else {
    put(B, pv, fluted(0.42, h, 16), stone, { p: [0, 0.36 + h / 2, 0], at, shade: sh });
    put(B, pv, GEO.lathe([[0.44, 0], [0.5, 0.08], [0.6, 0.2], [0.62, 0.26]], 24), stone, { p: [0, 0.36 + h, 0], at });
    put(B, pv, GEO.box(1.3, 0.22, 1.3), stone, { p: [0, 0.36 + h + 0.36, 0], at });
  }
}

function propRock(B, pv, at, color, s, seed) {
  put(B, pv, displace(GEO.ico(0.6, 1), 0.38, seed), color, { p: [0, 0.32 * s, 0], s: [s, s * 0.8, s * 0.9], at, shade: (y) => 0.7 + y * 0.4 });
  put(B, pv, displace(GEO.ico(0.3, 0), 0.4, seed + 1), color, { p: [0.55 * s, 0.12, 0.3 * s], s, at });
}

function propCrystal(B, pv, at, color, seed) {
  const rnd = mulberry32(seed);
  for (let k = 0; k < 5; k++) {
    const a = rnd() * Math.PI * 2, d = k ? 0.18 + rnd() * 0.25 : 0, h = k ? 0.6 + rnd() * 0.6 : 1.5;
    put(B, pv, GEO.cone(0.16 + (k ? 0 : 0.08), h, 6), color, {
      p: [Math.cos(a) * d, h / 2, Math.sin(a) * d], r: [Math.sin(a) * 0.4 * (k ? 1 : 0.2), 0, Math.cos(a) * 0.4 * (k ? 1 : 0.2)], at, layer: 'glow', bright: 0.9 + rnd() * 0.6,
    });
  }
  put(B, pv, displace(GEO.ico(0.42, 0), 0.4, seed), 0x2a3a38, { p: [0, 0.1, 0], s: [1, 0.4, 1], at });
}

function propStatue(B, pv, at, stone) {
  put(B, pv, GEO.box(1.0, 0.5, 1.0), stone, { p: [0, 0.25, 0], at });
  put(B, pv, GEO.lathe([[0.4, 0], [0.42, 0.05], [0.38, 0.1]], 20), stone, { p: [0, 0.5, 0], at });
  put(B, pv, GEO.lathe([[0.38, 0], [0.36, 0.5], [0.27, 1.0], [0.2, 1.35], [0.12, 1.45], [0, 1.47]], 20), stone, { p: [0, 0.6, 0], at, shade: (y) => 0.7 + y * 0.15 });
  put(B, pv, GEO.sphere(0.2, 14, 10), stone, { p: [0, 2.17, 0.03], at });
  put(B, pv, GEO.cone(0.27, 0.38, 14, true), stone, { p: [0, 2.22, -0.02], r: [-0.25, 0, 0], at });
  for (const s of [-1, 1]) {
    const w = new THREE.Shape();
    w.moveTo(0, 0);
    w.quadraticCurveTo(0.5, 0.6, 0.35, 1.3);
    w.quadraticCurveTo(0.25, 0.7, 0.05, 0.5);
    put(B, pv, GEO.extrude(w, 0.06, 0.02), stone, { p: [0.12 * s, 1.35, -0.2], s: [s, 1, 1], r: [0.3, 0, 0], at });
  }
}

function propBrazier(B, pv, at) {
  const bronze = 0x9a6a2a;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
    put(B, pv, GEO.tube([[x * 0.35, 0, z * 0.35], [x * 0.2, 0.45, z * 0.2], [x * 0.3, 0.85, z * 0.3], [x * 0.38, 1.0, z * 0.38]], 0.035, 12, 5), bronze, { at, layer: 'metal' });
  }
  put(B, pv, GEO.lathe([[0.06, 0], [0.32, 0.04], [0.46, 0.24], [0.5, 0.32], [0.46, 0.33]], 20), bronze, { p: [0, 0.96, 0], at, layer: 'metal' });
  put(B, pv, GEO.torus(0.48, 0.03, 6, 24), 0xd8a050, { p: [0, 1.28, 0], r: [Math.PI / 2, 0, 0], at, layer: 'metal' });
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    put(B, pv, displace(GEO.ico(0.09, 0), 0.4, k), 0xff6a1a, { p: [Math.cos(a) * 0.2 * (k % 3) * 0.6, 1.24, Math.sin(a) * 0.2 * (k % 3) * 0.6], at, layer: 'glow', bright: 1.5 });
  }
}

function propUrn(B, pv, at) {
  const band = (y) => (y > 0.33 && y < 0.42) || (y > 0.6 && y < 0.64) ? 0.25 : 1;
  put(B, pv, GEO.lathe([[0, 0], [0.18, 0.01], [0.3, 0.22], [0.32, 0.42], [0.2, 0.62], [0.12, 0.7], [0.15, 0.8], [0.13, 0.82], [0, 0.82]], 18), 0xb0603a, { at, shade: band });
  for (const s of [-1, 1]) put(B, pv, GEO.torus(0.09, 0.022, 5, 10, Math.PI), 0xa0502e, { p: [0.2 * s, 0.62, 0], r: [0, 0, s > 0 ? -1.2 : 1.2 + Math.PI], at });
}

function propFountain(B, pv, at) {
  const stone = 0x9a92a6;
  put(B, pv, GEO.lathe([[0, 0], [1.15, 0], [1.25, 0.12], [1.25, 0.45], [1.12, 0.5], [1.05, 0.25], [0, 0.25]], 32), stone, { at });
  put(B, pv, GEO.lathe([[0.2, 0], [0.16, 0.6], [0.12, 1.0], [0.2, 1.05]], 16), stone, { p: [0, 0.25, 0], at });
  put(B, pv, GEO.lathe([[0, 0], [0.45, 0.02], [0.5, 0.18], [0.44, 0.2], [0, 0.08]], 20), stone, { p: [0, 1.28, 0], at });
  put(B, pv, GEO.sphere(0.1, 10, 8), 0xffe6a0, { p: [0, 1.55, 0], at, layer: 'glow', bright: 2 });
}

function propMerchant(B, pv, at) {
  const robe = 0x3a2050, wood = 0x5a3a22, cloth = 0x6a2440;
  put(B, pv, GEO.lathe([[0, 0], [0.55, 0], [0.42, 0.8], [0.3, 1.5], [0, 1.6]], 16), robe, { p: [0, 0, -0.7], at });
  put(B, pv, GEO.cone(0.36, 0.6, 14, true), robe, { p: [0, 1.75, -0.72], r: [-0.2, 0, 0], at });
  put(B, pv, GEO.sphere(0.24, 12, 10), 0x0a0610, { p: [0, 1.62, -0.66], at, outline: false });
  for (const s of [-1, 1]) put(B, pv, GEO.sphere(0.035, 8, 6), 0xffd166, { p: [0.08 * s, 1.64, -0.45], at, layer: 'glow', bright: 3 });
  put(B, pv, GEO.box(2.1, 0.1, 0.9), wood, { p: [0, 0.85, 0.2], at });
  put(B, pv, GEO.box(2.2, 0.02, 0.6), cloth, { p: [0, 0.91, 0.2], at, outline: false });
  for (const x of [-0.9, 0.9]) put(B, pv, GEO.box(0.12, 0.8, 0.12), wood, { p: [x, 0.4, 0.2], at });
  const goods = [[-0.6, 0x7cd8ff], [-0.2, 0xff5d6c], [0.25, 0xff9b3a], [0.6, 0xc9a8ff]];
  for (const [x, col] of goods) {
    put(B, pv, GEO.lathe([[0, 0], [0.08, 0.01], [0.09, 0.1], [0.04, 0.16], [0.04, 0.22], [0, 0.22]], 10), col, { p: [x, 0.92, 0.25], at, layer: 'glow', bright: 1.3 });
  }
}

function propCandles(B, pv, at, seed) {
  const rnd = mulberry32(seed);
  for (let k = 0; k < 6; k++) {
    const x = (rnd() - 0.5) * 0.7, z = (rnd() - 0.5) * 0.5, h = 0.15 + rnd() * 0.35;
    put(B, pv, GEO.cyl(0.04, 0.045, h, 8), 0xe8dcc0, { p: [x, h / 2, z], at, outline: false });
    put(B, pv, GEO.sphere(0.03, 6, 5), 0xffc060, { p: [x, h + 0.04, z], s: [0.7, 1.4, 0.7], at, layer: 'glow', bright: 3 });
  }
}

function propBones(B, pv, at, seed) {
  const rnd = mulberry32(seed), bone = 0xd8ccb0;
  put(B, pv, GEO.sphere(0.13, 10, 8), bone, { p: [0, 0.12, 0], at });
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI;
    put(B, pv, GEO.cyl(0.025, 0.025, 0.4 + rnd() * 0.2, 5), bone, { p: [(rnd() - 0.5) * 0.7, 0.04, (rnd() - 0.5) * 0.6], r: [Math.PI / 2, a, 0], at, outline: false });
  }
}

function propMushrooms(B, pv, at, color, seed) {
  const rnd = mulberry32(seed);
  for (let k = 0; k < 5; k++) {
    const x = (rnd() - 0.5) * 0.8, z = (rnd() - 0.5) * 0.6, h = 0.12 + rnd() * 0.3;
    put(B, pv, GEO.cyl(0.025, 0.035, h, 6), 0xd8e0d0, { p: [x, h / 2, z], at, outline: false });
    put(B, pv, GEO.dome(0.06 + h * 0.3, 10, 5), color, { p: [x, h, z], s: [1, 0.6, 1], at, layer: 'glow', bright: 1.2 });
  }
}

function propAnvil(B, pv, at) {
  const iron = 0x3a3a40;
  put(B, pv, GEO.box(0.5, 0.5, 0.4), 0x4a3022, { p: [0, 0.25, 0], at });
  put(B, pv, GEO.box(0.3, 0.2, 0.25), iron, { p: [0, 0.6, 0], at, layer: 'metal' });
  put(B, pv, GEO.box(0.8, 0.18, 0.3), iron, { p: [0.05, 0.78, 0], at, layer: 'metal' });
  put(B, pv, GEO.cone(0.12, 0.35, 8), iron, { p: [0.6, 0.78, 0], r: [0, 0, -Math.PI / 2], at, layer: 'metal' });
}

function propDoor(B, pv, at, stone, trim) {
  for (const s of [-1, 1]) {
    put(B, pv, GEO.box(0.6, 3.2, 0.9), stone, { p: [1.25 * s, 1.6, 0], at, shade: (y) => 0.65 + y * 0.12 });
    put(B, pv, GEO.box(0.75, 0.25, 1.0), stone, { p: [1.25 * s, 0.12, 0], at });
    put(B, pv, GEO.box(0.72, 0.18, 0.98), stone, { p: [1.25 * s, 3.25, 0], at });
  }
  put(B, pv, GEO.torus(1.25, 0.3, 8, 24, Math.PI), stone, { p: [0, 3.25, 0], at });
  put(B, pv, GEO.box(0.36, 0.5, 0.95), trim, { p: [0, 4.5, 0.02], at, layer: 'metal' });
  put(B, pv, GEO.torus(1.0, 0.04, 6, 24, Math.PI), trim, { p: [0, 3.25, 0.32], at, layer: 'metal' });
  put(B, pv, GEO.box(2.6, 0.18, 1.2), stone, { p: [0, 0.09, 0.55], at });
}

// The far wall: masonry runs between the doors, with engaged columns and a cornice.
function propWallColumn(B, pv, at, stone) {
  put(B, pv, fluted(0.3, 4.6, 12), stone, { p: [0, 2.3, 0], at, shade: (y) => 0.6 + y * 0.1 });
  put(B, pv, GEO.box(0.8, 0.3, 0.8), stone, { p: [0, 4.75, 0], at });
  put(B, pv, GEO.box(0.8, 0.3, 0.8), stone, { p: [0, 0.15, 0], at });
}
