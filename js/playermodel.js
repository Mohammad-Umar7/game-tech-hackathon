// Watches how YOU play and fits a compact behavioural model ("your shadow").
import { W, H, PLAYER, clamp, lerp } from './config.js';

export const DEFAULT_MODEL = {
  prefDist: 340, distStiff: 0.45, orbitDir: 1, orbitStrength: 0.35, orbitConsistency: 0.55,
  speedFrac: 0.7, jukeRate: 0.7, dashRate: 0.2, dashOnThreat: 0.35, dodgeSkill: 0.4,
  aimError: 0.14, accuracy: 0.3, fireDuty: 0.8, centerPull: 0.35, samples: 0, generic: true,
};

export class Recorder {
  constructor() { this.reset(); }
  reset() {
    this.t = 0; this.acc = 0; this.n = 0;
    this.dist = []; this.radial = []; this.tang = []; this.speed = []; this.center = []; this.firing = 0;
    this.reversals = 0; this.lastTangSign = 0;
    this.dashes = 0; this.threatDashes = 0; this.shots = 0; this.hits = 0;
    this.nearMiss = 0; this.damage = 0;
  }
  // called every frame while playing
  frame(p, enemy, firing, dt) {
    this.t += dt; this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0; this.n++;
    const sp = Math.hypot(p.vx, p.vy);
    this.speed.push(Math.min(1, sp / PLAYER.speed));
    this.center.push(Math.hypot(p.x - W / 2, p.y - H / 2));
    if (firing) this.firing++;
    if (!enemy) return;
    const dx = enemy.x - p.x, dy = enemy.y - p.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const rad = (p.vx * ux + p.vy * uy) / PLAYER.speed;
    const tan = (p.vx * -uy + p.vy * ux) / PLAYER.speed;
    this.dist.push(d); this.radial.push(rad); this.tang.push(tan);
    const s = Math.abs(tan) > 0.3 ? Math.sign(tan) : 0;
    if (s !== 0) {
      if (this.lastTangSign !== 0 && s !== this.lastTangSign) this.reversals++;
      this.lastTangSign = s;
    }
  }
  dash(threat) { this.dashes++; if (threat > 0.15) this.threatDashes++; }

  fit(prev) {
    const m = { ...prev, generic: false };
    if (this.n < 15 || this.dist.length < 10) return m;
    const mean = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const sorted = this.dist.slice().sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    // regress radial velocity on range error -> how hard you hold your range
    let sxy = 0, sxx = 0;
    for (let i = 0; i < this.dist.length; i++) {
      const xe = (this.dist[i] - med) / 130; sxy += xe * this.radial[i]; sxx += xe * xe;
    }
    const stiff = clamp(sxx > 0 ? sxy / sxx : 0.4, 0, 1);
    const tm = mean(this.tang);
    let agree = 0;
    for (const t of this.tang) if (Math.sign(t) === Math.sign(tm || 1) && Math.abs(t) > 0.15) agree++;
    const secs = Math.max(1, this.t);
    const fresh = {
      prefDist: clamp(med, 90, 800),
      distStiff: stiff,
      orbitDir: tm >= 0 ? 1 : -1,
      orbitStrength: clamp(Math.abs(tm) * 2.2, 0, 1),
      orbitConsistency: clamp(agree / this.tang.length, 0, 1),
      speedFrac: clamp(mean(this.speed), 0.2, 1),
      jukeRate: clamp(this.reversals / secs * 1.5, 0.05, 3),
      dashRate: clamp(this.dashes / secs, 0, 2),
      dashOnThreat: this.dashes ? clamp(this.threatDashes / this.dashes, 0, 1) : 0.1,
      dodgeSkill: clamp((this.nearMiss + 1) / (this.nearMiss + this.damage * 3 + 2), 0.05, 0.95),
      accuracy: this.shots ? clamp(this.hits / this.shots, 0.01, 1) : 0.25,
      fireDuty: clamp(this.firing / this.n, 0.05, 1),
      centerPull: clamp(1 - mean(this.center) / 520, 0, 1),
    };
    fresh.aimError = clamp(0.5 * Math.pow(1 - fresh.accuracy, 2.2), 0.03, 0.5);
    // blend: new evidence dominates, but keeps memory of older waves
    const k = prev.generic ? 1 : 0.7;
    for (const key in fresh) m[key] = key === 'orbitDir' ? fresh[key] : lerp(prev[key], fresh[key], k);
    m.samples = (prev.samples || 0) + this.n;
    m.stats = { secs, dashes: this.dashes, reversals: this.reversals, shots: this.shots, hits: this.hits, nearMiss: this.nearMiss, damage: this.damage, orbitPct: Math.round(100 * fresh.orbitConsistency) };
    return m;
  }
}

