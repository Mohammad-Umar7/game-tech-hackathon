// Shared constants + tiny math helpers used by the game AND the headless trainer.
export const W = 1600, H = 900;

export const PLAYER = {
  speed: 360, accel: 3200, radius: 16, hp: 6,
  fireCD: 0.085, bulletSpeed: 1150, bulletLife: 0.9,
  dashSpeed: 1250, dashTime: 0.15, dashCD: 0.85, invuln: 1.1,
};

export const HUNTER = {
  speed: 255, accel: 1500, radius: 19, hp: 4,
  fireCD: 0.8, bulletSpeed: 470, bulletLife: 2.6,
  dashSpeed: 780, dashTime: 0.18, dashCD: 2.0,
};

export const NN = { inputs: 13, hidden: 12, outputs: 7 };
export const GA = { pop: 32, elite: 4, mutRate: 0.13, mutSigma: 0.38, gensPerWave: 30 };

export const INPUT_LABELS = ['RANGE', 'YOUR V∥', 'YOUR V⊥', 'MY V∥', 'MY V⊥', 'YOUR AIM', 'BULLET', 'DODGE ↔', 'ALLY ∥', 'ALLY ⊥', 'HULL', 'MEMORY', 'WALL'];
export const OUTPUT_LABELS = ['CHARGE', 'STRAFE', 'FIRE', 'LEAD', 'SPREAD', 'DASH', 'MEMORY'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng = Math.random) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// distance from point (cx,cy) to segment (x1,y1)-(x2,y2), squared
export function segDist2(x1, y1, x2, y2, cx, cy) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
  return px * px + py * py;
}
