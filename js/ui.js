// DOM overlays: HUD, Neural Lab interstitial, live brain scan, banners, popups.
import { W, H, NN, INPUT_LABELS, OUTPUT_LABELS } from './config.js';
import { w1, w2 } from './nn.js';
import { fingerprint } from './playermodel.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('en-US');

export class UI {
  constructor(R) {
    this.R = R;
    this.pop = [];
    const host = $('popups');
    for (let i = 0; i < 40; i++) { const d = document.createElement('div'); d.className = 'popup'; host.appendChild(d); this.pop.push(d); }
    this.pi = 0;
    this.bannerT = null;
    this.hpCache = ''; this.novaCache = '';
  }
  show(id, on = true) { $(id).classList.toggle('hidden', !on); }

  popup(x, y, text, cls = '') {
    const s = this.R.worldToScreen(x, y, 30);
    const d = this.pop[this.pi]; this.pi = (this.pi + 1) % this.pop.length;
    d.className = 'popup'; void d.offsetWidth;
    d.textContent = text; d.style.left = s.x + 'px'; d.style.top = s.y + 'px';
    d.className = 'popup show ' + cls;
  }
  banner(title, sub = '', cls = '') {
    const b = $('banner');
    b.querySelector('h1').textContent = title; b.querySelector('h1').dataset.text = title;
    b.querySelector('p').textContent = sub;
    b.className = ''; void b.offsetWidth; b.className = 'show ' + cls;
    clearTimeout(this.bannerT); this.bannerT = setTimeout(() => (b.className = ''), 2200);
  }
  bossIntro(model) {
    const el = $('bossintro');
    const fp = fingerprint(model).map(([k, v]) => `${k} ${'█'.repeat(Math.round(v * 10))}${'░'.repeat(10 - Math.round(v * 10))}`).join('<br>');
    el.querySelector('.bi-sub').innerHTML = model.generic ? 'trained on a generic human' : `cloned from <b>${fmt(model.samples)}</b> samples of your movement`;
    el.querySelector('.bi-fp').innerHTML = fp;
    el.className = 'show';
    setTimeout(() => (el.className = 'hidden'), 2600);
  }

