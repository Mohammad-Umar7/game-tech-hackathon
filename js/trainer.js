// Headless arena: hunters vs. a clone of the player, run thousands of times per wave.
import { W, H, PLAYER, HUNTER, GA, mulberry32, segDist2 } from './config.js';
import { Brain } from './nn.js';
import { hunterThink, hunterMove, newHunterState, ghostThink, pilotMove } from './agents.js';

const DT = 1 / 30;
const DUEL_STEPS = 270; // 9 simulated seconds
const SQUAD = 3;

export class Duel {
  constructor(genome, model, seed) {
    this.rng = mulberry32(seed);
    const r = this.rng;
    this.model = model;
    this.genome = genome;
    this.ghost = { x: 300 + r() * (W - 600), y: 220 + r() * (H - 440), vx: 0, vy: 0, ax: 1, ay: 0, dashT: 0, dashCD: 0, fireCD: 0, cmd: { mx: 0, my: 0, aimx: 1, aimy: 0, fire: false, dash: false } };
    this.hunters = [];
    for (let i = 0; i < SQUAD; i++) {
      const a = r() * Math.PI * 2, d = 420 + r() * 200;
      const x = Math.min(W - 40, Math.max(40, this.ghost.x + Math.cos(a) * d));
      const y = Math.min(H - 40, Math.max(40, this.ghost.y + Math.sin(a) * d));
      this.hunters.push(newHunterState(new Brain(genome.genes), x, y));
    }
    this.gb = []; this.hb = []; // ghost bullets, hunter bullets
    this.step = 0; this.hitsOnGhost = 0; this.hitsTaken = 0; this.alive = 0; this.closeTime = 0; this.shots = 0; this.distSum = 0; this.distN = 0;
    this.spawnH = (x, y, vx, vy) => { this.shots++; this.hb.push({ x, y, vx, vy, life: HUNTER.bulletLife }); };
    this.events = null; // optional visual event sink
  }
  tick() {
    const g = this.ghost, hs = this.hunters, rng = this.rng;
    ghostThink(g, this.model, hs, this.hb, DT, rng);
    pilotMove(g, DT);
    g.fireCD -= DT;
    if (g.cmd.fire && g.fireCD <= 0) {
      g.fireCD = PLAYER.fireCD * 1.6; // ghost fires a bit slower (fewer bullets to simulate)
      const s = PLAYER.bulletSpeed;
      this.gb.push({ x: g.x, y: g.y, vx: g.cmd.aimx * s, vy: g.cmd.aimy * s, life: PLAYER.bulletLife });
    }
    let alive = 0;
    for (const h of hs) {
      if (h.dead) continue;
      alive++;
      hunterThink(h, g, this.gb, hs);
      hunterMove(h, DT, this.spawnH);
      const d = Math.hypot(h.x - g.x, h.y - g.y);
      if (d < 650) this.closeTime += DT;
      this.distSum += d; this.distN++;
    }
    this.alive += alive;
    // ghost bullets vs hunters
    for (let i = this.gb.length - 1; i >= 0; i--) {
      const b = this.gb[i];
      const ox = b.x, oy = b.y;
      b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
      let hit = false;
      for (const h of hs) {
        if (h.dead) continue;
        if (segDist2(ox, oy, b.x, b.y, h.x, h.y) < (HUNTER.radius + 4) ** 2) {
          h.hp--; this.hitsTaken++; hit = true;
          if (h.hp <= 0) { h.dead = true; if (this.events) this.events.push({ t: 'boom', x: h.x, y: h.y }); }
          else if (this.events) this.events.push({ t: 'hit', x: h.x, y: h.y });
          break;
        }
      }
      if (hit || b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) this.gb.splice(i, 1);
    }
    // hunter bullets vs ghost
    for (let i = this.hb.length - 1; i >= 0; i--) {
      const b = this.hb[i];
      const ox = b.x, oy = b.y;
      b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
      let hit = false;
      if (g.dashT <= 0 && segDist2(ox, oy, b.x, b.y, g.x, g.y) < (PLAYER.radius + 5) ** 2) {
        this.hitsOnGhost++; hit = true;
        if (this.events) this.events.push({ t: 'ghosthit', x: g.x, y: g.y });
      }
      if (hit || b.life <= 0 || b.x < 0 || b.x > W || b.y < 0 || b.y > H) this.hb.splice(i, 1);
    }
    this.step++;
    return this.step < DUEL_STEPS && alive > 0;
  }
  run() {
    while (this.tick());
    return this.fitness();
  }
  fitness() {
    // hits land on the shadow, squad survives, stays in the fight
    return this.hitsOnGhost * 100 + this.alive * DT * 4 - this.hitsTaken * 6 + this.closeTime * 1.5;
  }
}

