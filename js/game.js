// The live arena. Same agent code as the trainer, plus drones, the Shadow, juice and scoring.
import { W, H, PLAYER, HUNTER, segDist2, clamp } from './config.js';
import { Brain } from './nn.js';
import { hunterThink, hunterMove, newHunterState, ghostThink, pilotMove, bulletThreat } from './agents.js';
import { Recorder, DriftMeter, DEFAULT_MODEL } from './playermodel.js';
import { hdr, hsl } from './render.js';

const SHADOW = { speed: 330, accel: 2600, radius: 36, dashSpeed: 1150, dashTime: 0.2, dashCD: 1.5 };
const C_PLAYER = hdr(0.4, 2.2, 2.8), C_PB = hdr(2.6, 2.2, 0.8), C_EB = hdr(2.8, 0.4, 1.3), C_HOT = hdr(3, 2.4, 1.6);
const _thr = { threat: 0, dx: 0, dy: 0 };

export class Game {
  constructor(R, audio, ui, pop) {
    this.R = R; this.audio = audio; this.ui = ui; this.pop = pop;
    this.model = { ...DEFAULT_MODEL };
    this.rec = new Recorder(); this.drift = new DriftMeter();
    this.demo = false;
    this.player = null; this.hunters = []; this.drones = []; this.pb = []; this.eb = []; this.pickups = []; this.shadow = null;
    this.slowmo = 0; this.hitstop = 0;
  }

  reset(demo = false) {
    this.clear();
    this.demo = demo;
    this.score = 0; this.combo = 0; this.comboT = 0; this.mult = 1; this.kills = 0; this.hunterKills = 0;
    this.novaPts = 0; this.bossNum = 0; this.best = 0; this.ood = 0; this.time = 0;
    const p = this.player = { x: W / 2, y: H / 2 + 120, vx: 0, vy: 0, ax: 0, ay: -1, hp: PLAYER.hp, maxHp: PLAYER.hp, fireCD: 0, dashT: 0, dashCD: 0, invuln: 1.5, novas: 2, alive: true, cmd: { mx: 0, my: 0, aimx: 0, aimy: -1, fire: false, dash: false } };
    p.mesh = this.R.makePlayer();
    this.state = 'idle';
  }
  clear() {
    for (const e of [...this.hunters, ...this.drones, ...this.pickups]) this.R.remove(e.mesh);
    if (this.shadow) this.R.remove(this.shadow.mesh);
    if (this.player) this.R.remove(this.player.mesh);
    this.hunters = []; this.drones = []; this.pickups = []; this.pb = []; this.eb = []; this.shadow = null; this.spawnQ = [];
  }

  startWave(n) {
    this.wave = n; this.waveT = 0; this.state = 'wave'; this.purgeT = 0;
    this.boss = n % 3 === 0;
    if (!this.demo) { this.rec.reset(); }
    const q = this.spawnQ = [];
    const nh = this.boss ? Math.min(2 + Math.floor(n / 3), 6) : Math.min(3 + n, 12);
    const genomes = this.pop.sample(nh);
    genomes.forEach((g, i) => q.push({ t: 0.6 + i * 0.75, kind: 'hunter', genome: g }));
    const nd = this.boss ? 6 + n * 2 : 8 + n * 5;
    for (let i = 0, t = 1.6; i < nd; t += 2.0) { const b = Math.min(nd - i, 4 + (n >> 1)); q.push({ t, kind: 'drones', count: b }); i += b; }
    if (this.boss) { q.push({ t: 1.4, kind: 'shadow' }); this.bossNum++; }
    q.sort((a, b) => a.t - b.t);
    if (!this.demo) { this.audio.wave(); this.ui.banner(this.boss ? 'SHADOW WAVE' : `WAVE ${n}`, this.boss ? 'something learned to move like you' : (this.model.generic ? 'hunters trained on a generic player' : `hunters trained on YOU · gen ${this.pop.generation}`)); }
  }

  edgeSpawn(minD = 420) {
    const p = this.player;
    for (let k = 0; k < 20; k++) {
      const side = (Math.random() * 4) | 0;
      const x = side === 0 ? 60 : side === 1 ? W - 60 : 60 + Math.random() * (W - 120);
      const y = side === 2 ? 60 : side === 3 ? H - 60 : 60 + Math.random() * (H - 120);
      if (Math.hypot(x - p.x, y - p.y) > minD) return { x, y };
    }
    return { x: p.x < W / 2 ? W - 80 : 80, y: H / 2 };
  }