  hud(g, pop, trainer) {
    $('score').textContent = fmt(g.score);
    $('mult').textContent = `×${g.mult}`;
    $('mult').classList.toggle('hot', g.mult >= 4);
    $('wave').textContent = g.boss ? `WAVE ${g.wave} · SHADOW` : `WAVE ${g.wave}`;
    $('gen').textContent = `AI GEN ${pop.generation} · ${fmt(trainer.totalDuels)} DUELS SIMULATED`;
    const left = g.hunters.length + (g.spawnQ || []).filter(s => s.kind === 'hunter').length;
    const lt = g.state !== 'wave' ? 'WAVE CLEARED' : g.shadow || (g.spawnQ || []).some(s => s.kind === 'shadow') ? `KILL YOUR <b>SHADOW</b>${left ? ` + <b>${left}</b> HUNTERS` : ''}` : `◆ <b>${left}</b> HUNTER${left === 1 ? '' : 'S'} LEFT`;
    if (lt !== this.leftCache) { this.leftCache = lt; $('left').innerHTML = lt; }
    const p = g.player;
    const hp = `${p.hp}/${p.maxHp}`;
    if (hp !== this.hpCache) {
      this.hpCache = hp;
      $('hp').innerHTML = Array.from({ length: p.maxHp }, (_, i) => `<i class="${i < p.hp ? 'on' : ''}"></i>`).join('');
    }
    const nv = String(p.novas);
    if (nv !== this.novaCache) { this.novaCache = nv; $('novas').innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="${i < p.novas ? 'on' : ''}"></i>`).join('') + '<span>NOVA [E]</span>'; }
    const o = g.ood;
    $('oodbar').style.width = `${Math.round(o * 100)}%`;
    $('oodtxt').textContent = o > 0.66 ? `OUT OF DISTRIBUTION · SCORE ×${(1 + o).toFixed(1)}` : o > 0.33 ? `DRIFTING · SCORE ×${(1 + o).toFixed(1)}` : 'PREDICTABLE · they expect this';
    $('ood').classList.toggle('hot', o > 0.66);
    if (g.shadow && g.shadow.spawnT <= 0) {
      this.show('bossbar', true);
      $('bossfill').style.width = `${Math.max(0, g.shadow.hp / g.shadow.maxHp) * 100}%`;
    } else this.show('bossbar', false);
  }

  // ---------------- radar + charts ----------------
  radar(canvas, model, prevModel, t = 1) {
    const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 4, R = Math.min(w, h) * 0.34;
    const fp = fingerprint(model), n = fp.length;
    const ang = i => -Math.PI / 2 + (i / n) * Math.PI * 2;
    c.strokeStyle = 'rgba(140,120,255,0.22)'; c.lineWidth = 1;
    for (let r = 1; r <= 4; r++) { c.beginPath(); for (let i = 0; i <= n; i++) { const a = ang(i % n); c.lineTo(cx + Math.cos(a) * R * r / 4, cy + Math.sin(a) * R * r / 4); } c.stroke(); }
    for (let i = 0; i < n; i++) { const a = ang(i); c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke(); }
    const poly = (vals, fill, stroke, k) => {
      c.beginPath();
      vals.forEach((v, i) => { const a = ang(i), rr = R * (0.08 + 0.92 * v * k); c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); });
      c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = stroke; c.lineWidth = 2; c.shadowColor = stroke; c.shadowBlur = 14; c.stroke(); c.shadowBlur = 0;
    };
    if (prevModel && !prevModel.generic) poly(fingerprint(prevModel).map(f => f[1]), 'rgba(255,60,160,0.08)', 'rgba(255,60,160,0.5)', 1);
    poly(fp.map(f => f[1]), 'rgba(40,230,255,0.18)', '#3cf0ff', t);
    c.font = '600 11px "Chakra Petch", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fp.forEach(([k, v], i) => { const a = ang(i); c.fillStyle = '#cfc8ff'; c.fillText(k, cx + Math.cos(a) * (R + 22), cy + Math.sin(a) * (R + 16)); c.fillStyle = '#3cf0ff'; c.fillText(Math.round(v * 100), cx + Math.cos(a) * (R + 22), cy + Math.sin(a) * (R + 16) + 13); });
  }
  fitness(canvas, history) {
    const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    if (history.length < 2) return;
    const hs = history.slice(-60);
    const max = Math.max(...hs.map(e => e.best)) * 1.1 || 1, min = Math.min(0, ...hs.map(e => e.avg));
    const X = i => 4 + (i / (hs.length - 1)) * (w - 8), Y = v => h - 6 - ((v - min) / (max - min)) * (h - 14);
    const line = (key, col, fill) => {
      c.beginPath(); hs.forEach((e, i) => c.lineTo(X(i), Y(e[key])));
      if (fill) { c.lineTo(X(hs.length - 1), h); c.lineTo(X(0), h); c.closePath(); c.fillStyle = fill; c.fill(); c.beginPath(); hs.forEach((e, i) => c.lineTo(X(i), Y(e[key]))); }
      c.strokeStyle = col; c.lineWidth = 2; c.shadowColor = col; c.shadowBlur = 10; c.stroke(); c.shadowBlur = 0;
    };
    line('avg', 'rgba(255,80,190,0.9)', 'rgba(255,80,190,0.08)');
    line('best', '#ffd23c');
    c.font = '600 10px "Chakra Petch", monospace'; c.fillStyle = '#ffd23c'; c.fillText('BEST', 8, 12); c.fillStyle = '#ff50be'; c.fillText('AVERAGE', 44, 12);
  }
  genePool(canvas, gs, evaluated, champ) {
    const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    c.clearRect(0, 0, w, h);
    const cols = 11, rows = Math.ceil(gs.length / cols), cw = w / cols, ch = h / rows;
    let max = 1; for (let i = 0; i < evaluated; i++) max = Math.max(max, gs[i].fitness);
    gs.forEach((g, i) => {
      const cx = (i % cols + 0.5) * cw, cy = ((i / cols | 0) + 0.5) * ch, ph = g.pheno;
      const done = i < evaluated, f = done ? Math.max(0.08, g.fitness / max) : 0.18;
      c.save(); c.translate(cx, cy); c.rotate(-Math.PI / 2);
      c.strokeStyle = `hsla(${ph.hue},100%,62%,${0.25 + f * 0.75})`; c.shadowColor = c.strokeStyle; c.shadowBlur = done ? 14 * f : 0; c.lineWidth = 1.6;
      c.beginPath();
      for (let k = 0; k <= ph.spikes * 2; k++) { const a = k / (ph.spikes * 2) * Math.PI * 2, r = (k % 2 ? ph.inner : (k === 0 ? 1.3 : 1)) * 13; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.stroke(); c.restore();
      if (g === champ) { c.strokeStyle = '#ffd23c'; c.shadowColor = '#ffd23c'; c.shadowBlur = 10; c.lineWidth = 1.5; c.strokeRect(cx - cw / 2 + 2, cy - ch / 2 + 2, cw - 4, ch - 4); c.shadowBlur = 0; }
    });
  }
  // mini arena of the featured duel
  arena(canvas, duel, fx) {
    const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height, sx = w / W, sy = h / H;
    c.fillStyle = 'rgba(6,4,18,0.55)'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(120,90,255,0.18)'; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 100) { c.beginPath(); c.moveTo(x * sx, 0); c.lineTo(x * sx, h); c.stroke(); }
    for (let y = 0; y <= H; y += 100) { c.beginPath(); c.moveTo(0, y * sy); c.lineTo(w, y * sy); c.stroke(); }
    c.globalCompositeOperation = 'lighter';
    for (const b of duel.gb) { c.fillStyle = '#ffe680'; c.fillRect(b.x * sx - 1.5, b.y * sy - 1.5, 3, 3); }
    for (const b of duel.hb) { c.fillStyle = '#ff4fa8'; c.beginPath(); c.arc(b.x * sx, b.y * sy, 2.4, 0, 7); c.fill(); }
    const hue = duel.genome.pheno.hue;
    for (const hh of duel.hunters) {
      if (hh.dead) continue;
      c.save(); c.translate(hh.x * sx, hh.y * sy); c.rotate(hh.heading);
      c.strokeStyle = `hsl(${hue},100%,62%)`; c.shadowColor = c.strokeStyle; c.shadowBlur = 10; c.lineWidth = 2;
      c.beginPath(); const sp = duel.genome.pheno.spikes;
      for (let i = 0; i <= sp * 2; i++) { const a = i / (sp * 2) * Math.PI * 2, r = i % 2 ? 4 : 9; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.stroke(); c.restore();
    }
    const g = duel.ghost;
    c.save(); c.translate(g.x * sx, g.y * sy); c.rotate(Math.atan2(g.cmd.aimy, g.cmd.aimx));
    c.strokeStyle = '#e8fbff'; c.shadowColor = '#3cf0ff'; c.shadowBlur = 16; c.lineWidth = 2;
    c.beginPath(); c.moveTo(11, 0); c.lineTo(-6, 6); c.lineTo(-2, 0); c.lineTo(-6, -6); c.closePath(); c.stroke(); c.restore();
    c.font = '600 10px "Chakra Petch", monospace'; c.fillStyle = '#bff8ff'; c.fillText('YOUR SHADOW', g.x * sx + 10, g.y * sy - 10);
    for (const e of fx) {
      const k = e.life / e.max;
      c.strokeStyle = e.col.replace('A', k.toFixed(2)); c.lineWidth = 2;
      c.beginPath(); c.arc(e.x * sx, e.y * sy, (1 - k) * e.r + 2, 0, 7); c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ---------------- live neural scan ----------------
  brain(canvas, h, model, shadow) {
    const c = canvas.getContext('2d'), w = canvas.width, hh = canvas.height;
    c.clearRect(0, 0, w, hh);
    if (!h) {
      if (shadow) {
        this.radar(canvas, model, null, 1);
        $('braininfo').innerHTML = `<b style="color:#ff2a4a">SHADOW.EXE</b> has no neural net — it runs the <b>behavioural model fitted to YOU</b>: holds ${Math.round(model.prefDist)}px, circles ${model.orbitDir > 0 ? 'counter-clockwise' : 'clockwise'}, jukes ${model.jukeRate.toFixed(1)}×/s. Do the opposite.`;
      } else $('braininfo').textContent = 'no hunter on the field — wait for the next warp-in';
      return;
    }
    const br = h.brain, g = br.g;
    const col = [92, w / 2 + 6, w - 92];
    const ys = (n, i) => 16 + (i + 0.5) * ((hh - 24) / n);
    c.globalCompositeOperation = 'lighter';
    for (let j = 0; j < NN.hidden; j++) for (let i = 0; i < NN.inputs; i++) {
      const wt = w1(g, j, i), a = Math.min(1, Math.abs(wt * br.in[i]) * 0.9);
      if (a < 0.06) continue;
      c.strokeStyle = wt * br.in[i] > 0 ? `rgba(60,240,255,${a})` : `rgba(255,70,170,${a})`;
      c.lineWidth = 0.6 + a * 2; c.beginPath(); c.moveTo(col[0], ys(NN.inputs, i)); c.lineTo(col[1], ys(NN.hidden, j)); c.stroke();
    }
    for (let j = 0; j < NN.outputs; j++) for (let i = 0; i < NN.hidden; i++) {
      const wt = w2(g, j, i), a = Math.min(1, Math.abs(wt * br.h[i]) * 0.9);
      if (a < 0.06) continue;
      c.strokeStyle = wt * br.h[i] > 0 ? `rgba(60,240,255,${a})` : `rgba(255,70,170,${a})`;
      c.lineWidth = 0.6 + a * 2; c.beginPath(); c.moveTo(col[1], ys(NN.hidden, i)); c.lineTo(col[2], ys(NN.outputs, j)); c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
    const node = (x, y, v, r = 6) => {
      const a = Math.min(1, Math.abs(v));
      c.fillStyle = v >= 0 ? `rgba(60,240,255,${0.15 + a * 0.85})` : `rgba(255,70,170,${0.15 + a * 0.85})`;
      c.shadowColor = c.fillStyle; c.shadowBlur = 12 * a; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.shadowBlur = 0;
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1; c.stroke();
    };
    c.font = '600 10px "Chakra Petch", monospace'; c.textBaseline = 'middle';
    for (let i = 0; i < NN.inputs; i++) { node(col[0], ys(NN.inputs, i), br.in[i]); c.fillStyle = '#bdb4ff'; c.textAlign = 'right'; c.fillText(INPUT_LABELS[i], col[0] - 11, ys(NN.inputs, i)); }
    for (let i = 0; i < NN.hidden; i++) node(col[1], ys(NN.hidden, i), br.h[i], 5);
    for (let i = 0; i < NN.outputs; i++) { node(col[2], ys(NN.outputs, i), br.o[i], 7); c.fillStyle = '#ffe9a8'; c.textAlign = 'left'; c.fillText(`${OUTPUT_LABELS[i]} ${br.o[i] >= 0 ? '+' : ''}${br.o[i].toFixed(2)}`, col[2] + 12, ys(NN.outputs, i)); }
    const gm = h.genome;
    $('braininfo').innerHTML = `<b style="color:hsl(${gm.pheno.hue},100%,65%)">HUNTER #${gm.id}</b> · born gen ${gm.gen} · lineage ${gm.lineage.toString(16).toUpperCase()}<br>` +
      `${h.cmd.fire ? '<span class="fire">● FIRING</span>' : '○ holding fire'} · lead ×${h.cmd.lead.toFixed(2)} · hull ${h.hp}/${h.maxHp}`;
  }
}
