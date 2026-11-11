import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ================= 主题与状态 ================= */

const THEMES = {
  nebula: {
    label: '星云紫', bg: 0x050514,
    in: 0x9d7bff, out: 0x00e5ff, coreA: 0x8b7cff, coreB: 0x00e5ff,
    ring: 0xff2e88, sat: 0xffb300, nebula: [0x4a2f9e, 0x0e4d6e, 0x6e1046],
  },
  aurora: {
    label: '极光青', bg: 0x02120e,
    in: 0x00d98a, out: 0x00b3ff, coreA: 0x00e598, coreB: 0x7cf7ff,
    ring: 0xbaff2e, sat: 0x00e5ff, nebula: [0x0a5e42, 0x0e4d6e, 0x2e6e0a],
  },
  ember: {
    label: '熔金橙', bg: 0x140505,
    in: 0xff6a00, out: 0xffd000, coreA: 0xff8a3d, coreB: 0xffd000,
    ring: 0xff2e5f, sat: 0xffe08a, nebula: [0x6e2a0a, 0x6e560a, 0x6e0a2a],
  },
  abyss: {
    label: '深空蓝', bg: 0x020a14,
    in: 0x00c8ff, out: 0x4d7bff, coreA: 0x37d6ff, coreB: 0x9d7bff,
    ring: 0x9d00ff, sat: 0x00ffc8, nebula: [0x0a3a6e, 0x2a1a6e, 0x0a5e5e],
  },
};

const DEFAULTS = {
  particles: 16000, radius: 8, stars: 2600,
  speed: 1, distort: 0.35, bloom: 0.75,
  theme: 'nebula', wire: false, orbit: true,
};
const state = { ...DEFAULTS };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reducedMotion) state.orbit = false;

const $ = (id) => document.getElementById(id);
const bootFill = $('bootFill');
const bootStatus = $('bootStatus');
function setBoot(p, text) {
  bootFill.style.width = p + '%';
  if (text) bootStatus.textContent = text;
}
function showFallback() {
  clearTimeout(window.__bootTimer);
  $('boot').style.display = 'none';
  $('fallback').hidden = false;
}

/* ================= 音效引擎 ================= */

const Sound = {
  ctx: null, master: null, ambient: null, enabled: true, ready: false,
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.ctx.destination);

    const amb = this.ctx.createGain();
    amb.gain.value = 0.055;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 320; filter.Q.value = 0.8;
    amb.connect(filter); filter.connect(this.master);
    [55, 82.41, 110].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sine';
      o.frequency.value = f; o.detune.value = i * 4 - 4;
      const g = this.ctx.createGain(); g.gain.value = i === 2 ? 0.25 : 0.6;
      o.connect(g); g.connect(amb); o.start();
    });
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 140;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
    this.ambient = amb;

    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.ready = true;
    } catch {
      this.ctx = null;
      this.ready = false;
    }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.linearRampToValueAtTime(v ? 0.5 : 0, this.ctx.currentTime + 0.25);
  },
  blip(freq = 880) {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.12);
  },
  whoosh() {
    if (!this.ready || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(1600, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);
    const sub = this.ctx.createOscillator(); const sg = this.ctx.createGain();
    sub.type = 'sine'; sub.frequency.setValueAtTime(72, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    sg.gain.setValueAtTime(0.14, t);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    sub.connect(sg); sg.connect(this.master); sub.start(t); sub.stop(t + 0.7);
  },
};
let firstGesture = false;
window.addEventListener('pointerdown', () => {
  if (!firstGesture) { firstGesture = true; Sound.init(); }
  Sound.resume();
}, { passive: true });

/* ================= 渲染器与场景 ================= */

let renderer, scene, camera, controls, composer, bloomPass;
let galaxy, galaxyMat, starGroups = [], dust, nebulaSprites = [];
let coreGroup, innerCore, shell, cage, coreLight, rimLight, keyLight;
let ringGroups = [], arcMeshes = [], satMeshes = [];
let shockwaves = [];
let spriteTex;
let elapsed = 0, pulse = 0, bloomBoost = 0;
let shotFlag = false;
const clock = new THREE.Clock();

function makeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const shellUniforms = {
  uTime: { value: 0 },
  uDistort: { value: state.distort },
  uPulse: { value: 0 },
  uColorA: { value: new THREE.Color(THEMES.nebula.coreA) },
  uColorB: { value: new THREE.Color(THEMES.nebula.coreB) },
};

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  $('scene').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(THEMES.nebula.bg);
  scene.fog = new THREE.FogExp2(THEMES.nebula.bg, 0.011);

  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 260);
  camera.position.set(0, 3.1, 8.8);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 3.4;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.minPolarAngle = Math.PI * 0.06;
  controls.autoRotate = state.orbit;
  controls.autoRotateSpeed = 0.55;
  controls.saveState();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), state.bloom, 0.45, 0.5);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  spriteTex = makeSpriteTexture();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  if (room.dispose) room.dispose();
}

