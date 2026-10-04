// GPU-friendly explosion toolkit: glow particles, 3D sparks that bounce on the floor,
// shockwave rings, flashes and a Geometry-Wars style spring grid that warps under blasts.
import * as THREE from 'three';
import { W, H } from './config.js';

const toX = x => x - W / 2, toZ = y => y - H / 2;

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const GLOW_TEX = glowTexture();

export class FX {
  constructor(scene) {
    this.scene = scene;
    // ---- glow particles ----
    const N = this.N = 7000;
    this.p = { x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), vz: new Float32Array(N), life: new Float32Array(N), max: new Float32Array(N), size: new Float32Array(N), r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N), drag: new Float32Array(N), grav: new Float32Array(N) };
    this.pi = 0;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 900 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = 1.0 - d * 2.0; gl_FragColor = vec4(vC * a * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; scene.add(this.points);

    // ---- streak sparks ----
    const S = this.S = 3000;
    this.s = { x: new Float32Array(S), y: new Float32Array(S), z: new Float32Array(S), vx: new Float32Array(S), vy: new Float32Array(S), vz: new Float32Array(S), life: new Float32Array(S), max: new Float32Array(S), r: new Float32Array(S), g: new Float32Array(S), b: new Float32Array(S) };
    this.si = 0;
    const sg = new THREE.BufferGeometry();
    this.sPos = new Float32Array(S * 6); this.sCol = new Float32Array(S * 6);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.sparksMesh = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.sparksMesh.frustumCulled = false; scene.add(this.sparksMesh);

    // ---- rings + flashes ----
    this.rings = [];
    const rg = new THREE.RingGeometry(0.92, 1, 72); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.userData = { life: 0 }; scene.add(m); this.rings.push(m);
    }
    this.flashes = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      sp.visible = false; sp.userData = { life: 0 }; scene.add(sp); this.flashes.push(sp);
    }
    this.ri = 0; this.fi = 0;
  }

  particle(x, y, z, vx, vy, vz, life, size, col, drag = 2.5, grav = 0) {
    const i = this.pi; this.pi = (this.pi + 1) % this.N;
    const p = this.p;
    p.x[i] = x; p.y[i] = y; p.z[i] = z; p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    p.life[i] = life; p.max[i] = life; p.size[i] = size; p.r[i] = col.r; p.g[i] = col.g; p.b[i] = col.b;
    p.drag[i] = drag; p.grav[i] = grav;
  }
  spark(x, y, z, vx, vy, vz, life, col) {
    const i = this.si; this.si = (this.si + 1) % this.S;
    const s = this.s;
    s.x[i] = x; s.y[i] = y; s.z[i] = z; s.vx[i] = vx; s.vy[i] = vy; s.vz[i] = vz; s.life[i] = life; s.max[i] = life;
    s.r[i] = col.r; s.g[i] = col.g; s.b[i] = col.b;
  }
  ring(wx, wy, col, radius, life = 0.5, y = 3) {
    const m = this.rings[this.ri]; this.ri = (this.ri + 1) % this.rings.length;
    m.visible = true; m.position.set(toX(wx), y, toZ(wy)); m.material.color.copy(col);
    m.userData = { life, max: life, radius }; m.scale.setScalar(1);
  }
  flash(wx, wy, col, size, life = 0.25, y = 20) {
    const s = this.flashes[this.fi]; this.fi = (this.fi + 1) % this.flashes.length;
    s.visible = true; s.position.set(toX(wx), y, toZ(wy)); s.material.color.copy(col);
    s.userData = { life, max: life, size }; s.scale.setScalar(size);
  }

  // the big one
  explode(wx, wy, col, power = 1) {
    const X = toX(wx), Z = toZ(wy);
    const hot = new THREE.Color(Math.min(2.2, col.r * 0.9 + 0.5), Math.min(2.2, col.g * 0.9 + 0.5), Math.min(2.2, col.b * 0.9 + 0.5));
    const soft = col.clone().multiplyScalar(0.35);
    this.flash(wx, wy, hot.clone().multiplyScalar(0.5), 110 * Math.sqrt(power), 0.16);
    this.flash(wx, wy, soft, 230 * Math.sqrt(power), 0.35);
    this.ring(wx, wy, hot, 170 * power, 0.45);
    this.ring(wx, wy, col, 300 * power, 0.8);
    const n = Math.round(90 * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (200 + Math.random() * 700) * power;
      const up = Math.random() * 500 * power;
      this.spark(X, 12, Z, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.5 + Math.random() * 0.9, Math.random() < 0.3 ? hot : col);
    }
    const m = Math.round(70 * power);
    for (let i = 0; i < m; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 380 * power;
      this.particle(X, 10 + Math.random() * 20, Z, Math.cos(a) * sp, Math.random() * 160, Math.sin(a) * sp, 0.4 + Math.random() * 0.8, 7 + Math.random() * 12 * Math.sqrt(power), Math.random() < 0.4 ? hot : soft, 3.2);
    }
    // embers that rise
    for (let i = 0; i < 18 * power; i++) {
      this.particle(X + (Math.random() - 0.5) * 60, 10, Z + (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 80 + Math.random() * 180, (Math.random() - 0.5) * 60, 1.2 + Math.random(), 6 + Math.random() * 6, col, 0.8, -40);
    }
  }
  hit(wx, wy, col, dirx = 0, diry = 0) {
    const X = toX(wx), Z = toZ(wy);
    for (let i = 0; i < 14; i++) {
      const a = Math.atan2(diry, dirx) + (Math.random() - 0.5) * 1.8, sp = 250 + Math.random() * 450;
      this.spark(X, 14, Z, Math.cos(a) * sp, Math.random() * 220, Math.sin(a) * sp, 0.25 + Math.random() * 0.35, col);
    }
    this.flash(wx, wy, col.clone().multiplyScalar(0.4), 50, 0.1);
  }
  trail(wx, wy, col, size = 10, life = 0.35, y = 8) {
    this.particle(toX(wx), y, toZ(wy), (Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30, life, size, col, 2);
  }
  burst(wx, wy, col, n = 30, speed = 300, life = 0.6, size = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random());
      this.particle(toX(wx), 12, toZ(wy), Math.cos(a) * sp, Math.random() * 100, Math.sin(a) * sp, life * (0.5 + Math.random()), size, col, 2.5);
    }
  }

  update(dt) {
    const p = this.p, N = this.N, pos = this.pPos, colA = this.pCol, sz = this.pSize;
    for (let i = 0; i < N; i++) {
      if (p.life[i] <= 0) { if (sz[i] !== 0) sz[i] = 0; continue; }
      p.life[i] -= dt;
      const k = Math.exp(-p.drag[i] * dt);
      p.vx[i] *= k; p.vy[i] = p.vy[i] * k - p.grav[i] * dt; p.vz[i] *= k;
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      if (p.y[i] < 1) { p.y[i] = 1; p.vy[i] *= -0.4; }
      const f = Math.max(0, p.life[i] / p.max[i]);
      pos[i * 3] = p.x[i]; pos[i * 3 + 1] = p.y[i]; pos[i * 3 + 2] = p.z[i];
      colA[i * 3] = p.r[i] * f; colA[i * 3 + 1] = p.g[i] * f; colA[i * 3 + 2] = p.b[i] * f;
      sz[i] = p.size[i] * (0.4 + 0.6 * f);
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = true; ga.color.needsUpdate = true; ga.size.needsUpdate = true;

    const s = this.s, S = this.S, sp = this.sPos, sc = this.sCol;
    for (let i = 0; i < S; i++) {
      const o = i * 6;
      if (s.life[i] <= 0) { if (sc[o] !== 0 || sc[o + 1] !== 0) { sc.fill(0, o, o + 6); } continue; }
      s.life[i] -= dt;
      const k = Math.exp(-2.2 * dt);
      s.vx[i] *= k; s.vz[i] *= k; s.vy[i] = s.vy[i] * k - 1400 * dt;
      s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; s.z[i] += s.vz[i] * dt;
      if (s.y[i] < 1) { s.y[i] = 1; s.vy[i] *= -0.45; s.vx[i] *= 0.7; s.vz[i] *= 0.7; }
      const f = Math.max(0, s.life[i] / s.max[i]);
      sp[o] = s.x[i]; sp[o + 1] = s.y[i]; sp[o + 2] = s.z[i];
      sp[o + 3] = s.x[i] - s.vx[i] * 0.04; sp[o + 4] = s.y[i] - s.vy[i] * 0.04; sp[o + 5] = s.z[i] - s.vz[i] * 0.04;
      const r = s.r[i] * f * 1.8, g = s.g[i] * f * 1.8, b = s.b[i] * f * 1.8;
      sc[o] = r; sc[o + 1] = g; sc[o + 2] = b; sc[o + 3] = r * 0.1; sc[o + 4] = g * 0.1; sc[o + 5] = b * 0.1;
    }
    const sa = this.sparksMesh.geometry.attributes;
    sa.position.needsUpdate = true; sa.color.needsUpdate = true;

    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      const t = 1 - u.life / u.max;
      m.scale.setScalar(Math.max(0.01, u.radius * (1 - Math.pow(1 - t, 3))));
      m.material.opacity = Math.pow(1 - t, 1.5);
    }
    for (const sp2 of this.flashes) {
      if (!sp2.visible) continue;
      const u = sp2.userData; u.life -= dt;
      if (u.life <= 0) { sp2.visible = false; continue; }
      const t = u.life / u.max;
      sp2.material.opacity = t * t;
      sp2.scale.setScalar(u.size * (1.25 - 0.25 * t));
    }
  }
}

