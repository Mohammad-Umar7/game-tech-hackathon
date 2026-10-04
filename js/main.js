import { W, H, GA } from './config.js';
import { Population } from './nn.js';
import { Trainer, Duel, probe, describeLearning } from './trainer.js';
import { DEFAULT_MODEL, insights } from './playermodel.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { encodeHunters, decodeHunters } from './share.js';

const $ = id => document.getElementById(id);
const R = new Renderer($('c'));
const audio = new Audio();
const ui = new UI(R);

let pop, trainer, game, warmBrains = null;
function freshAI() {
  pop = new Population();
  trainer = new Trainer(pop);
  if (!warmBrains) { // warm-up vs a generic human, once per page load
    trainer.start({ ...DEFAULT_MODEL }, 12);
    while (trainer.update(50));
    warmBrains = pop.genomes.map(g => g.genes.slice());
  } else pop.seed(warmBrains, 12);
  trainer.totalDuels = 0;
  if (game) { game.pop = pop; } else game = new Game(R, audio, ui, pop);
  game.model = { ...DEFAULT_MODEL };
  game.curve = [];
  if (incoming) pop.seed(incoming.genes, incoming.generation);
}
const incoming = (() => { const m = location.hash.match(/nemesis=([\w-]+)/); return m ? decodeHunters(m[1]) : null; })();
freshAI();
try { const b = +localStorage.getItem('overfit-best') || 0; if (b > 0) { $('best').textContent = `YOUR BEST · ${b.toLocaleString('en-US')}`; ui.show('best', true); } } catch (e) { /* storage blocked */ }
if (incoming) {
  $('incoming').innerHTML = `⚠ INCOMING NEMESIS — a friend sent you hunters evolved over <b>${incoming.generation}+ generations</b> against <b>their</b> shadow (they reached wave ${incoming.wave}). Survive them.`;
  ui.show('incoming', true);
}

const AUTO = new URLSearchParams(location.search).has('autodemo');
const BOT = AUTO || new URLSearchParams(location.search).has('bot');
if (AUTO) { document.body.classList.add('autodemo'); R.post.uniforms.uGrain.value = 0; }
if (new URLSearchParams(location.search).has('nocap')) document.body.classList.add('nocap');
let state = 'title', paused = false, scan = false, demoWave = 1;
game.reset(true); game.startWave(1);

// ---------------- input ----------------
const keys = new Set();
const input = { mx: 0, my: 0, wx: W / 2, wy: H / 2, fire: false, dash: false, nova: false };
let mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (e.repeat) return;
  keys.add(k);
  if (k === 'shift') input.dash = true;
  if (k === 'e' || k === 'q') input.nova = true;
  if (k === 'm') { const m = audio.toggleMute(); if (state === 'play') { caption(m ? '🔇 sound off · <b>M</b> to unmute' : '🔊 sound on'); clearTimeout(hintT); hintT = setTimeout(() => caption(''), 1400); } }
  if (k === 'b' && state === 'play') toggleScan();
  if ((k === 'p' || k === 'escape') && state === 'play') togglePause();
  if (k === 'enter') {
    if (state === 'title') startRun();
    else if (state === 'lab' && !$('deploy').disabled) deploy();
    else if (state === 'over') startRun();
  }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
const TOUCH = matchMedia('(pointer: coarse)').matches;
if (TOUCH) document.body.classList.add('touch');
let stick = null;
addEventListener('mousedown', e => { if (TOUCH || e.target.closest('button')) return; if (e.button === 0) mouse.down = true; if (e.button === 2) input.dash = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { keys.clear(); mouse.down = false; if (state === 'play' && !paused) togglePause(); });

const onUI = t => t.target && t.target.closest && t.target.closest('button, input, a, .overlay:not(.hidden)');
addEventListener('touchstart', e => {
  let mine = false;
  for (const t of e.changedTouches) {
    if (onUI(t)) continue;
    mine = true;
    if (state === 'play' && !stick && t.clientX < innerWidth * 0.65) stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
  }
  if (mine && state === 'play' && e.cancelable) e.preventDefault(); // no scroll / zoom / pull-to-refresh hijacking the stick
}, { passive: false });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (stick && t.identifier === stick.id) { stick.x = t.clientX; stick.y = t.clientY; }
  if (state === 'play' && e.cancelable) e.preventDefault();
}, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) if (stick && t.identifier === stick.id) stick = null; };
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
const tap = (id, fn) => $(id).addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
tap('tdash', () => (input.dash = true)); tap('tnova', () => (input.nova = true)); tap('tscan', () => state === 'play' && toggleScan());

