// Agent "physics + minds": shared 1:1 by the real game and the headless trainer.
import { W, H, PLAYER, HUNTER, clamp } from './config.js';

// Most dangerous incoming bullet: returns threat 0..1 and the unit direction that dodges it.
export function bulletThreat(sx, sy, svx, svy, bullets, out) {
  out.threat = 0; out.dx = 0; out.dy = 0;
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    const rx = b.x - sx, ry = b.y - sy;
    const vx = b.vx - svx, vy = b.vy - svy;
    const v2 = vx * vx + vy * vy;
    if (v2 < 1) continue;
    const t = -(rx * vx + ry * vy) / v2;
    if (t < 0 || t > 0.75) continue;
    const cx = rx + vx * t, cy = ry + vy * t;
    const m = Math.hypot(cx, cy);
    if (m > 85) continue;
    const thr = (1 - m / 85) * (1 - t / 0.75);
    if (thr > out.threat) {
      out.threat = thr;
      if (m > 0.01) { out.dx = -cx / m; out.dy = -cy / m; }
      else { const vl = Math.sqrt(v2); out.dx = -vy / vl; out.dy = vx / vl; }
    }
  }
  return out;
}

const _thr = { threat: 0, dx: 0, dy: 0 };

function wallSteer(x, y, out) {
  const m = 110;
  let fx = 0, fy = 0;
  if (x < m) fx += (m - x) / m; else if (x > W - m) fx -= (x - (W - m)) / m;
  if (y < m) fy += (m - y) / m; else if (y > H - m) fy -= (y - (H - m)) / m;
  out.wx = fx * 2.2; out.wy = fy * 2.2;
  return Math.max(Math.abs(fx), Math.abs(fy));
}
const _wall = { wx: 0, wy: 0 };