// ---------- warping spring grid ----------
export class Grid {
  constructor(scene, spacing = 40) {
    this.cols = Math.round(W / spacing); this.rows = Math.round(H / spacing);
    const nx = this.nx = this.cols + 1, ny = this.ny = this.rows + 1, n = nx * ny;
    this.rx = new Float32Array(n); this.rz = new Float32Array(n);
    this.x = new Float32Array(n); this.z = new Float32Array(n); this.h = new Float32Array(n);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n); this.vh = new Float32Array(n);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      this.rx[k] = this.x[k] = toX(i * W / this.cols); this.rz[k] = this.z[k] = toZ(j * H / this.rows);
    }
    this.segs = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i < nx - 1) this.segs.push(k, k + 1);
      if (j < ny - 1) this.segs.push(k, k + nx);
    }
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.segs.length * 3); this.col = new Float32Array(this.segs.length * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.base = new THREE.Color(0.11, 0.06, 0.32);
    this.hot = new THREE.Color(0.25, 1.1, 1.8);
    this.pulse = 0;
  }
  push(wx, wy, force, radius, down = 1) {
    const X = toX(wx), Z = toZ(wy), r2 = radius * radius;
    for (let k = 0; k < this.x.length; k++) {
      const dx = this.x[k] - X, dz = this.z[k] - Z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1, f = force * (1 - d / radius);
      this.vx[k] += dx / d * f; this.vz[k] += dz / d * f; this.vh[k] -= f * 0.9 * down;
    }
  }
  pull(wx, wy, force, radius) {
    const X = toX(wx), Z = toZ(wy), r2 = radius * radius;
    for (let k = 0; k < this.x.length; k++) {
      const dx = this.x[k] - X, dz = this.z[k] - Z, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1, f = force * (1 - d / radius);
      this.vx[k] -= dx / d * f; this.vz[k] -= dz / d * f; this.vh[k] -= f * 0.3;
    }
  }
  update(dt) {
    const n = this.x.length, kA = 26, damp = Math.exp(-4.5 * dt);
    for (let k = 0; k < n; k++) {
      this.vx[k] = (this.vx[k] + (this.rx[k] - this.x[k]) * kA * dt) * damp;
      this.vz[k] = (this.vz[k] + (this.rz[k] - this.z[k]) * kA * dt) * damp;
      this.vh[k] = (this.vh[k] - this.h[k] * kA * dt) * damp;
      this.x[k] += this.vx[k] * dt; this.z[k] += this.vz[k] * dt; this.h[k] += this.vh[k] * dt;
      if (this.h[k] < -150) { this.h[k] = -150; this.vh[k] *= -0.3; }
    }
    // neighbour coupling makes ripples travel
    const nx = this.nx;
    for (let k = 0; k < n; k++) {
      const i = k % nx;
      if (i < nx - 1) { const a = (this.h[k + 1] - this.h[k]) * 6 * dt; this.vh[k] += a * 10; this.vh[k + 1] -= a * 10; }
      if (k + nx < n) { const a = (this.h[k + nx] - this.h[k]) * 6 * dt; this.vh[k] += a * 10; this.vh[k + nx] -= a * 10; }
    }
    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    const pos = this.pos, col = this.col, segs = this.segs, b = this.base, ht = this.hot;
    const pb = 1 + this.pulse * 0.8;
    for (let s = 0; s < segs.length; s++) {
      const k = segs[s], o = s * 3;
      pos[o] = this.x[k]; pos[o + 1] = this.h[k]; pos[o + 2] = this.z[k];
      const disp = Math.min(1, (Math.abs(this.x[k] - this.rx[k]) + Math.abs(this.z[k] - this.rz[k]) + Math.abs(this.h[k]) * 0.7) / 30);
      col[o] = (b.r + (ht.r - b.r) * disp) * pb; col[o + 1] = (b.g + (ht.g - b.g) * disp) * pb; col[o + 2] = (b.b + (ht.b - b.b) * disp) * pb;
    }
    const a = this.mesh.geometry.attributes; a.position.needsUpdate = true; a.color.needsUpdate = true;
  }
}