function readTouch() {
  const el = $('stick');
  if (stick) {
    const R_STICK = 64, DEAD = 6;
    let dx = stick.x - stick.ox, dy = stick.y - stick.oy; let l = Math.hypot(dx, dy);
    if (l > R_STICK) { stick.ox = stick.x - dx / l * R_STICK; stick.oy = stick.y - dy / l * R_STICK; dx = stick.x - stick.ox; dy = stick.y - stick.oy; l = R_STICK; }
    const m = l < DEAD ? 0 : Math.min(1, (l - DEAD) / (R_STICK * 0.6 - DEAD)); // full speed at 60% throw = snappy
    // screen direction -> world direction (works for any camera orientation)
    const cx = innerWidth / 2, cy = innerHeight / 2, a = R.screenToWorld(cx, cy), b = l ? R.screenToWorld(cx + dx / l * 80, cy + dy / l * 80) : null;
    if (a && b) { const wx = b.x - a.x, wy = b.y - a.y, wl = Math.hypot(wx, wy) || 1; input.mx = wx / wl * m; input.my = wy / wl * m; }
    else { input.mx = 0; input.my = 0; }
    el.style.display = 'block'; el.style.left = stick.ox + 'px'; el.style.top = stick.oy + 'px';
    el.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  } else { input.mx = input.my = 0; el.style.display = 'none'; }
  const p = game.player, t = game.nearestEnemy(p.x, p.y);
  if (t) { input.wx = t.x + (t.vx || 0) * 0.12; input.wy = t.y + (t.vy || 0) * 0.12; input.fire = true; } else input.fire = false;
}

function readInput() {
  if (TOUCH) return readTouch();
  let x = 0, y = 0;
  if (keys.has('a') || keys.has('arrowleft')) x--;
  if (keys.has('d') || keys.has('arrowright')) x++;
  if (keys.has('w') || keys.has('arrowup')) y--;
  if (keys.has('s') || keys.has('arrowdown')) y++;
  const l = Math.hypot(x, y) || 1;
  input.mx = x / l; input.my = y / l;
  const w = R.screenToWorld(mouse.x, mouse.y);
  if (w) { input.wx = w.x; input.wy = w.y; }
  input.fire = mouse.down || keys.has(' ');
}