  spawn(s) {
    const R = this.R;
    if (s.kind === 'hunter') {
      const { x, y } = this.edgeSpawn();
      const h = newHunterState(new Brain(s.genome.genes), x, y);
      h.genome = s.genome; h.spawnT = 0.8; h.mesh = R.makeHunter(s.genome.pheno); h.color = h.mesh.userData.color;
      h.fireFlash = 0;
      this.hunters.push(h);
      R.fx.ring(x, y, h.color, 120, 0.7); R.fx.flash(x, y, h.color.clone().multiplyScalar(0.4), 160, 0.5); R.grid.pull(x, y, 90, 160);
    } else if (s.kind === 'drones') {
      const { x, y } = this.edgeSpawn(380);
      for (let i = 0; i < s.count; i++) {
        const d = { x: x + (Math.random() - 0.5) * 90, y: y + (Math.random() - 0.5) * 90, vx: 0, vy: 0, hp: 1, spawnT: 0.5 + i * 0.05, spin: Math.random() * 6 };
        d.mesh = R.makeDrone(); this.drones.push(d);
      }
      R.fx.ring(x, y, hdr(0.9, 2.4, 0.4), 110, 0.6);
    } else if (s.kind === 'shadow') {
      const p = this.player;
      const x = clamp(W - p.x, 120, W - 120), y = clamp(H - p.y, 120, H - 120);
      const hp = 70 + 25 * (this.bossNum - 1);
      const sh = this.shadow = { x, y, vx: 0, vy: 0, ax: 1, ay: 0, hp, maxHp: hp, dashT: 0, dashCD: 1, fireCD: 1.5, burstCD: 4, spawnT: 1.6, cmd: { mx: 0, my: 0, aimx: 1, aimy: 0, fire: false, dash: false }, rng: Math.random, trailT: 0 };
      sh.mesh = R.makeShadow();
      R.fx.ring(x, y, hdr(3, 0.1, 0.2), 400, 1.2); R.fx.flash(x, y, hdr(1, 0.03, 0.06), 500, 0.9);
      R.grid.pull(x, y, 400, 420); R.kick(1); R.shake(0.5); R.warp = 0.5;
      if (!this.demo) { this.audio.glitch(); this.ui.bossIntro(this.model); }
    }
  }

