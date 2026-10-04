import { W, H, GA } from './config.js';
import { Population } from './nn.js';
import { Trainer, Duel, probe, describeLearning } from './trainer.js';
import { DEFAULT_MODEL, insights } from './playermodel.js';
import { Renderer } from './render.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const $ = id => document.getElementById(id);
const R = new Renderer($('c'));
const audio = new Audio();
const ui = new UI(R);

let pop, trainer, game;
function freshAI() {
  pop = new Population();
  trainer = new Trainer(pop);
  trainer.start({ ...DEFAULT_MODEL }, 12); // warm-up vs a generic human
  while (trainer.update(50));
  trainer.totalDuels = 0;
  if (game) { game.pop = pop; } else game = new Game(R, audio, ui, pop);
  game.model = { ...DEFAULT_MODEL };
}
freshAI();

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
  if (k === 'm') audio.toggleMute();
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
addEventListener('mousedown', e => { if (e.target.closest('button')) return; if (e.button === 0) mouse.down = true; if (e.button === 2) input.dash = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { keys.clear(); mouse.down = false; if (state === 'play' && !paused) togglePause(); });

function readInput() {
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

function startRun() {
  audio.init(); audio.startMusic();
  if (state === 'over') freshAI();
  else { game.model = { ...DEFAULT_MODEL }; }
  ui.show('title', false); ui.show('over', false); ui.show('lab', false); ui.show('hud', true);
  game.reset(false);
  game.rec.reset();
  state = 'play'; paused = false; scan = false; ui.show('brain', false);
  game.startWave(1);
}

function togglePause() { paused = !paused; ui.show('pause', paused); }
function toggleScan() { scan = !scan; ui.show('brain', scan); document.body.classList.toggle('scanning', scan); if (!scan) game.scan = null; }

// ---------------- the Neural Lab ----------------
let lab = null;
function enterLab() {
  state = 'lab'; scan = false; ui.show('brain', false); document.body.classList.remove('scanning');
  const prev = game.model;
  const model = game.model = game.rec.fit(prev);
  const before = probe(pop.champion, model);
  trainer.start(model, GA.gensPerWave);
  lab = { t: 0, model, prev, before, duel: null, fx: [], done: false, lastGen: pop.generation };
  newFeatured();
  ui.show('hud', false); ui.show('lab', true);
  $('labtitle').textContent = 'ANALYZING YOU';
  $('labsub').textContent = `wave ${game.wave} cleared · ${model.samples} behaviour samples captured · model ${prev.generic ? 'initialised' : 'updated'}`;
  $('insights').innerHTML = insights(model).map((s, i) => `<li style="animation-delay:${0.3 + i * 0.25}s">${s}</li>`).join('');
  $('learned').innerHTML = '<li class="wait">waiting for evolution to finish…</li>';
  $('champ').innerHTML = '';
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
  if (lab.t > 0.6 && trainer.running) trainer.update(6);
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
  $('lgen').textContent = pop.generation;
  $('lduels').textContent = trainer.totalDuels.toLocaleString('en-US');
  const last = pop.history[pop.history.length - 1];
  $('lfit').textContent = last ? Math.round(last.best) : '—';
  $('lbar').style.width = `${Math.round(Math.min(1, trainer.progress) * 100)}%`;
  if (!trainer.running && !lab.done) {
    lab.done = true;
    const after = probe(pop.champion, lab.model);
    $('learned').innerHTML = describeLearning(lab.before, after, lab.model).map((s, i) => `<li style="animation-delay:${i * 0.22}s">${s}</li>`).join('');
    const ph = pop.champion.pheno;
    $('champ').innerHTML = `<span style="color:hsl(${ph.hue},100%,65%)">◆ CHAMPION #${pop.champion.id}</span> · gen ${pop.generation} · fitness ${Math.round(pop.champion.fitness || last?.best || 0)}`;
    $('deploy').disabled = false; $('deploy').textContent = `DEPLOY WAVE ${game.wave + 1} ▶`;
    audio.wave();
  }
}
function deploy() {
  ui.show('lab', false); ui.show('hud', true);
  game.pb.length = 0; game.eb.length = 0;
  state = 'play';
  game.startWave(game.wave + 1);
}

function gameOver() {
  state = 'over'; ui.show('hud', false); ui.show('brain', false); scan = false;
  let best = 0;
  try { best = +localStorage.getItem('overfit-best') || 0; if (game.score > best) localStorage.setItem('overfit-best', String(game.score)); } catch (e) { /* storage blocked */ }
  const m = game.rec.fit(game.model);
  $('ostats').innerHTML = [
    ['SCORE', game.score.toLocaleString('en-US')], ['WAVE', game.wave], ['KILLS', game.kills],
    ['AI GENERATIONS', pop.generation], ['DUELS VS YOUR SHADOW', trainer.totalDuels.toLocaleString('en-US')], ['BEST', Math.max(best, game.score).toLocaleString('en-US')],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('ohabit').innerHTML = `What gave you away: ${insights(m)[0] || 'nothing — you were unreadable'}`;
  ui.show('over', true);
  audio.stopMusic();
}

// ---------------- main loop ----------------
let last = performance.now(), overT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(0.05, (now - last) / 1000); last = now;
  let scale = 1;
  if (state === 'play' && paused) scale = 0;
  else if (scan) scale = 0.1;
  else if (game.hitstop > 0) scale = 0.08;
  else if (game.slowmo > 0) scale = 0.3;
  const dt = real * scale;

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
      game.scan = best; ui.brain($('brainc'), best);
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
