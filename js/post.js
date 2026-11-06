'use strict';

// Post-processing: the scene renders into an HDR target, bright parts are blurred into a bloom,
// then one pass composites bloom, colour grading, vignette, hit feedback and a touch of grain.
const Post = {
  ok: false, enabled: true, renderer: null,
  scene: null, bright: null, blurA: null, blurB: null,
  quad: null, ortho: null, mats: null, w: 0, h: 0,
  params: { bloom: 0.9, threshold: 0.78, vignette: 0.42, hurt: 0, flash: 0, tint: null },
};

const QUAD_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function initPost(renderer) {
  const caps = renderer.capabilities;
  const half = caps.isWebGL2 || !!renderer.extensions.get('EXT_color_buffer_half_float');
  const type = half ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const opts = { type, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false };
  Post.renderer = renderer;
  Post.multisample = caps.isWebGL2 && typeof THREE.WebGLMultisampleRenderTarget !== 'undefined';
  const sceneOpts = { type, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: true };
  Post.scene = Post.multisample ? new THREE.WebGLMultisampleRenderTarget(4, 4, sceneOpts) : new THREE.WebGLRenderTarget(4, 4, sceneOpts);
  Post.bright = new THREE.WebGLRenderTarget(4, 4, opts);
  Post.blurA = new THREE.WebGLRenderTarget(4, 4, opts);
  Post.blurB = new THREE.WebGLRenderTarget(4, 4, opts);
  for (const t of [Post.bright, Post.blurA, Post.blurB]) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;

  const pass = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
  Post.mats = {
    threshold: pass(`
      uniform sampler2D tDiffuse; uniform float threshold; uniform vec2 texel; varying vec2 vUv;
      void main() {
        // 4-tap downsample keeps small sparks from flickering
        vec3 c = texture2D(tDiffuse, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, -1.0)).rgb
               + texture2D(tDiffuse, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(tDiffuse, vUv + texel * vec2(1.0, 1.0)).rgb;
        c *= 0.25;
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.35, l), 1.0);
      }`, { tDiffuse: { value: null }, threshold: { value: 0.8 }, texel: { value: new THREE.Vector2() } }),
    blur: pass(`
      uniform sampler2D tDiffuse; uniform vec2 dir; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
        c += texture2D(tDiffuse, vUv + dir * 1.384615).rgb * 0.316216;
        c += texture2D(tDiffuse, vUv - dir * 1.384615).rgb * 0.316216;
        c += texture2D(tDiffuse, vUv + dir * 3.230769).rgb * 0.070270;
        c += texture2D(tDiffuse, vUv - dir * 3.230769).rgb * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }),
    composite: pass(`
      uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBloom2;
      uniform float bloom; uniform float vignette; uniform float hurt; uniform float flash; uniform float time;
      uniform vec3 tint; uniform vec2 aspect; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      vec3 shoulder(vec3 c) {
        // leave the midtones alone, roll highlights off softly instead of clipping them
        vec3 a = vec3(0.72);
        vec3 over = max(c - a, 0.0);
        return min(c, a) + (1.0 - a) * (1.0 - exp(-over / (1.0 - a)));
      }
      void main() {
        vec2 uv = vUv;
        vec3 c;
        if (hurt > 0.01) {
          vec2 off = (uv - 0.5) * 0.012 * hurt;
          c = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
        } else {
          c = texture2D(tScene, uv).rgb;
        }
        c += (texture2D(tBloom, uv).rgb * 0.6 + texture2D(tBloom2, uv).rgb * 0.8) * bloom;
        c = shoulder(c);
        // grade: a little contrast and saturation, cool shadows, warm highlights
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.15);
        c = (c - 0.5) * 1.06 + 0.5;
        c *= mix(vec3(0.9, 0.94, 1.08), vec3(1.05, 1.0, 0.94), smoothstep(0.1, 0.7, l));
        c *= tint;
        vec2 q = (uv - 0.5) * aspect;
        float v = smoothstep(0.95, 0.3, length(q));
        c *= mix(1.0 - vignette, 1.0, v);
        c = mix(c, vec3(0.55, 0.02, 0.05), hurt * (1.0 - v) * 0.75);
        c += flash;
        c += (hash(uv * 731.0 + time) - 0.5) * 0.018;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, {
      tScene: { value: null }, tBloom: { value: null }, tBloom2: { value: null }, bloom: { value: 1 }, vignette: { value: 0.4 },
      hurt: { value: 0 }, flash: { value: 0 }, time: { value: 0 }, tint: { value: new THREE.Color(1, 1, 1) }, aspect: { value: new THREE.Vector2(1, 1) },
    }),
  };
  Post.ortho = new THREE.Camera();
  Post.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), Post.mats.composite);
  Post.quad.frustumCulled = false;
  Post.quadScene = new THREE.Scene();
  Post.quadScene.add(Post.quad);
  Post.ok = true;
  return true;
}