// ---------------- flow ----------------
$('play').onclick = () => startRun();
$('retry').onclick = () => startRun();
$('deploy').onclick = () => deploy();
$('resume').onclick = () => togglePause();
$('share').onclick = async () => {
  const src = (pop.lastGen || pop.genomes).slice().sort((a, b) => b.fitness - a.fitness);
  const url = `${location.origin}${location.pathname}#nemesis=${encodeHunters(src, pop.generation, game.wave)}`;
  try { await navigator.clipboard.writeText(url); $('share').textContent = '✓ LINK COPIED — send it to a friend'; }
  catch (e) { prompt('Copy this link and send it to a friend:', url); }
};
$('export').onclick = () => {
  const ch = pop.champion;
  const data = { format: 'overfit-hunter-brain/v1', topology: { inputs: 13, hidden: 12, outputs: 7, activation: 'tanh' },
    inputs: ['range', 'target_v_radial', 'target_v_tangential', 'self_v_radial', 'self_v_tangential', 'target_aim_alignment', 'bullet_threat', 'dodge_side', 'ally_radial', 'ally_tangential', 'hull', 'memory', 'wall'],
    outputs: ['charge', 'strafe', 'fire', 'lead', 'spread', 'dash', 'memory'],
    generation: pop.generation, champion: ch.id, lineage: ch.lineage, fitness: pop.history.at(-1)?.best ?? null,
    trainedAgainst: game.model, duelsSimulated: trainer.totalDuels, genes: Array.from(ch.genes, v => +v.toFixed(5)) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `overfit-hunter-gen${pop.generation}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

function startRun() {
  audio.init(); audio.startMusic();
  if (state === 'over') freshAI();
  else { game.model = { ...DEFAULT_MODEL }; }
  ui.show('title', false); ui.show('over', false); ui.show('lab', false); ui.show('hud', true); ui.show('touch', TOUCH);
  game.reset(false);
  game.autopilot = BOT; game.godmode = AUTO;
  game.rec.reset();
  state = 'play'; paused = false; scan = false; ui.show('brain', false);
  game.startWave(1);
  if (!BOT) {
    caption(TOUCH ? 'Drag to <b>move</b> · firing is <b>automatic</b> · <b>DASH</b> through bullets'
                  : '<b>WASD</b> move · <b>MOUSE</b> aim · <b>HOLD CLICK</b> fire · <b>SHIFT</b> dash · <b>E</b> nova · <b>B</b> brain scan');
    clearTimeout(hintT); hintT = setTimeout(() => caption(''), TOUCH ? 4500 : 6500);
  }
}

function togglePause() { paused = !paused; ui.show('pause', paused); }
function toggleScan() { scan = !scan; ui.show('brain', scan); document.body.classList.toggle('scanning', scan); if (!scan) game.scan = null; }

// ---------------- the Neural Lab ----------------
let lab = null;
function enterLab() {
  ui.show('touch', false); stick = null;
  state = 'lab'; scan = false; ui.show('brain', false); document.body.classList.remove('scanning');
  const prev = game.model;
  const model = game.model = game.rec.fit(prev);
  const before = probe(pop.champion, model);
  trainer.start(model, GA.gensPerWave);
  lab = { t: 0, model, prev, before, beforeGenome: pop.champion, duel: null, fx: [], done: false, lastGen: pop.generation };
  newFeatured();
  ui.show('hud', false); ui.show('lab', true);
  $('labtitle').textContent = 'ANALYZING YOU';
  $('labsub').textContent = `wave ${game.wave} cleared · ${model.samples} behaviour samples captured · model ${prev.generic ? 'initialised' : 'updated'}`;
  $('insights').innerHTML = insights(model).map((s, i) => `<li style="animation-delay:${0.3 + i * 0.25}s">${s}</li>`).join('');
  $('learned').innerHTML = '<li class="wait">waiting for evolution to finish…</li>';
  $('champ').innerHTML = '';
  ui.show('export', false);
  $('deploy').disabled = true; $('deploy').textContent = 'TRAINING…';
  game.player.hp = Math.min(game.player.maxHp, game.player.hp + 1);
  audio.glitch();
}
function newFeatured() {
  const d = new Duel(pop.champion, lab.model, (Math.random() * 1e9) | 0);
  d.events = [];
  lab.duel = d;
}
function updateLab(dt) {
  lab.t += dt;
  if (lab.t > 0.6 && trainer.running) trainer.update(TOUCH ? 4 : 6);
  if (pop.generation !== lab.lastGen) { lab.lastGen = pop.generation; audio.tick(trainer.progress); }
  if (lab.t > 0.9) $('labtitle').textContent = trainer.running ? 'EVOLVING COUNTER-STRATEGIES' : 'HUNTERS READY';
  // featured duel at 2× speed
  const d = lab.duel;
  for (let i = 0; i < 2; i++) if (!d.tick()) { newFeatured(); break; }
  for (const e of d.events) lab.fx.push({ x: e.x, y: e.y, r: e.t === 'boom' ? 70 : 26, life: 0.5, max: 0.5, col: e.t === 'ghosthit' ? 'rgba(80,240,255,A)' : e.t === 'boom' ? 'rgba(255,120,220,A)' : 'rgba(255,220,120,A)' });
  d.events.length = 0;
  lab.fx = lab.fx.filter(f => (f.life -= dt) > 0);
  ui.radar($('radar'), lab.model, lab.prev, Math.min(1, lab.t / 0.8));
  ui.arena($('arena'), d, lab.fx);
  ui.fitness($('fitness'), pop.history);
  if (trainer.running) ui.genePool($('pool'), pop.genomes, trainer.idx, null);
  else ui.genePool($('pool'), pop.lastGen || pop.genomes, (pop.lastGen || pop.genomes).length, pop.champion);
  $('lgen').textContent = pop.generation;
  $('lduels').textContent = trainer.totalDuels.toLocaleString('en-US');
  const last = pop.history[pop.history.length - 1];
  $('lfit').textContent = last ? Math.round(last.best) : '—';
  $('lbar').style.width = `${Math.round(Math.min(1, trainer.progress) * 100)}%`;
  if (!trainer.running && !lab.done) {
    lab.done = true;
    const after = probe(pop.champion, lab.model);
    if (!game.curve.length) game.curve.push({ genome: lab.beforeGenome, label: 'START' });
    game.curve.push({ genome: pop.champion, label: `W${game.wave}` });
    $('learned').innerHTML = describeLearning(lab.before, after, lab.model).map((s, i) => `<li style="animation-delay:${i * 0.22}s">${s}</li>`).join('');
    const ph = pop.champion.pheno;
    $('champ').innerHTML = `<span style="color:hsl(${ph.hue},100%,65%)">◆ CHAMPION #${pop.champion.id}</span> · gen ${pop.generation} · fitness ${Math.round(pop.champion.fitness || last?.best || 0)}`;
    $('deploy').disabled = false; $('deploy').textContent = `DEPLOY WAVE ${game.wave + 1} ▶`;
    ui.show('export', true);
    audio.wave();
  }
}
function deploy() {
  ui.show('lab', false); ui.show('hud', true); ui.show('touch', TOUCH);
  game.pb.length = 0; game.eb.length = 0;
  state = 'play';
  game.startWave(game.wave + 1);
}

