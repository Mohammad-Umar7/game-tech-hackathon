// Frame-by-frame analysis: runs the AI pilot (optionally as a throttled phone) and reports, per 5 s window,
// fps, worst frame, how much of the time the game was slowed/frozen (hit-stop, slow-mo, scan) and load.
// usage: node tools/perf.mjs [url] [seconds] [cpuThrottle] [phone 0|1]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_ = process.argv[2] || 'http://127.0.0.1:5173/?bot';
const SECS = +(process.argv[3] || 150), THROTTLE = +(process.argv[4] || 1), PHONE = process.argv[5] === '1';
const prof = join(tmpdir(), `overfit-perf-${Date.now()}`); mkdirSync(prof, { recursive: true });
const PORT = 9338;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--mute-audio', `--remote-debugging-port=${PORT}`, '--window-size=1280,720',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let t; for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (t.find(x => x.type === 'page')) break; } catch { } await sleep(200); }
const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map(), errs = [];
const send = (m, p = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description); });
await send('Runtime.enable'); await send('Page.enable');
if (PHONE) { await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await send('Page.navigate', { url: URL_ });
await sleep(3000);
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true }))?.result?.value;
await ev(`(() => {
  const s = window.__perf = { n: 0, sum: 0, max: 0, long: 0, slowed: 0, scan: 0 };
  let last = performance.now();
  const loop = now => { const d = now - last; last = now; s.n++; s.sum += d; if (d > s.max) s.max = d; if (d > 50) s.long++;
    const g = window.__overfit && window.__overfit.game; if (g && (g.hitstop > 0 || g.slowmo > 0)) s.slowed++;
    if (document.body.classList.contains('scanning')) s.scan++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop); return 1; })()`);
if (process.env.JUMP) { await sleep(4000); await ev(`window.__overfit.game.wave = ${+process.env.JUMP - 1}; 1`); }
if (process.env.KILL) { await sleep(6000); await ev(`(() => { const g = window.__overfit.game; for (let i = 0; i < 12; i++) { g.player.invuln = 0; g.player.dashT = 0; g.godmode = false; const a = g.autopilot; g.autopilot = false; g.damagePlayer(); g.autopilot = a; } return g.state; })()`); }
const t0 = Date.now();
console.log(`  t   wave state   fps  worstMs  >50ms  slowed%  ents bullets particles`);
while ((Date.now() - t0) / 1000 < SECS) {
  await sleep(5000);
  const v = await ev(`(() => { const s = window.__perf, o = window.__overfit, g = o.game; const fx = o.R.fx; let parts = 0; for (let i = 0; i < fx.N; i++) if (fx.p.life[i] > 0) parts++;
    const r = { wave: g.wave, st: g.state, fps: s.n ? Math.round(1000 / (s.sum / s.n)) : 0, max: Math.round(s.max), long: s.long, slowed: s.n ? Math.round(100 * s.slowed / s.n) : 0,
      ents: g.hunters.length + g.drones.length + (g.shadow ? 1 : 0), bul: g.eb.length + g.pb.length, parts };
    Object.assign(s, { n: 0, sum: 0, max: 0, long: 0, slowed: 0, scan: 0 }); return JSON.stringify(r); })()`);
  if (!v) continue;
  const r = JSON.parse(v);
  console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}  ${String(r.wave).padStart(3)}  ${r.st.padEnd(7)} ${String(r.fps).padStart(3)}  ${String(r.max).padStart(6)}  ${String(r.long).padStart(5)}  ${String(r.slowed).padStart(6)}%  ${String(r.ents).padStart(4)} ${String(r.bul).padStart(6)} ${String(r.parts).padStart(8)}`);
}
console.log('errors', errs.length, errs.slice(0, 3));
ws.close(); chrome.kill(); process.exit(0);