function resizePost(w, h) {
  if (!Post.ok || (w === Post.w && h === Post.h)) return;
  Post.w = w;
  Post.h = h;
  Post.scene.setSize(w, h);
  const bw = Math.max(1, Math.round(w / 4)), bh = Math.max(1, Math.round(h / 4));
  Post.bright.setSize(bw, bh);
  Post.blurA.setSize(bw, bh);
  Post.blurB.setSize(Math.max(1, Math.round(bw / 2)), Math.max(1, Math.round(bh / 2)));
  const a = w / h;
  Post.mats.composite.uniforms.aspect.value.set(a > 1 ? a : 1, a > 1 ? 1 : 1 / a);
}

function postPass(mat, target) {
  Post.quad.material = mat;
  Post.renderer.setRenderTarget(target);
  Post.renderer.render(Post.quadScene, Post.ortho);
}

function renderWithPost(scene, camera, time) {
  const r = Post.renderer, m = Post.mats, p = Post.params;
  const size = r.getDrawingBufferSize(new THREE.Vector2());
  resizePost(size.x, size.y);
  r.setRenderTarget(Post.scene);
  r.render(scene, camera);
  // bright pass at quarter resolution, then two blur widths for a soft wide halo
  m.threshold.uniforms.tDiffuse.value = Post.scene.texture;
  m.threshold.uniforms.threshold.value = p.threshold;
  m.threshold.uniforms.texel.value.set(1 / size.x, 1 / size.y);
  postPass(m.threshold, Post.bright);
  const bw = Post.bright.width, bh = Post.bright.height;
  m.blur.uniforms.tDiffuse.value = Post.bright.texture;
  m.blur.uniforms.dir.value.set(1 / bw, 0);
  postPass(m.blur, Post.blurA);
  m.blur.uniforms.tDiffuse.value = Post.blurA.texture;
  m.blur.uniforms.dir.value.set(0, 1 / bh);
  postPass(m.blur, Post.bright);
  m.blur.uniforms.tDiffuse.value = Post.bright.texture;
  m.blur.uniforms.dir.value.set(2 / bw, 0);
  postPass(m.blur, Post.blurB);
  m.blur.uniforms.tDiffuse.value = Post.blurB.texture;
  m.blur.uniforms.dir.value.set(0, 2 / Post.blurB.height);
  postPass(m.blur, Post.blurA);
  const c = m.composite.uniforms;
  c.tScene.value = Post.scene.texture;
  c.tBloom.value = Post.bright.texture;
  c.tBloom2.value = Post.blurA.texture;
  c.bloom.value = p.bloom;
  c.vignette.value = p.vignette;
  c.hurt.value = p.hurt;
  c.flash.value = p.flash;
  c.time.value = time % 100;
  if (p.tint) c.tint.value.copy(p.tint);
  postPass(m.composite, null);
}