function gameOver() {
  state = 'over'; ui.show('hud', false); ui.show('touch', false); stick = null; ui.show('brain', false); scan = false;
  let best = 0;
  try { best = +localStorage.getItem('overfit-best') || 0; if (game.score > best && !BOT) localStorage.setItem('overfit-best', String(game.score)); } catch (e) { /* storage blocked */ }
  const m = game.rec.fit(game.model);
  $('ostats').innerHTML = [
    ['SCORE', game.score.toLocaleString('en-US')], ['WAVE', game.wave], ['KILLS', game.kills],
    ['AI GENERATIONS', pop.generation], ['DUELS VS YOUR SHADOW', trainer.totalDuels.toLocaleString('en-US')], ['BEST', Math.max(best, game.score).toLocaleString('en-US')],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('ohabit').innerHTML = `What gave you away: ${insights(m)[0] || 'nothing — you were unreadable'}`;
  const cv = (game.curve || []).slice(-8);
  for (const c of cv) c.acc = probe(c.genome, m, 4).acc; // every wave's champion vs the FINAL model of you
  const mx = Math.max(0.01, ...cv.map(c => c.acc));
  $('curve').innerHTML = cv.length > 1 ? `<div class="cl">EACH WAVE'S CHAMPION<br>vs YOUR FINAL SHADOW<br><b>SHOTS ON TARGET</b></div>` + cv.map(c => `<div><b>${Math.round(c.acc * 100)}%</b><i style="height:${Math.max(4, c.acc / mx * 56)}px"></i>${c.label}</div>`).join('') : '';
  $('share').textContent = '⚔ SEND YOUR HUNTERS TO A FRIEND';
  ui.show('over', true);
  audio.stopMusic();
}

// ---------------- cinematic autodemo (for the trailer) ----------------
let ad = { step: 0, t: 0, t0: 0 }, spect = { t: 0, state: '' }, hintT = 0;
function caption(html) {
  const el = $('caption');
  el.classList.remove('show'); void el.offsetWidth;
  el.classList.toggle('top', state === 'lab');
  if (html) { el.style.opacity = ''; el.innerHTML = html; el.classList.add('show'); } else el.style.opacity = 0;
}
function autodemo(real) {
  ad.t += real;
  const since = ad.t - ad.t0, next = () => { (window.__marks ||= []).push({ step: ad.step, t: Date.now() / 1000 }); ad.step++; ad.t0 = ad.t; };
  switch (ad.step) {
    case 0: if (since > 4.5) { startRun(); window.__audioStart = audio.recordStart(); caption('Every enemy is a <b>neural network</b>. Every move you make is being <b>recorded</b>.'); next(); } break;
    case 1: if (since > 6 && game.hunters.some(h => h.spawnT <= 0)) { toggleScan(); caption('<b>Brain scan</b>: watch a hunter’s network fire in real time — inputs → decisions'); next(); } break;
    case 2: if (since > 4.2) { toggleScan(); caption(''); next(); } break;
    case 3: if (state === 'lab') { caption('Between waves it fits a <b>behavioural model of you</b>: range, orbit, jukes, aim…'); next(); } break;
    case 4: if (since > 2.6) { caption('…then evolves its hunters through <b>~2,000 simulated duels vs your clone</b> — live, in your browser'); next(); } break;
    case 5: if (lab && lab.done) { caption('…and explains <b>exactly what it learned</b> about you'); next(); } break;
    case 6: if (since > 4.5) { deploy(); caption('The survivors come for you.'); next(); } break;
    case 7: if (since > 3.5) caption(''); if (state === 'lab') { caption('Every generation gets better at beating <b>you specifically</b>'); next(); } break;
    case 8: if (lab && lab.done && since > 3) { deploy(); caption('Every 3rd wave: <b>SHADOW.EXE</b> — a clone of your own behaviour joins the hunt'); next(); } break;
    case 9:
      if (since > 4) caption('');
      if (game.shadow && since > 14) game.shadow.hp = Math.min(game.shadow.hp, 3);
      if (since > 6 && !game.shadow && game.state !== 'wave') { caption('Beat it by being <b>unpredictable</b> — go out-of-distribution for bonus score'); next(); }
      break;
    case 10: if (since > 4) { caption(''); ui.show('endcard', true); ui.show('hud', false); ui.show('lab', false); next(); } break;
    case 11: if (since > 6) { next(); audio.recordStop().then(b => { window.__audioB64 = b; window.__demoDone = true; }); } break;
  }
}

// ---------------- main loop ----------------
let last = performance.now(), overT = 0, perf = { acc: 0, n: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  perf.acc += real; perf.n++;
  if (perf.n >= 120) { if (perf.acc / perf.n > 0.036 && !document.hidden) R.lowerQuality(); perf.acc = 0; perf.n = 0; }
  let scale = 1;
  if (state === 'play' && paused) scale = 0;
  else if (scan) scale = TOUCH ? 0.25 : 0.12;
  else if (game.hitstop > 0) scale = 0.08;
  else if (game.slowmo > 0) scale = 0.45;
  const dt = real * scale;
  // slow-mo / hit-pause last REAL seconds, so controls never feel sticky
  game.slowmo = Math.max(0, game.slowmo - real); game.hitstop = Math.max(0, game.hitstop - real);

  if (AUTO) autodemo(real);
  else if (BOT) { // spectator mode: the AI pilot plays forever, the hunters keep learning its style
    spect.t += real;
    if (state !== spect.state) { spect.state = state; spect.t = 0; }
    if (state === 'title' && spect.t > 2.5) startRun();
    if (state === 'lab' && lab && lab.done && spect.t > 9) deploy();
    if (state === 'over' && spect.t > 6) startRun();
  }
  if (state === 'title') {
    game.update(real * (game.slowmo > 0 ? 0.4 : 1), input);
    if (game.state === 'cleared') { demoWave = demoWave % 4 + 1; game.startWave(demoWave); }
    audio.updateMusic(0.2);
  } else if (state === 'play') {
    readInput();
    if (dt > 0) game.update(dt, input);
    input.dash = false; input.nova = false;
    if (scan) {
      let best = null, bd = 1e18;
      for (const h of game.hunters) { const d = (h.x - input.wx) ** 2 + (h.y - input.wy) ** 2; if (d < bd && h.spawnT <= 0) { bd = d; best = h; } }
      game.scan = best; ui.brain($('brainc'), best, game.model, !!game.shadow);
    }
    ui.hud(game, pop, trainer);
    audio.updateMusic(Math.min(1, 0.3 + game.wave * 0.12 + game.hunters.length * 0.04 + (game.shadow ? 0.4 : 0)));
    if (game.state === 'cleared') enterLab();
    if (game.state === 'dead') { overT += real; if (overT > 2.2) { overT = 0; gameOver(); } }
  } else if (state === 'lab') {
    updateLab(real);
    audio.updateMusic(0.15);
  }
  const p = game.player;
  R.update(state === 'lab' ? real : dt || (paused ? 0 : real), p ? p.x : W / 2, p ? p.y : H / 2);
  game.sync();
  R.render();
}
document.getElementById('loading')?.remove();
requestAnimationFrame(frame);
window.__overfit = { game, R, get pop() { return pop; }, get trainer() { return trainer; } };