/* ================= 星系粒子 ================= */

function buildGalaxy() {
  const t = THEMES[state.theme];
  const count = state.particles;
  const R = state.radius;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const cIn = new THREE.Color(t.in);
  const cOut = new THREE.Color(t.out);
  const tmp = new THREE.Color();
  const branches = 3, spin = 1.15;

  for (let i = 0; i < count; i++) {
    const r = Math.pow(Math.random(), 1.9) * R;
    const branch = (i % branches) * ((Math.PI * 2) / branches);
    const angle = branch + r * spin * 0.55;
    const spread = Math.pow(Math.random(), 2.6) * 0.34 * (r * 0.5 + 0.6);
    const rx = (Math.random() < 0.5 ? 1 : -1) * spread * Math.random();
    const ry = (Math.random() < 0.5 ? 1 : -1) * spread * Math.random() * 0.55;
    const rz = (Math.random() < 0.5 ? 1 : -1) * spread * Math.random();
    let x = Math.cos(angle) * r + rx;
    let z = Math.sin(angle) * r + rz;
    let y = ry;
    if (r < R * 0.16) {
      const bulge = (R * 0.16 - r) * 0.45;
      x += (Math.random() - 0.5) * bulge;
      y += (Math.random() - 0.5) * bulge * 1.4;
      z += (Math.random() - 0.5) * bulge;
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    tmp.copy(cIn).lerp(cOut, Math.min(r / R, 1));
    const jitter = 0.9 + Math.random() * 0.2;
    colors[i * 3] = tmp.r * jitter; colors[i * 3 + 1] = tmp.g * jitter; colors[i * 3 + 2] = tmp.b * jitter;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const norm = Math.pow(16000 / count, 0.4);
  if (!galaxyMat) {
    galaxyMat = new THREE.PointsMaterial({
      size: 0.048 * Math.pow(16000 / count, 0.15), sizeAttenuation: true, map: spriteTex,
      vertexColors: true, transparent: true, opacity: 0.85 * Math.min(norm, 1.15),
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }
  galaxyMat.opacity = 0.85 * Math.min(norm, 1.15);
  galaxyMat.size = 0.048 * Math.pow(16000 / count, 0.15);
  if (galaxy) {
    galaxy.geometry.dispose();
    galaxy.geometry = geo;
  } else {
    galaxy = new THREE.Points(geo, galaxyMat);
    scene.add(galaxy);
  }
  $('statCount').textContent = count.toLocaleString('en-US');
}

function buildStars() {
  starGroups.forEach((g) => { g.geometry.dispose(); g.material.dispose(); scene.remove(g); });
  starGroups = [];
  const t = THEMES[state.theme];
  const layers = [
    { n: Math.round(state.stars * 0.6), size: 0.34, rMin: 42, rMax: 90, op: 0.85 },
    { n: Math.round(state.stars * 0.4), size: 0.55, rMin: 60, rMax: 120, op: 0.55 },
  ];
  const tint = new THREE.Color(t.out);
  layers.forEach((L) => {
    const pos = new Float32Array(L.n * 3);
    const col = new Float32Array(L.n * 3);
    const white = new THREE.Color(0xdfe6ff);
    const tmp = new THREE.Color();
    for (let i = 0; i < L.n; i++) {
      const rr = L.rMin + Math.random() * (L.rMax - L.rMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = rr * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = rr * Math.cos(phi);
      pos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta);
      tmp.copy(white).lerp(tint, Math.random() * 0.55);
      const b = 0.5 + Math.random() * 0.5;
      col[i * 3] = tmp.r * b; col[i * 3 + 1] = tmp.g * b; col[i * 3 + 2] = tmp.b * b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: L.size, sizeAttenuation: true, map: spriteTex, vertexColors: true,
      transparent: true, opacity: L.op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    starGroups.push(pts);
  });
}

function buildDust() {
  const n = 320;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 26;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 26;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.035, map: spriteTex, color: 0xaab4ff, transparent: true, opacity: 0.4,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

function buildNebula() {
  nebulaSprites.forEach((s) => { scene.remove(s); s.material.dispose(); });
  nebulaSprites = [];
  const t = THEMES[state.theme];
  const spots = [
    [-16, 6, -30, 46, 0], [18, -4, -36, 52, 1], [2, 12, -42, 60, 2],
    [-8, -10, -26, 38, 1], [12, 9, -32, 40, 0],
  ];
  spots.forEach(([x, y, z, s, ci]) => {
    const mat = new THREE.SpriteMaterial({
      map: spriteTex, color: t.nebula[ci], transparent: true, opacity: 0.1,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(x, y, z); sp.scale.setScalar(s);
    scene.add(sp);
    nebulaSprites.push(sp);
  });
}

/* ================= 能量核心 ================= */

function buildCore() {
  const t = THEMES[state.theme];
  coreGroup = new THREE.Group();
  scene.add(coreGroup);

  innerCore = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.88, 1),
    new THREE.MeshStandardMaterial({
      color: t.coreA, metalness: 0.85, roughness: 0.28, envMapIntensity: 0.45,
      emissive: t.coreA, emissiveIntensity: 0.22, flatShading: true,
    })
  );
  coreGroup.add(innerCore);

  shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.32, 5),
    new THREE.ShaderMaterial({
      uniforms: shellUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      vertexShader: NOISE_GLSL + `
        uniform float uTime; uniform float uDistort; uniform float uPulse;
        varying vec3 vNormal; varying vec3 vView; varying float vNoise;
        void main(){
          float n = snoise(normal * 1.9 + vec3(uTime * 0.42, uTime * 0.31, uTime * 0.24));
          float n2 = snoise(normal * 4.5 - vec3(uTime * 0.6));
          float disp = n * (uDistort * 0.5) + n2 * (uDistort * 0.16) + uPulse * 0.22;
          vec3 p = position + normal * disp;
          vNoise = n;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColorA; uniform vec3 uColorB; uniform float uPulse; uniform float uTime; uniform float uDistort;
        varying vec3 vNormal; varying vec3 vView; varying float vNoise;
        void main(){
          float fres = pow(1.0 - abs(dot(normalize(vView), normalize(vNormal))), 2.1);
          float mixv = clamp(vNoise * 0.5 + 0.5 + sin(uTime * 0.7) * 0.12, 0.0, 1.0);
          vec3 col = mix(uColorA, uColorB, mixv);
          col += uPulse * 0.6;
          float a = fres * 0.55 + 0.04 + uPulse * 0.25;
          gl_FragColor = vec4(col * (0.28 + fres * 0.95) * (1.0 - uDistort * 0.3), a);
        }`,
    })
  );
  coreGroup.add(shell);

  cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.78, 1),
    new THREE.MeshBasicMaterial({ color: t.coreB, wireframe: true, transparent: true, opacity: 0.16 })
  );
  coreGroup.add(cage);

  coreLight = new THREE.PointLight(t.coreA, 16, 40, 2);
  coreGroup.add(coreLight);
  rimLight = new THREE.DirectionalLight(t.coreB, 2.2);
  rimLight.position.set(-6, 3, -8);
  scene.add(rimLight);
  keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(5, 7, 4);
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight(0x334, 0.5));
}

function buildRings() {
  const t = THEMES[state.theme];
  const defs = [
    { r: 2.35, tube: 0.014, tilt: [1.28, 0, 0.2], op: 0.5, sats: 9, speed: 0.42 },
    { r: 2.95, tube: 0.01, tilt: [1.75, 0.5, -0.3], op: 0.36, sats: 8, speed: -0.3 },
    { r: 3.6, tube: 0.012, tilt: [1.05, -0.4, 0.65], op: 0.28, sats: 7, speed: 0.22 },
  ];
  defs.forEach((d) => {
    const grp = new THREE.Group();
    grp.rotation.set(d.tilt[0], d.tilt[1], d.tilt[2]);
    grp.userData = { speed: d.speed, r: d.r };
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(d.r, d.tube, 8, 220),
      new THREE.MeshBasicMaterial({ color: t.ring, transparent: true, opacity: d.op, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    grp.add(ring);
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(d.r, d.tube * 2.2, 8, 60, 1.15),
      new THREE.MeshBasicMaterial({ color: t.sat, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    grp.add(arc);
    arcMeshes.push(arc);

    const satGeo = new THREE.OctahedronGeometry(0.055);
    const satMat = new THREE.MeshBasicMaterial({ color: t.sat, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const inst = new THREE.InstancedMesh(satGeo, satMat, d.sats);
    inst.userData = { r: d.r, n: d.sats, speed: d.speed * 1.6 };
    grp.add(inst);
    satMeshes.push(inst);

    scene.add(grp);
    ringGroups.push(grp);
  });
}

function buildShockwaves() {
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1.04, 128),
      new THREE.MeshBasicMaterial({ color: THEMES[state.theme].ring, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.userData = { life: 0 };
    scene.add(m);
    shockwaves.push(m);
  }
}

function triggerPulse() {
  pulse = 1;
  bloomBoost = 0.4;
  const w = shockwaves.find((s) => !s.visible) || shockwaves[0];
  w.visible = true;
  w.userData.life = 0;
  w.scale.setScalar(1.5);
  w.material.opacity = 0.85;
  w.material.color.set(THEMES[state.theme].ring);
  Sound.whoosh();
}

/* ================= 主题应用 ================= */

function applyTheme(name, announce = true) {
  state.theme = name;
  const t = THEMES[name];
  document.body.dataset.theme = name;
  scene.background.set(t.bg);
  scene.fog.color.set(t.bg);
  shellUniforms.uColorA.value.set(t.coreA);
  shellUniforms.uColorB.value.set(t.coreB);
  innerCore.material.color.set(t.coreA);
  innerCore.material.emissive.set(t.coreA);
  cage.material.color.set(t.coreB);
  coreLight.color.set(t.coreA);
  rimLight.color.set(t.coreB);
  ringGroups.forEach((g) => { g.children[0].material.color.set(t.ring); });
  arcMeshes.forEach((a) => a.material.color.set(t.sat));
  satMeshes.forEach((s) => s.material.color.set(t.sat));
  buildGalaxy();
  buildStars();
  buildNebula();
  if (announce) { toast(`主题 · ${t.label}`); scrambleTitle(420); }
}

function applyWire(v) {
  state.wire = v;
  innerCore.material.wireframe = v;
  shell.material.wireframe = v;
  cage.material.opacity = v ? 0.4 : 0.16;
}

/* ================= UI 绑定 ================= */

const toastEl = $('toast');
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

function fillRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', pct + '%');
}

let galaxyTimer, starsTimer, lastBlip = 0;
function blipThrottled(f) {
  const now = performance.now();
  if (now - lastBlip > 90) { lastBlip = now; Sound.blip(f); }
}

function bindRange(id, outId, key, fmt, onChange) {
  const input = $(id), out = $(outId);
  fillRange(input);
  input.addEventListener('input', () => {
    state[key] = parseFloat(input.value);
    out.textContent = fmt(state[key]);
    fillRange(input);
    blipThrottled(660 + state[key] * 40);
    onChange();
  });
}

function syncUI() {
  $('ctlParticles').value = state.particles; $('outParticles').textContent = state.particles.toLocaleString('en-US');
  $('ctlRadius').value = state.radius; $('outRadius').textContent = state.radius.toFixed(1);
  $('ctlStars').value = state.stars; $('outStars').textContent = state.stars.toLocaleString('en-US');
  $('ctlSpeed').value = state.speed; $('outSpeed').textContent = state.speed.toFixed(2) + '×';
  $('ctlDistort').value = state.distort; $('outDistort').textContent = state.distort.toFixed(2);
  $('ctlBloom').value = state.bloom; $('outBloom').textContent = state.bloom.toFixed(2);
  $('ctlTheme').value = state.theme;
  $('ctlWire').checked = state.wire;
  $('ctlOrbit').checked = state.orbit;
  document.querySelectorAll('input[type="range"]').forEach(fillRange);
}

function applyAll() {
  bloomPass.strength = state.bloom;
  shellUniforms.uDistort.value = state.distort;
  controls.autoRotate = state.orbit;
  applyWire(state.wire);
  applyTheme(state.theme, false);
}

function bindUI() {
  bindRange('ctlParticles', 'outParticles', 'particles', (v) => v.toLocaleString('en-US'), () => {
    clearTimeout(galaxyTimer); galaxyTimer = setTimeout(buildGalaxy, 70);
  });
  bindRange('ctlRadius', 'outRadius', 'radius', (v) => v.toFixed(1), () => {
    clearTimeout(galaxyTimer); galaxyTimer = setTimeout(buildGalaxy, 70);
  });
  bindRange('ctlStars', 'outStars', 'stars', (v) => v.toLocaleString('en-US'), () => {
    clearTimeout(starsTimer); starsTimer = setTimeout(buildStars, 90);
  });
  bindRange('ctlSpeed', 'outSpeed', 'speed', (v) => v.toFixed(2) + '×', () => {});
  bindRange('ctlDistort', 'outDistort', 'distort', (v) => v.toFixed(2), () => {
    shellUniforms.uDistort.value = state.distort;
  });
  bindRange('ctlBloom', 'outBloom', 'bloom', (v) => v.toFixed(2), () => {
    bloomPass.strength = state.bloom;
  });

  $('ctlTheme').addEventListener('change', (e) => { Sound.blip(980); applyTheme(e.target.value); });
  $('ctlWire').addEventListener('change', (e) => { Sound.blip(740); applyWire(e.target.checked); toast(e.target.checked ? '线框模式 开' : '线框模式 关'); });
  $('ctlOrbit').addEventListener('change', (e) => { Sound.blip(740); state.orbit = e.target.checked; controls.autoRotate = state.orbit; toast(state.orbit ? '自动巡航 开' : '自动巡航 关'); });

  $('btnReset').addEventListener('click', () => {
    Object.assign(state, DEFAULTS);
    if (reducedMotion) state.orbit = false;
    syncUI(); applyAll(); controls.reset();
    Sound.blip(520); toast('已恢复默认星域');
  });
  $('btnRandom').addEventListener('click', randomize);
  $('btnShot').addEventListener('click', () => { shotFlag = true; Sound.blip(1240); });
  $('btnPulse').addEventListener('click', () => triggerPulse());

  $('btnSound').addEventListener('click', () => {
    Sound.init(); Sound.resume();
    Sound.setEnabled(!Sound.enabled);
    const btn = $('btnSound');
    btn.setAttribute('aria-pressed', String(Sound.enabled));
    $('soundLabel').textContent = Sound.enabled ? '音效 开' : '音效 关';
    if (Sound.enabled) Sound.blip(880);
    toast(Sound.enabled ? '音效已开启' : '音效已静音');
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'r') $('btnReset').click();
    else if (k === 'f') randomize();
    else if (k === 's') $('btnShot').click();
    else if (k === 'm') $('btnSound').click();
    else if (k === ' ') { e.preventDefault(); $('ctlOrbit').checked = !$('ctlOrbit').checked; $('ctlOrbit').dispatchEvent(new Event('change')); }
  });
}

function randomize() {
  const keys = Object.keys(THEMES);
  state.theme = keys[Math.floor(Math.random() * keys.length)];
  state.particles = 4000 + Math.round(Math.random() * 24) * 1000;
  state.radius = 5 + Math.round(Math.random() * 16) * 0.5;
  state.speed = +(0.3 + Math.random() * 2.2).toFixed(2);
  state.distort = +Math.random().toFixed(2);
  state.bloom = +(0.5 + Math.random() * 1.7).toFixed(2);
  state.stars = 800 + Math.round(Math.random() * 24) * 200;
  syncUI(); applyAll();
  triggerPulse();
  toast('随机星域已生成');
}

/* ================= 标题乱码动画 ================= */

const scrambleEl = $('scramble');
const TARGET = 'RANGANG';
const GLYPHS = 'RANGANG#01<>/\\*+=ΔΣΩ';
let scrambleRaf = null;
function scrambleTitle(duration = 1200) {
  if (reducedMotion) { scrambleEl.textContent = TARGET; return; }
  cancelAnimationFrame(scrambleRaf);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const solved = Math.floor(p * TARGET.length);
    let out = '';
    for (let i = 0; i < TARGET.length; i++) {
      out += i < solved ? TARGET[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    scrambleEl.textContent = out;
    if (p < 1) scrambleRaf = requestAnimationFrame(step);
    else scrambleEl.textContent = TARGET;
  };
  scrambleRaf = requestAnimationFrame(step);
}

/* ================= 跑马灯 ================= */

function buildTicker() {
  const items = ['VUE', 'REACT', 'TYPESCRIPT', 'THREE.JS', 'WEBGL', 'SPRING BOOT', 'FLUTTER', 'ELECTRON', 'PYTHON', 'AI APPLICATIONS', 'NODE.JS', 'MYSQL', 'REDIS', 'TAILWIND'];
  const half = items.map((s) => `<span><b>◆</b>&nbsp;&nbsp;${s}</span>`).join('');
  $('tickerTrack').innerHTML = half + half;
}

/* ================= 点击脉冲 ================= */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null, downTime = 0;
function bindPointer() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; downTime = performance.now(); });
  el.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const dx = e.clientX - downPos[0], dy = e.clientY - downPos[1];
    const isClick = Math.hypot(dx, dy) < 6 && performance.now() - downTime < 450;
    downPos = null;
    if (!isClick) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([innerCore, shell, cage], false);
    if (hit.length) triggerPulse();
  });
}

/* ================= 快照 ================= */

function capture() {
  try {
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `rangang-starfield-${Date.now()}.png`;
    a.click();
    toast('快照已导出 PNG');
  } catch {
    toast('快照导出失败');
  }
}

/* ================= 主循环 ================= */

const dummy = new THREE.Object3D();
let frames = 0, fpsTime = 0;

function tick() {
  requestAnimationFrame(tick);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  if (document.hidden) return;

  elapsed += dt * state.speed;
  pulse *= Math.pow(0.06, dt);
  bloomBoost *= Math.pow(0.02, dt);
  bloomPass.strength = state.bloom + bloomBoost;

  shellUniforms.uTime.value = elapsed;
  shellUniforms.uPulse.value = pulse;
  coreLight.intensity = 16 + pulse * 50;

  if (galaxy) galaxy.rotation.y = elapsed * 0.052;
  if (dust) { dust.rotation.y = elapsed * 0.012; dust.position.y = Math.sin(elapsed * 0.18) * 0.4; }
  starGroups.forEach((g, i) => { g.rotation.y = elapsed * (i ? -0.004 : 0.006); });
  nebulaSprites.forEach((s, i) => { s.material.opacity = 0.085 + Math.sin(elapsed * 0.2 + i * 1.7) * 0.035; });

  coreGroup.rotation.y = elapsed * 0.16;
  innerCore.rotation.x = elapsed * 0.21;
  innerCore.rotation.z = elapsed * 0.13;
  cage.rotation.y = -elapsed * 0.1;
  cage.rotation.x = elapsed * 0.07;
  const coreScale = 1 + pulse * 0.14;
  coreGroup.scale.setScalar(coreScale);

  arcMeshes.forEach((a, i) => { a.rotation.z = elapsed * ringGroups[i].userData.speed * 2.2; });
  satMeshes.forEach((inst) => {
    const { r, n, speed } = inst.userData;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + elapsed * speed;
      dummy.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0);
      dummy.rotation.set(elapsed * 1.4 + i, elapsed * 0.9, 0);
      dummy.scale.setScalar(0.8 + Math.sin(elapsed * 2 + i * 2.1) * 0.3);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  });

  shockwaves.forEach((w) => {
    if (!w.visible) return;
    w.userData.life += dt;
    const p = w.userData.life / 1.15;
    if (p >= 1) { w.visible = false; w.material.opacity = 0; return; }
    w.scale.setScalar(1.5 + p * 8.5);
    w.material.opacity = 0.85 * (1 - p) * (1 - p);
  });

  controls.update();
  composer.render();

  if (shotFlag) { shotFlag = false; capture(); }

  frames++; fpsTime += rawDt;
  if (fpsTime >= 0.5) {
    $('statFps').textContent = Math.round(frames / fpsTime);
    $('statAz').textContent = ((THREE.MathUtils.radToDeg(controls.getAzimuthalAngle()) + 360) % 360).toFixed(0) + '°';
    frames = 0; fpsTime = 0;
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}

/* ================= 启动 ================= */

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  try {
    setBoot(12, '初始化渲染器…');
    await nextFrame();
    initRenderer();

    setBoot(34, '点燃能量核心…');
    await nextFrame();
    buildCore();
    buildRings();
    buildShockwaves();

    setBoot(58, '展开粒子星旋…');
    await nextFrame();
    buildGalaxy();

    setBoot(76, '铺设远景星尘…');
    await nextFrame();
    buildStars();
    buildDust();
    buildNebula();

    setBoot(90, '校准控制台…');
    await nextFrame();
    bindUI();
    bindPointer();
    buildTicker();
    syncUI();
    window.addEventListener('resize', onResize);

    setBoot(100, '星域就绪');
    composer.render();
    window.__APP_READY = true;
    clearTimeout(window.__bootTimer);

    await nextFrame();
    $('boot').classList.add('done');
    document.body.classList.add('ready');
    scrambleTitle(1300);
    tick();
    setTimeout(() => toast('欢迎来到代码星域 · 拖动探索'), 1600);
  } catch (err) {
    console.error('[RANGANG.SPACE] 启动失败:', err);
    showFallback();
  }
}

boot();