export class Trainer {
  constructor(pop) {
    this.pop = pop;
    this.running = false;
    this.duels = 0;
    this.totalDuels = 0;
    this.seed = 1;
  }
  start(model, gens = GA.gensPerWave) {
    this.model = model;
    this.targetGen = this.pop.generation + gens;
    this.startGen = this.pop.generation;
    this.idx = 0;
    this.running = true;
    this.duels = 0;
    this.genSeed = (Math.random() * 1e9) | 0;
  }
  // evaluate genomes until the time budget is spent; returns true while still training
  update(budgetMs) {
    if (!this.running) return false;
    const t0 = performance.now();
    const gs = this.pop.genomes;
    while (performance.now() - t0 < budgetMs) {
      const g = gs[this.idx];
      // two different arenas per genome to reduce luck
      g.fitness = new Duel(g, this.model, this.genSeed + 1).run() + new Duel(g, this.model, this.genSeed + 2).run();
      this.duels += 2; this.totalDuels += 2;
      this.idx++;
      if (this.idx >= gs.length) {
        this.pop.evolve();
        this.idx = 0;
        this.genSeed = (Math.random() * 1e9) | 0;
        if (this.pop.generation >= this.targetGen) { this.running = false; return false; }
      }
    }
    return true;
  }
  get progress() { return (this.pop.generation - this.startGen + this.idx / this.pop.genomes.length) / Math.max(1, this.targetGen - this.startGen); }
}

// ---- Behavioural probes: ask a brain questions to explain what it learned ----
export function probe(genome, model) {
  const b = new Brain(genome.genes);
  const set = (range, tvr, tvt, aim, thr, side) => {
    b.in.fill(0);
    b.in[0] = range; b.in[1] = tvr; b.in[2] = tvt; b.in[5] = aim; b.in[6] = thr; b.in[7] = side; b.in[10] = 1;
    return b.forward();
  };
  // engagement range: where CHARGE output crosses zero
  let eq = null, prev = null;
  for (let d = 80; d <= 1100; d += 20) {
    const o = set(Math.min(2.5, d / 500) - 1, 0, 0, 0, 0, 0)[0];
    if (prev !== null && prev > 0 && o <= 0) { eq = d; break; }
    prev = o;
  }
  if (eq === null) eq = prev > 0 ? 80 : 1100;
  // shot leading vs your orbit (target moving tangentially)
  const o1 = set(0, 0, model.orbitDir * 0.8, 0, 0, 0);
  const lead = (o1[3] + 1) * 0.75;
  // dodge reflex: strafe correlation with dodge side
  const sL = set(0, 0, 0, 0, 1, 1)[1], sR = set(0, 0, 0, 0, 1, -1)[1];
  const dodge = Math.max(0, (sL - sR) / 2);
  // flinch when aimed at
  const a0 = Math.abs(set(0, 0, 0, 0, 0, 0)[1]), a1 = Math.abs(set(0, 0, 0, 1, 0, 0)[1]);
  const flinch = Math.max(0, a1 - a0);
  // trigger discipline
  let fires = 0;
  for (let d = 0; d < 10; d++) if (set(d / 5 - 1, 0, 0, 0, 0, 0)[2] > 0) fires++;
  // orbit direction vs player orbit
  const strafe = set(0, 0, model.orbitDir * 0.8, 0, 0, 0)[1];
  // empirical: fight 4 fixed arenas against the shadow
  let hits = 0, shots = 0, ds = 0, dn = 0;
  for (let s = 0; s < 4; s++) { const d = new Duel(genome, model, 9001 + s * 77); d.run(); hits += d.hitsOnGhost; shots += d.shots; ds += d.distSum; dn += d.distN; }
  return { range: dn ? Math.round(ds / dn) : eq, acc: shots ? hits / shots : 0, dmg: hits / 4, lead, dodge, flinch, fire: fires / 10, counterOrbit: -Math.sign(strafe) === Math.sign(model.orbitDir) ? 'against' : 'with' };
}

export function describeLearning(before, after, model) {
  const lines = [];
  const pct = (a, b) => (a > 0.01 ? Math.round(((b - a) / a) * 100) : Math.round(b * 100));
  const ra = Math.round(before.acc * 100), rb = Math.round(after.acc * 100);
  lines.push(`${rb >= ra ? '▲' : '▼'} Hit rate on your shadow <b>${ra}% → ${rb}%</b>${before.acc > 0.004 && after.acc / before.acc > 1.25 ? ` <b>(${(after.acc / before.acc).toFixed(1)}×)</b>` : ''}`);
  const dl = after.lead - before.lead;
  lines.push(`${dl >= 0 ? '▲' : '▼'} Shot leading <b>${before.lead.toFixed(2)} → ${after.lead.toFixed(2)}</b>${Math.abs(dl) > 0.08 ? (dl > 0 ? ' — aiming where you WILL be' : ' — you juke too much to lead') : ''}`);
  const rn = after.range - model.prefDist;
  lines.push(`◆ Fighting range <b>${before.range}px → ${after.range}px</b> ${Math.abs(rn) < 90 ? '— right at YOUR comfort range' : rn < 0 ? '— crowding inside your comfort zone' : '— staying out of your reach'}`);
  const dd = after.dodge - before.dodge;
  lines.push(`${dd >= 0 ? '▲' : '▼'} Dodge reflex <b>${dd >= 0 ? '+' : ''}${pct(before.dodge, after.dodge)}%</b>`);
  lines.push(`◆ They now orbit <b>${after.counterOrbit.toUpperCase()}</b> your ${model.orbitDir > 0 ? 'counter-clockwise' : 'clockwise'} circle${after.counterOrbit === 'against' ? ' — cutting you off' : ' — shadowing you'}`);
  if (after.flinch > before.flinch + 0.05) lines.push(`▲ Now <b>sidesteps when you aim</b> at them`);
  return lines;
}