// ---------- HUNTER (neural) ----------
// target: {x,y,vx,vy,ax,ay}  threats: bullets fired by the target  allies: hunter array
export function hunterThink(h, target, threats, allies) {
  const br = h.brain, x = br.in;
  let dx = target.x - h.x, dy = target.y - h.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist, nx = -uy, ny = ux;
  x[0] = clamp(dist / 500, 0, 2.5) - 1;
  x[1] = (target.vx * ux + target.vy * uy) / PLAYER.speed;
  x[2] = (target.vx * nx + target.vy * ny) / PLAYER.speed;
  x[3] = (h.vx * ux + h.vy * uy) / HUNTER.speed;
  x[4] = (h.vx * nx + h.vy * ny) / HUNTER.speed;
  const aim = -(target.ax * ux + target.ay * uy);
  x[5] = aim > 0 ? aim * aim * aim * aim : 0;
  bulletThreat(h.x, h.y, h.vx, h.vy, threats, _thr);
  x[6] = _thr.threat;
  x[7] = _thr.threat * (_thr.dx * nx + _thr.dy * ny);
  // nearest ally
  let best = 1e9, ax = 0, ay = 0;
  for (let i = 0; i < allies.length; i++) {
    const a = allies[i];
    if (a === h || a.dead) continue;
    const ddx = a.x - h.x, ddy = a.y - h.y, d2 = ddx * ddx + ddy * ddy;
    if (d2 < best) { best = d2; ax = ddx; ay = ddy; }
  }
  x[8] = best < 1e9 ? clamp((ax * ux + ay * uy) / 300, -1, 1) : 0;
  x[9] = best < 1e9 ? clamp((ax * nx + ay * ny) / 300, -1, 1) : 0;
  x[10] = h.hp / h.maxHp;
  x[11] = h.mem;
  x[12] = wallSteer(h.x, h.y, _wall);
  const o = br.forward();
  h.mem = o[6];
  // movement intent in the target-relative frame
  let mx = ux * o[0] + nx * o[1], my = uy * o[0] + ny * o[1];
  // separation (hard-wired so they don't stack)
  if (best < 70 * 70) { const d = Math.sqrt(best) || 1; mx -= ax / d * 0.9; my -= ay / d * 0.9; }
  mx += _wall.wx; my += _wall.wy;
  const ml = Math.hypot(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  const c = h.cmd;
  c.mx = mx; c.my = my;
  // aim with learned lead + spread
  const lead = (o[3] + 1) * 0.75;
  const t = dist / HUNTER.bulletSpeed;
  const px = target.x + target.vx * t * lead, py = target.y + target.vy * t * lead;
  const ang = Math.atan2(py - h.y, px - h.x) + o[4] * 0.3;
  c.aimx = Math.cos(ang); c.aimy = Math.sin(ang);
  c.fire = o[2] > 0 && dist < 900;
  c.dash = o[5] > 0.7;
  c.lead = lead;
}

// Integrate a hunter given h.cmd. spawnBullet(x,y,vx,vy) supplied by caller.
export function hunterMove(h, dt, spawnBullet) {
  const c = h.cmd;
  h.fireCD -= dt; h.dashCD -= dt;
  if (h.dashT > 0) {
    h.dashT -= dt;
  } else {
    if (c.dash && h.dashCD <= 0) {
      let dx = c.mx, dy = c.my, l = Math.hypot(dx, dy);
      if (l < 0.2) { dx = -c.aimy; dy = c.aimx; l = 1; }
      h.vx = dx / l * HUNTER.dashSpeed; h.vy = dy / l * HUNTER.dashSpeed;
      h.dashT = HUNTER.dashTime; h.dashCD = HUNTER.dashCD;
      h.justDashed = true;
    } else {
      const tvx = c.mx * HUNTER.speed, tvy = c.my * HUNTER.speed;
      let ddx = tvx - h.vx, ddy = tvy - h.vy;
      const dl = Math.hypot(ddx, ddy), maxd = HUNTER.accel * dt;
      if (dl > maxd) { ddx *= maxd / dl; ddy *= maxd / dl; }
      h.vx += ddx; h.vy += ddy;
    }
  }
  h.x = clamp(h.x + h.vx * dt, HUNTER.radius, W - HUNTER.radius);
  h.y = clamp(h.y + h.vy * dt, HUNTER.radius, H - HUNTER.radius);
  h.heading = Math.atan2(c.aimy, c.aimx);
  if (c.fire && h.fireCD <= 0) {
    h.fireCD = HUNTER.fireCD * (0.85 + Math.random() * 0.3);
    const s = HUNTER.bulletSpeed;
    spawnBullet(h.x + c.aimx * 22, h.y + c.aimy * 22, c.aimx * s, c.aimy * s, h);
  }
}

export function newHunterState(brain, x, y) {
  return { x, y, vx: 0, vy: 0, hp: HUNTER.hp, maxHp: HUNTER.hp, brain, mem: 0, fireCD: 0.6 + Math.random(), dashCD: 0.5, dashT: 0, heading: 0, cmd: { mx: 0, my: 0, aimx: 1, aimy: 0, fire: false, dash: false, lead: 0 }, dead: false };
}

// ---------- GHOST (behavioural clone of the player) ----------
// model: fitted player fingerprint (see playermodel.js)
export function ghostThink(g, model, targets, threats, dt, rng) {
  let tgt = null, best = 1e18;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    if (t.dead) continue;
    const d2 = (t.x - g.x) ** 2 + (t.y - g.y) ** 2;
    if (d2 < best) { best = d2; tgt = t; }
  }
  const c = g.cmd;
  let mx = 0, my = 0;
  if (tgt) {
    const dx = tgt.x - g.x, dy = tgt.y - g.y, dist = Math.sqrt(best) || 1;
    const ux = dx / dist, uy = dy / dist, nx = -uy, ny = ux;
    // keep preferred range
    const radial = clamp((dist - model.prefDist) / 130, -1, 1) * (0.25 + model.distStiff);
    // orbit with occasional jukes
    if (g.orbit === undefined) g.orbit = model.orbitDir;
    if (rng() < model.jukeRate * dt) g.orbit = -g.orbit;
    if (g.orbit !== model.orbitDir && rng() < (model.orbitConsistency * 2.5) * dt) g.orbit = model.orbitDir;
    const tang = g.orbit * (0.25 + model.orbitStrength);
    mx = ux * radial + nx * tang; my = uy * radial + ny * tang;
    // aim like the player: lead-free, with their measured error
    const err = (rng() - 0.5) * 2 * model.aimError;
    const ang = Math.atan2(dy, dx) + err;
    c.aimx = Math.cos(ang); c.aimy = Math.sin(ang);
    c.fire = rng() < model.fireDuty;
  } else c.fire = false;
  // dodge
  bulletThreat(g.x, g.y, g.vx, g.vy, threats, _thr);
  c.dash = false;
  if (_thr.threat > 0.25 && rng() < model.dodgeSkill) {
    mx += _thr.dx * 1.6; my += _thr.dy * 1.6;
    if (_thr.threat > 0.55 && rng() < model.dashOnThreat * 0.25) c.dash = true;
  }
  if (rng() < model.dashRate * dt * 0.5) c.dash = true;
  // center pull
  const cx = W / 2 - g.x, cy = H / 2 - g.y, cl = Math.hypot(cx, cy) || 1;
  mx += cx / cl * model.centerPull * clamp(cl / 400, 0, 1);
  my += cy / cl * model.centerPull * clamp(cl / 400, 0, 1);
  wallSteer(g.x, g.y, _wall);
  mx += _wall.wx * 0.8; my += _wall.wy * 0.8;
  const ml = Math.hypot(mx, my) || 1;
  const sp = clamp(model.speedFrac, 0.35, 1);
  c.mx = mx / ml * sp; c.my = my / ml * sp;
}

// Integrate a player-like body (real player AND ghosts use this).
export function pilotMove(p, dt, spec = PLAYER) {
  const c = p.cmd;
  p.dashCD -= dt;
  if (p.dashT > 0) { p.dashT -= dt; }
  else {
    if (c.dash && p.dashCD <= 0) {
      let dx = c.mx, dy = c.my, l = Math.hypot(dx, dy);
      if (l < 0.1) { dx = c.aimx; dy = c.aimy; l = 1; }
      p.vx = dx / l * spec.dashSpeed; p.vy = dy / l * spec.dashSpeed;
      p.dashT = spec.dashTime; p.dashCD = spec.dashCD;
      p.justDashed = true;
    } else {
      const tvx = c.mx * spec.speed, tvy = c.my * spec.speed;
      let ddx = tvx - p.vx, ddy = tvy - p.vy;
      const dl = Math.hypot(ddx, ddy), maxd = spec.accel * dt;
      if (dl > maxd) { ddx *= maxd / dl; ddy *= maxd / dl; }
      p.vx += ddx; p.vy += ddy;
    }
  }
  p.x = clamp(p.x + p.vx * dt, spec.radius, W - spec.radius);
  p.y = clamp(p.y + p.vy * dt, spec.radius, H - spec.radius);
  p.ax = c.aimx; p.ay = c.aimy;
}