// 0..1 radar axes
export function fingerprint(m) {
  return [
    ['AGGRESSION', clamp(1 - (m.prefDist - 120) / 560, 0, 1) * 0.6 + m.fireDuty * 0.4],
    ['MOBILITY', m.speedFrac],
    ['CHAOS', clamp(m.jukeRate / 2.2, 0, 1) * 0.7 + clamp(m.dashRate / 1.2, 0, 1) * 0.3],
    ['ORBIT LOCK', m.orbitStrength * 0.5 + m.orbitConsistency * 0.5],
    ['PRECISION', clamp(m.accuracy / 0.6, 0, 1)],
    ['EVASION', m.dodgeSkill],
  ];
}

export function insights(m) {
  const out = [];
  const dir = m.orbitDir > 0 ? 'COUNTER-CLOCKWISE' : 'CLOCKWISE';
  if (m.stats) out.push(`You circle your targets <b>${dir}</b> ${m.stats.orbitPct}% of the time`);
  out.push(`Your comfort range is <b>${Math.round(m.prefDist)}px</b>${m.prefDist < 260 ? ' — you brawl up close' : m.prefDist > 450 ? ' — you snipe from afar' : ''}`);
  out.push(`You reverse direction <b>${m.jukeRate.toFixed(1)}×/sec</b>${m.jukeRate < 0.6 ? ' — very predictable' : m.jukeRate > 1.6 ? ' — chaotic!' : ''}`);
  if (m.stats && m.stats.dashes) out.push(`<b>${Math.round(m.dashOnThreat * 100)}%</b> of your dashes are panic-dodges`);
  else out.push(`You <b>never dash</b> — they will crowd you`);
  out.push(`Accuracy <b>${Math.round(m.accuracy * 100)}%</b> · trigger held <b>${Math.round(m.fireDuty * 100)}%</b>`);
  return out;
}

// Out-Of-Distribution meter: how far your CURRENT play is from the model they trained on.
export class DriftMeter {
  constructor() { this.tang = 0; this.dist = 340; this.speed = 0.7; this.rev = 0; this.lastSign = 0; this.value = 0; }
  update(p, enemy, model, dt) {
    const a = 1 - Math.exp(-dt / 1.6);
    const sp = Math.min(1, Math.hypot(p.vx, p.vy) / PLAYER.speed);
    this.speed += (sp - this.speed) * a;
    this.rev *= Math.exp(-dt / 2);
    if (enemy) {
      const dx = enemy.x - p.x, dy = enemy.y - p.y, d = Math.hypot(dx, dy) || 1;
      const tan = (p.vx * -dy / d + p.vy * dx / d) / PLAYER.speed;
      this.tang += (tan - this.tang) * a;
      this.dist += (d - this.dist) * a;
      const s = Math.abs(tan) > 0.3 ? Math.sign(tan) : 0;
      if (s && this.lastSign && s !== this.lastSign) this.rev += 1;
      if (s) this.lastSign = s;
    }
    const orbitShift = clamp((model.orbitDir * -this.tang) * 1.4 + 0.15, 0, 1); // orbiting the "wrong" way
    const distShift = clamp(Math.abs(this.dist - model.prefDist) / 260, 0, 1);
    const jukeShift = clamp((this.rev / 2 - model.jukeRate) / 1.5, 0, 1);
    const speedShift = clamp(Math.abs(this.speed - model.speedFrac) / 0.5, 0, 1);
    const target = clamp(orbitShift * 0.4 + distShift * 0.3 + jukeShift * 0.2 + speedShift * 0.1, 0, 1);
    this.value += (target - this.value) * (1 - Math.exp(-dt / 0.5));
    return this.value;
  }
}