  // ---------------- main update ----------------
  update(dt, input) {
    this.time += dt;
    const p = this.player, R = this.R;
    if (this.state === 'wave') {
      this.waveT += dt;
      while (this.spawnQ.length && this.spawnQ[0].t <= this.waveT) this.spawn(this.spawnQ.shift());
    }
    // --- player control ---
    if (p.alive) {
      const c = p.cmd;
      if (this.demo || this.autopilot) {
        ghostThink(p, DEMO_MODEL, [...this.hunters.filter(h => h.spawnT <= 0), ...this.drones, ...(this.shadow ? [this.shadow] : [])], this.eb, dt, Math.random);
        if (this.demo) p.invuln = 1; else if (Math.random() < dt * 0.15) this.nova();
      } else {
        c.mx = input.mx; c.my = input.my;
        const ax = input.wx - p.x, ay = input.wy - p.y, al = Math.hypot(ax, ay);
        if (al > 4) { c.aimx = ax / al; c.aimy = ay / al; }
        c.fire = input.fire; c.dash = input.dash;
        if (input.nova) this.nova();
      }
      pilotMove(p, dt);
      if (p.justDashed) {
        p.justDashed = false;
        bulletThreat(p.x, p.y, p.vx, p.vy, this.eb, _thr);
        if (!this.demo) { this.rec.dash(_thr.threat); this.audio.dash(); }
        R.fx.ring(p.x, p.y, C_PLAYER, 60, 0.3); R.grid.push(p.x, p.y, 120, 120);
      }
      if (p.dashT > 0) R.ghostCopy(p.mesh, hdr(0.2, 1.4, 1.8), 0.3);
      p.invuln -= dt; p.fireCD -= dt;
      if (c.fire && p.fireCD <= 0) {
        p.fireCD = PLAYER.fireCD;
        const s = PLAYER.bulletSpeed, nx = -c.aimy, ny = c.aimx, sp = (Math.random() - 0.5) * 0.04;
        const ca = Math.cos(sp), sa = Math.sin(sp), vx = (c.aimx * ca - c.aimy * sa) * s, vy = (c.aimx * sa + c.aimy * ca) * s;
        for (const o of [-7, 7]) this.pb.push({ x: p.x + c.aimx * 20 + nx * o, y: p.y + c.aimy * 20 + ny * o, vx, vy, life: PLAYER.bulletLife });
        if (!this.demo) { this.rec.shots += 2; this.audio.shoot(); }
      }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 60) R.fx.trail(p.x - c.aimx * 0, p.y, hdr(0.1, 0.9, 1.4), 9, 0.3, 6);
      R.grid.push(p.x, p.y, 7 * dt * 60 * (sp / PLAYER.speed), 70, 0.3);
    }
    // --- hunters ---
    const target = p;
    for (const h of this.hunters) {
      if (h.spawnT > 0) { h.spawnT -= dt; continue; }
      hunterThink(h, target, this.pb, this.hunters);
      hunterMove(h, dt, (x, y, vx, vy) => { this.eb.push({ x, y, vx, vy, life: HUNTER.bulletLife, minD: 1e9 }); h.fireFlash = 1; if (!this.demo) this.audio.enemyShoot(); });
      if (h.justDashed) { h.justDashed = false; R.fx.ring(h.x, h.y, h.color, 50, 0.25); }
      if (h.dashT > 0) R.ghostCopy(h.mesh, h.color, 0.25);
      if (Math.random() < 0.5) R.fx.trail(h.x, h.y, h.color, 7, 0.4, 6);
      h.fireFlash = Math.max(0, h.fireFlash - dt * 6);
      if (p.alive && p.invuln <= 0 && p.dashT <= 0 && Math.hypot(h.x - p.x, h.y - p.y) < HUNTER.radius + PLAYER.radius) { this.damagePlayer(); this.hurtHunter(h, 2, p.x - h.x, p.y - h.y); }
    }
    // --- drones: dumb swarm that boids toward you ---
    const dsp = 150 + Math.min(this.wave || 1, 12) * 9;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      d.spin += dt * 4;
      if (d.spawnT > 0) { d.spawnT -= dt; continue; }
      let dx = p.x - d.x, dy = p.y - d.y; const dl = Math.hypot(dx, dy) || 1;
      let mx = dx / dl, my = dy / dl;
      mx += Math.sin(this.time * 2 + i) * 0.35; my += Math.cos(this.time * 2.3 + i * 1.7) * 0.35;
      for (let j = Math.max(0, i - 6); j < Math.min(this.drones.length, i + 6); j++) {
        if (j === i) continue; const o = this.drones[j]; const ex = d.x - o.x, ey = d.y - o.y, e2 = ex * ex + ey * ey;
        if (e2 < 900 && e2 > 0.01) { const e = Math.sqrt(e2); mx += ex / e * 0.8; my += ey / e * 0.8; }
      }
      const ml = Math.hypot(mx, my) || 1;
      d.vx += (mx / ml * dsp - d.vx) * Math.min(1, dt * 3); d.vy += (my / ml * dsp - d.vy) * Math.min(1, dt * 3);
      d.x = clamp(d.x + d.vx * dt, 12, W - 12); d.y = clamp(d.y + d.vy * dt, 12, H - 12);
      if (p.alive && dl < PLAYER.radius + 13) {
        if (p.invuln <= 0 && p.dashT <= 0) { this.damagePlayer(); this.killDrone(d); }
        else if (p.dashT > 0) this.killDrone(d);
      }
    }
    // --- the Shadow ---
    const sh = this.shadow;
    if (sh && !sh.dead) this.updateShadow(sh, dt);
    // --- player bullets ---
    for (let i = this.pb.length - 1; i >= 0; i--) {
      const b = this.pb[i], ox = b.x, oy = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let hit = false;
      for (const h of this.hunters) {
        if (h.dead || h.spawnT > 0) continue;
        if (segDist2(ox, oy, b.x, b.y, h.x, h.y) < (HUNTER.radius + 5) ** 2) { hit = true; this.hurtHunter(h, 1, b.vx, b.vy); break; }
      }
      if (!hit) for (const d of this.drones) {
        if (d.dead || d.spawnT > 0) continue;
        if (segDist2(ox, oy, b.x, b.y, d.x, d.y) < 17 ** 2) { hit = true; this.killDrone(d); if (!this.demo) this.rec.hits++; break; }
      }
      if (!hit && sh && !sh.dead && sh.spawnT <= 0 && segDist2(ox, oy, b.x, b.y, sh.x, sh.y) < (SHADOW.radius + 4) ** 2) {
        hit = true; this.hurtShadow(sh, 1, b.vx, b.vy);
      }
      if (hit || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        if (!hit && b.life > 0) R.fx.hit(clamp(b.x, 0, W), clamp(b.y, 0, H), C_PB, -b.vx, -b.vy);
        this.pb.splice(i, 1);
      }
    }
    // --- enemy bullets ---
    for (let i = this.eb.length - 1; i >= 0; i--) {
      const b = this.eb[i], ox = b.x, oy = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let hit = false;
      if (p.alive) {
        const d2 = segDist2(ox, oy, b.x, b.y, p.x, p.y);
        if (d2 < b.minD) b.minD = d2;
        if (d2 < (PLAYER.radius + (b.shadow ? 8 : 5)) ** 2 && p.invuln <= 0 && p.dashT <= 0) { hit = true; this.damagePlayer(); }
      }
      if (hit || b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        if (!hit && b.minD < 70 * 70 && !this.demo) this.rec.nearMiss++;
        this.eb.splice(i, 1);
      }
    }
    // --- pickups ---
    for (const k of this.pickups) {
      k.life -= dt; k.spin += dt * 3;
      if (p.alive && Math.hypot(k.x - p.x, k.y - p.y) < 42) {
        k.dead = true;
        if (k.type === 'hp') { p.hp = Math.min(p.maxHp, p.hp + 1); this.ui.popup(k.x, k.y, '+HULL', 'good'); }
        else { p.novas = Math.min(3, p.novas + 1); this.ui.popup(k.x, k.y, '+NOVA', 'nova'); }
        this.audio.pickup(); R.fx.burst(k.x, k.y, hdr(0.6, 2.5, 1.4), 30, 260);
      }
      if (k.life <= 0) k.dead = true;
    }
    // --- nova shockwave ---
    if (this.novaFx) this.updateNova(dt);
    // --- bookkeeping ---
    this.hunters = this.hunters.filter(h => !h.dead || (R.remove(h.mesh), false));
    this.drones = this.drones.filter(d => !d.dead || (R.remove(d.mesh), false));
    this.pickups = this.pickups.filter(k => !k.dead || (R.remove(k.mesh), false));
    if (sh && sh.dead) { R.remove(sh.mesh); this.shadow = null; }
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    this.mult = Math.min(8, 1 + Math.floor(this.combo / 4));
    if (!this.demo && p.alive) {
      const ne = this.nearestEnemy(p.x, p.y);
      this.rec.frame(p, ne, p.cmd.fire, dt);
      this.ood = this.drift.update(p, ne, this.model, dt);
      this.oodCD = (this.oodCD || 0) - dt;
      if (this.ood > 0.68 && !this.oodFlag && this.oodCD <= 0 && this.state === 'wave') {
        this.oodFlag = true; this.oodCD = 12;
        this.ui.banner('OUT OF DISTRIBUTION', "they can't predict you — score boosted", 'clear');
        this.audio.glitch(); R.kick(0.5); R.grid.pulse = 1;
        for (const h of this.hunters) if (h.spawnT <= 0) this.ui.popup(h.x, h.y, '???', 'nova');
      }
      if (this.ood < 0.4) this.oodFlag = false;
    }
    if (this.mult > (this.lastMult || 1) && !this.demo && p.alive) this.ui.popup(p.x, p.y - 40, `MULTIPLIER ×${this.mult}`, 'big');
    this.lastMult = this.mult;
    // --- wave clear / purge ---
    if (this.state === 'wave' && !this.spawnQ.length && !this.hunters.length && !this.shadow) {
      this.state = 'purge'; this.purgeT = 0;
      this.drones.forEach((d, i) => { d.purgeAt = 0.15 + i * 0.045; });
      if (!this.demo) this.ui.banner('WAVE CLEARED', this.drones.length ? `PURGE ×${this.drones.length}` : 'flawless', 'clear');
      R.grid.pulse = 1;
    }
    if (this.state === 'purge') {
      this.purgeT += dt;
      for (const d of this.drones) if (!d.dead && d.purgeAt <= this.purgeT) this.killDrone(d, true);
      this.eb.length = 0;
      if (this.purgeT > 1.6 && !this.drones.length) this.state = 'cleared';
    }
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.hitstop = Math.max(0, this.hitstop - dt);
  }

  updateShadow(sh, dt) {
    const p = this.player, R = this.R;
    if (sh.spawnT > 0) { sh.spawnT -= dt; R.grid.pull(sh.x, sh.y, 30 * dt * 60, 250); return; }
    const enraged = sh.hp < sh.maxHp * 0.5;
    ghostThink(sh, this.model, p.alive ? [p] : [], this.pb, dt, Math.random);
    sh.cmd.dash = sh.cmd.dash || (Math.random() < dt * 0.4);
    pilotMove(sh, dt, SHADOW);
    sh.fireCD -= dt; sh.burstCD -= dt; sh.trailT -= dt;
    if (sh.trailT <= 0) { sh.trailT = 0.05; R.ghostCopy(sh.mesh, hdr(1.2, 0.02, 0.1), 0.35); }
    if (sh.justDashed) { sh.justDashed = false; R.fx.ring(sh.x, sh.y, hdr(3, 0.1, 0.2), 120, 0.4); this.audio.dash(); }
    if (!p.alive) return;
    const dx = p.x - sh.x, dy = p.y - sh.y, d = Math.hypot(dx, dy) || 1;
    if (sh.fireCD <= 0) {
      sh.fireCD = enraged ? 0.2 : 0.3;
      const t = d / 540, px = p.x + p.vx * t * 0.6, py = p.y + p.vy * t * 0.6;
      const a = Math.atan2(py - sh.y, px - sh.x);
      for (const o of [-0.14, 0, 0.14]) this.eb.push({ x: sh.x, y: sh.y, vx: Math.cos(a + o) * 540, vy: Math.sin(a + o) * 540, life: 2.4, minD: 1e9, shadow: true });
      this.audio.enemyShoot();
    }
    if (sh.burstCD <= 0) {
      sh.burstCD = enraged ? 2.6 : 4.2;
      const n = enraged ? 26 : 18, off = Math.random() * 6;
      for (let i = 0; i < n; i++) { const a = off + (i / n) * Math.PI * 2; this.eb.push({ x: sh.x, y: sh.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, life: 3.2, minD: 1e9, shadow: true }); }
      R.fx.ring(sh.x, sh.y, hdr(3, 0.15, 0.3), 260, 0.6); R.grid.push(sh.x, sh.y, 260, 260); this.audio.boom(0.6); R.shake(0.15);
    }
    if (d < SHADOW.radius + PLAYER.radius && p.invuln <= 0 && p.dashT <= 0) this.damagePlayer();
  }

  nearestEnemy(x, y) {
    let best = null, bd = 1e18;
    for (const h of this.hunters) { if (h.spawnT > 0) continue; const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    if (this.shadow && this.shadow.spawnT <= 0) { const s = this.shadow, d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s; } }
    if (!best) for (const h of this.drones) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    return best;
  }

  addScore(base, x, y, big) {
    const pts = Math.round(base * this.mult * (1 + this.ood));
    this.score += pts;
    if (!this.demo) this.ui.popup(x, y, `+${pts}`, big ? 'big' : '');
  }
  registerKill(w) {
    this.combo++; this.comboT = 2.6; this.kills++;
    this.novaPts += w;
    if (this.novaPts >= 28) { this.novaPts -= 28; if (this.player.novas < 3) { this.player.novas++; if (!this.demo) this.ui.popup(this.player.x, this.player.y, 'NOVA READY', 'nova'); } }
  }

  hurtHunter(h, dmg, dx, dy) {
    if (h.dead) return;
    h.hp -= dmg; h.hitFlash = 1; this.R.fx.hit(h.x, h.y, h.color, -dx, -dy);
    if (!this.demo) { this.rec.hits++; this.audio.hit(); }
    if (h.hp <= 0) this.killHunter(h);
  }
  killHunter(h) {
    const R = this.R;
    h.dead = true; this.hunterKills++;
    if (!this.demo && this.state === 'wave' && !this.spawnQ.some(s => s.kind !== 'drones') && !this.shadow && this.hunters.every(o => o.dead)) { this.slowmo = 1.1; R.punch(h.x, h.y); this.ui.popup(h.x, h.y - 50, 'FINAL KILL', 'big'); }
    R.fx.explode(h.x, h.y, h.color, 1.25); R.grid.push(h.x, h.y, 520, 230); R.shake(0.32); R.kick(0.25);
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.audio.boom(1.2);
    this.registerKill(4);
    this.addScore(500, h.x, h.y, true);
    const p = this.player;
    if (Math.random() < (p.hp <= 2 ? 0.3 : 0.12)) this.drop(h.x, h.y, 'hp');
    else if (Math.random() < 0.05) this.drop(h.x, h.y, 'nova');
  }
  killDrone(d, purge = false) {
    if (d.dead) return;
    const R = this.R;
    d.dead = true;
    R.fx.explode(d.x, d.y, hdr(0.9, 2.4, 0.4), purge ? 0.75 : 0.55); R.grid.push(d.x, d.y, 260, 150); R.shake(0.08);
    this.audio.pop(); if (purge) this.audio.boom(0.5);
    this.registerKill(1);
    this.addScore(purge ? 75 : 50, d.x, d.y);
  }
  hurtShadow(sh, dmg, dx, dy) {
    sh.hp -= dmg; this.R.fx.hit(sh.x, sh.y, hdr(3, 0.2, 0.3), -dx, -dy);
    if (!this.demo) { this.rec.hits++; this.audio.hit(); }
    if (sh.hp <= 0 && !sh.dead) {
      sh.dead = true;
      const R = this.R;
      for (let i = 0; i < 5; i++) setTimeout(() => { R.fx.explode(sh.x + (Math.random() - 0.5) * 120, sh.y + (Math.random() - 0.5) * 120, hdr(3, 0.2, 0.3), 1.4); this.audio.boom(1.4); R.shake(0.3); }, i * 110);
      setTimeout(() => { R.fx.explode(sh.x, sh.y, hdr(3, 1.4, 1.2), 3.2); R.grid.push(sh.x, sh.y, 1600, 600); R.shake(1); R.kick(1); R.warp = 0.8; this.audio.nova(); }, 600);
      this.slowmo = 1.4; this.R.punch(sh.x, sh.y);
      this.registerKill(20);
      this.addScore(5000, sh.x, sh.y, true);
      this.drop(sh.x - 30, sh.y, 'hp'); this.drop(sh.x + 30, sh.y, 'nova');
      if (!this.demo) this.ui.banner('SHADOW DELETED', 'you beat yourself', 'clear');
    }
  }
  drop(x, y, type) {
    const k = { x, y, type, life: 12, spin: 0 };
    k.mesh = this.R.makePickup(type); this.pickups.push(k);
  }

  damagePlayer() {
    const p = this.player, R = this.R;
    if (!p.alive || p.invuln > 0 || this.demo) return;
    p.hp--; p.invuln = PLAYER.invuln;
    this.rec.damage++;
    R.hurt(); R.grid.push(p.x, p.y, 700, 300); R.fx.explode(p.x, p.y, C_PLAYER, 0.6);
    this.audio.hurt(); this.slowmo = 0.35; this.combo = 0;
    for (const b of this.eb) if (Math.hypot(b.x - p.x, b.y - p.y) < 170) b.life = 0;
    if (p.hp <= 0) {
      p.alive = false; this.state = 'dead';
      R.fx.explode(p.x, p.y, C_PLAYER, 3); R.fx.explode(p.x, p.y, C_HOT, 1.5); R.grid.push(p.x, p.y, 2000, 700);
      R.shake(1); R.kick(1); R.warp = 1; this.slowmo = 2; this.audio.nova();
      R.remove(p.mesh); p.mesh = null;
    }
  }

  nova() {
    const p = this.player, R = this.R;
    if (p.novas <= 0 || this.novaFx || !p.alive) return;
    p.novas--;
    this.novaFx = { x: p.x, y: p.y, r: 0, max: 560, hit: new Set() };
    R.fx.ring(p.x, p.y, hdr(1.2, 2.4, 4), 560, 0.7); R.fx.ring(p.x, p.y, hdr(3, 3, 3), 400, 0.45);
    R.fx.flash(p.x, p.y, hdr(0.3, 0.6, 1.2), 700, 0.45); R.grid.push(p.x, p.y, 1800, 620);
    R.shake(0.7); R.kick(0.8); R.warp = 0.7; this.audio.nova(); this.hitstop = 0.06;
    p.invuln = Math.max(p.invuln, 0.6);
  }
  updateNova(dt) {
    const n = this.novaFx;
    n.r += dt * 1400;
    for (const b of this.eb) if (Math.hypot(b.x - n.x, b.y - n.y) < n.r) { b.life = 0; this.R.fx.trail(b.x, b.y, C_EB, 10, 0.4); }
    for (const d of this.drones) if (!d.dead && Math.hypot(d.x - n.x, d.y - n.y) < n.r) this.killDrone(d);
    for (const h of this.hunters) if (!h.dead && !n.hit.has(h) && Math.hypot(h.x - n.x, h.y - n.y) < n.r) { n.hit.add(h); this.hurtHunter(h, 3, h.x - n.x, h.y - n.y); }
    const sh = this.shadow;
    if (sh && !sh.dead && !n.hit.has(sh) && Math.hypot(sh.x - n.x, sh.y - n.y) < n.r) { n.hit.add(sh); this.hurtShadow(sh, 10, sh.x - n.x, sh.y - n.y); }
    if (n.r >= n.max) this.novaFx = null;
  }

  // push state to meshes
  sync() {
    const R = this.R, p = this.player, t = this.time;
    if (p.mesh) {
      R.place(p.mesh, p.x, p.y, Math.atan2(p.cmd.aimy, p.cmd.aimx), 10);
      const blink = p.invuln > 0 && !this.demo && Math.floor(t * 20) % 2 === 0;
      p.mesh.visible = !blink;
      p.mesh.userData.shield.visible = p.invuln > 0 && !this.demo;
    }
    for (const h of this.hunters) {
      const s = h.spawnT > 0 ? 1 - h.spawnT / 0.8 : 1;
      R.place(h.mesh, h.x, h.y, h.heading, 10 + (h.spawnT > 0 ? h.spawnT * 160 : 0));
      h.mesh.scale.setScalar(0.2 + 0.8 * s);
      h.mesh.rotation.z = Math.sin(t * 3 + h.x) * 0.15;
      if (h.hitFlash > 0) { h.hitFlash = Math.max(0, h.hitFlash - 0.12); h.mesh.userData.body.material.color.copy(h.color).lerp(WHITE, h.hitFlash); } else if (h.hitFlash === 0) { h.mesh.userData.body.material.color.copy(h.color).multiplyScalar(0.25); h.hitFlash = -1; }
      h.mesh.userData.core.scale.setScalar(40 + h.fireFlash * 50 + (this.scan === h ? 50 + Math.sin(t * 20) * 16 : 0));
    }
    if (this.scan && !this.scan.dead && this.scan.mesh) {
      R.reticle.visible = true; R.reticle.position.set(this.scan.x - W / 2, 6, this.scan.y - H / 2);
      R.reticle.rotation.y = t * 2; R.reticle.scale.setScalar(1 + Math.sin(t * 12) * 0.06);
    } else R.reticle.visible = false;
    for (const d of this.drones) {
      R.place(d.mesh, d.x, d.y, d.spin, 12 + (d.spawnT > 0 ? d.spawnT * 200 : 0));
      d.mesh.rotation.x = d.spin * 0.7;
    }
    if (this.shadow) {
      const sh = this.shadow;
      R.place(sh.mesh, sh.x, sh.y, Math.atan2(sh.cmd.aimy, sh.cmd.aimx), 12 + (sh.spawnT > 0 ? sh.spawnT * 300 : 0));
    }
    for (const k of this.pickups) {
      R.place(k.mesh, k.x, k.y, k.spin, 16 + Math.sin(t * 4 + k.x) * 6);
      k.mesh.rotation.x = k.spin * 0.6;
      k.mesh.visible = k.life > 3 || Math.floor(t * 10) % 2 === 0;
    }
    R.setBullets(this.pb, this.eb);
  }
}

const WHITE = hdr(3, 3, 3);
const DEMO_MODEL = { ...DEFAULT_MODEL, aimError: 0.05, dodgeSkill: 0.8, fireDuty: 1, jukeRate: 1.0, orbitStrength: 0.6, speedFrac: 0.85, prefDist: 360, dashOnThreat: 0.8 };
