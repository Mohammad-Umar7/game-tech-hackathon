// Three.js renderer: bloom + chromatic aberration post, neon ships, instanced bullets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { W, H } from './config.js';
import { FX, Grid, GLOW_TEX } from './fx3d.js';

export const toX = x => x - W / 2, toZ = y => y - H / 2;
export const hdr = (r, g, b) => new THREE.Color(r, g, b);
export const hsl = (h, s, l, k = 1) => { const c = new THREE.Color().setHSL(h / 360, s, l); return c.multiplyScalar(k); };

const PostShader = {
  uniforms: { tDiffuse: { value: null }, uAberr: { value: 0 }, uDamage: { value: 0 }, uTime: { value: 0 }, uWarp: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAberr, uDamage, uTime, uWarp; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float d = length(c);
      uv += c * uWarp * d * d;
      float glitch = step(0.985, hash(vec2(floor(uv.y * 40.0), floor(uTime * 20.0)))) * uAberr * 2.0;
      uv.x += glitch * 0.02;
      vec2 off = c * (0.004 + uAberr * 0.06) * (0.5 + d);
      vec3 col = vec3(texture2D(tDiffuse, uv + off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off).b);
      col *= 1.0 - smoothstep(0.42, 0.95, d) * 0.7;
      col += vec3(1.0, 0.04, 0.12) * uDamage * smoothstep(0.2, 0.8, d) * 0.9;
      col *= 0.965 + 0.035 * sin(vUv.y * 1100.0 + uTime * 8.0);
      col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.025;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

function extrude(points, depth = 7) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

export const PLAYER_SHAPE = [[28, 0], [-14, 16], [-6, 0], [-14, -16]];
function starShape(spikes, inner, R = 23) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? (i === 0 ? R * 1.35 : R) : R * inner;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030208);
    this.camera = new THREE.PerspectiveCamera(42, 16 / 9, 10, 9000);
    this.camBase = new THREE.Vector3(); this.look = new THREE.Vector3(0, 0, 30);
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(800, 450), 0.85, 0.42, 0.3);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass(PostShader); this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());

    this.fx = new FX(this.scene);
    this.grid = new Grid(this.scene);
    this._arena(); this._stars(); this._bullets();
    this.trauma = 0; this.aberr = 0; this.damage = 0; this.warp = 0; this.time = 0;
    this.focus = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _arena() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, H + 40), new THREE.MeshBasicMaterial({ color: 0x05040c }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -6; this.scene.add(floor);
    this.frameMat = new THREE.MeshBasicMaterial({ color: hdr(0.35, 0.2, 1.4) });
    const t = 5, h = 14;
    const mk = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.frameMat); m.position.set(x, h / 2 - 4, z); this.scene.add(m); };
    mk(W + t * 2, t, 0, -H / 2 - t / 2); mk(W + t * 2, t, 0, H / 2 + t / 2);
    mk(t, H, -W / 2 - t / 2, 0); mk(t, H, W / 2 + t / 2, 0);
    // corner pylons
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 60, 6), new THREE.MeshBasicMaterial({ color: hdr(1.4, 0.25, 1.0) }));
      p.position.set(x * (W / 2 + 4), 26, z * (H / 2 + 4)); this.scene.add(p);
    }
  }
  _stars() {
    const n = 1400, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rr = 900 + Math.random() * 3500;
      pos[i * 3] = Math.cos(a) * rr; pos[i * 3 + 1] = -200 - Math.random() * 2600; pos[i * 3 + 2] = Math.sin(a) * rr * 0.8 - 600;
      const c = hsl(200 + Math.random() * 120, 0.8, 0.7, 0.15 + Math.random() * 0.45);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, vertexColors: true, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.stars);
  }
  _bullets() {
    const MAX = 700;
    const pg = new THREE.BoxGeometry(24, 2.6, 2.6);
    this.pBul = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ color: hdr(2.2, 1.9, 0.8) }), MAX);
    const eg = new THREE.IcosahedronGeometry(7, 1);
    this.eBul = new THREE.InstancedMesh(eg, new THREE.MeshBasicMaterial({ color: hdr(3.4, 0.35, 1.5) }), MAX);
    const sg = new THREE.IcosahedronGeometry(10, 1);
    this.sBul = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: hdr(3.6, 0.2, 0.25) }), 300);
    for (const m of [this.pBul, this.eBul, this.sBul]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); }
    this._dummy = new THREE.Object3D();
  }
  setBullets(pb, eb) {
    const d = this._dummy;
    let n = 0;
    for (const b of pb) {
      d.position.set(toX(b.x), 12, toZ(b.y)); d.rotation.set(0, -Math.atan2(b.vy, b.vx), 0); d.scale.set(1, 1, 1);
      d.updateMatrix(); this.pBul.setMatrixAt(n++, d.matrix); if (n >= 700) break;
    }
    this.pBul.count = n; this.pBul.instanceMatrix.needsUpdate = true;
    let e = 0, s = 0;
    const pul = 1 + Math.sin(this.time * 30) * 0.15;
    for (const b of eb) {
      d.position.set(toX(b.x), 12, toZ(b.y)); d.rotation.set(this.time * 4, this.time * 3, 0); d.scale.setScalar(pul); d.updateMatrix();
      if (b.shadow) { if (s < 300) this.sBul.setMatrixAt(s++, d.matrix); }
      else if (e < 700) this.eBul.setMatrixAt(e++, d.matrix);
    }
    this.eBul.count = e; this.eBul.instanceMatrix.needsUpdate = true;
    this.sBul.count = s; this.sBul.instanceMatrix.needsUpdate = true;
  }

  // ---------- ship factories ----------
  _ship(geo, body, edge) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: body, transparent: true }));
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: edge, transparent: true }));
    g.add(m); g.add(e);
    g.userData = { body: m, edge: e };
    this.scene.add(g);
    return g;
  }
  makePlayer() {
    const g = this._ship(extrude(PLAYER_SHAPE, 8), hdr(0.05, 0.55, 0.7), hdr(0.7, 3.2, 3.6));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hdr(0.08, 0.6, 0.9), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glow.scale.setScalar(64); glow.position.y = 4; g.add(glow);
    const shield = new THREE.Mesh(new THREE.RingGeometry(30, 33, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: hdr(0.4, 2.5, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    shield.position.y = 4; shield.visible = false; g.add(shield);
    g.userData.glow = glow; g.userData.shield = shield;
    return g;
  }
  makeHunter(ph) {
    const g = this._ship(extrude(starShape(ph.spikes, ph.inner), 9), hsl(ph.hue, 1, 0.5, 0.35), hsl(ph.hue, 1, 0.6, 2.8));
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hsl(ph.hue, 1, 0.6, 0.8), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    core.scale.setScalar(44); core.position.y = 6; g.add(core);
    g.userData.core = core; g.userData.color = hsl(ph.hue, 1, 0.6, 1.5);
    return g;
  }
  makeDrone() {
    const geo = new THREE.OctahedronGeometry(12, 0);
    const g = this._ship(geo, hdr(0.15, 0.6, 0.05), hdr(1.2, 3.2, 0.5));
    g.userData.color = hdr(0.9, 2.4, 0.4);
    return g;
  }
  makeShadow() {
    const g = this._ship(extrude(PLAYER_SHAPE, 10), hdr(0.12, 0.0, 0.02), hdr(3.6, 0.15, 0.3));
    g.scale.setScalar(2.4);
    const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: hdr(0.9, 0.03, 0.08), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    aura.scale.setScalar(70); aura.position.y = 2; g.add(aura);
    g.userData.color = hdr(3, 0.15, 0.25);
    return g;
  }
  makePickup(type) {
    const col = type === 'hp' ? hdr(0.4, 3, 1.2) : hdr(0.8, 1.4, 3.6);
    const geo = type === 'hp' ? new THREE.TorusGeometry(12, 3.5, 8, 24) : new THREE.OctahedronGeometry(14, 0);
    const g = this._ship(geo, col.clone().multiplyScalar(0.4), col);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, color: col.clone().multiplyScalar(0.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    glow.scale.setScalar(90); g.add(glow);
    return g;
  }
  ghostCopy(src, color, life = 0.4) {
    // afterimage for dashes / the shadow
    const geo = src.userData.body.geometry;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(src.position); m.rotation.copy(src.rotation); m.scale.copy(src.scale);
    m.userData = { life, max: life };
    this.scene.add(m);
    (this.afterimages ||= []).push(m);
  }
  remove(obj) {
    if (!obj) return;
    this.scene.remove(obj);
    obj.traverse(o => { if (o.geometry && !o.isSprite) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  place(obj, x, y, heading = 0, h = 10) {
    obj.position.set(toX(x), h, toZ(y));
    obj.rotation.y = -heading;
  }

  // ---------- camera ----------
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    const vf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hf = Math.atan(Math.tan(vf) * this.camera.aspect);
    const dist = Math.max((W / 2 + 70) / Math.tan(hf), (H / 2 + 120) / Math.tan(vf) * 1.02) * 1.0;
    const el = THREE.MathUtils.degToRad(58);
    this.camBase.set(0, Math.sin(el) * dist, Math.cos(el) * dist + 40);
    this.camera.updateProjectionMatrix();
    this.fx.points.material.uniforms.uScale.value = h * 0.9;
  }
  shake(t) { this.trauma = Math.min(1, this.trauma + t); }
  kick(a) { this.aberr = Math.min(1, this.aberr + a); }
  hurt() { this.damage = 1; this.kick(0.6); this.shake(0.6); }

  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, p)) return null;
    return { x: p.x + W / 2, y: p.z + H / 2 };
  }
  worldToScreen(x, y, h = 20) {
    const v = new THREE.Vector3(toX(x), h, toZ(y)).project(this.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }

  update(dt, focusX = W / 2, focusY = H / 2) {
    this.time += dt;
    this.fx.update(dt); this.grid.update(dt);
    if (this.afterimages) {
      for (let i = this.afterimages.length - 1; i >= 0; i--) {
        const m = this.afterimages[i]; m.userData.life -= dt;
        if (m.userData.life <= 0) { this.scene.remove(m); m.material.dispose(); this.afterimages.splice(i, 1); }
        else m.material.opacity = 0.5 * m.userData.life / m.userData.max;
      }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.aberr = Math.max(0, this.aberr - dt * 2.2);
    this.damage = Math.max(0, this.damage - dt * 1.8);
    this.warp = Math.max(0, this.warp - dt * 2);
    const s = this.trauma * this.trauma, t = this.time;
    this.focus.lerp(new THREE.Vector3(toX(focusX) * 0.07, 0, toZ(focusY) * 0.07), 1 - Math.exp(-dt * 3));
    this.camera.position.set(
      this.camBase.x + this.focus.x + Math.sin(t * 47) * 26 * s,
      this.camBase.y + Math.sin(t * 39) * 18 * s,
      this.camBase.z + this.focus.z + Math.cos(t * 43) * 22 * s);
    this.camera.lookAt(this.look.x + this.focus.x, 0, this.look.z + this.focus.z);
    this.camera.rotation.z += Math.sin(t * 31) * 0.02 * s;
    this.stars.rotation.y += dt * 0.006;
    const pu = this.post.uniforms;
    pu.uAberr.value = this.aberr; pu.uDamage.value = this.damage; pu.uTime.value = t; pu.uWarp.value = this.warp;
    this.frameMat.color.setRGB(0.35 + this.grid.pulse * 1.2, 0.2 + this.grid.pulse * 0.8, 1.4 + this.grid.pulse * 0.6);
    this.warp = Math.min(this.warp, 0.45);
  }
  render() { this.composer.render(); }
}
