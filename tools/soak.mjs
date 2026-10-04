// Soak test: AI pilot plays in headless Chrome; reports progress + any JS errors.
// usage: node tools/soak.mjs [url] [seconds]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_ = process.argv[2] || 'http://127.0.0.1:5173/?bot';
const SECS = +(process.argv[3] || 240);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const prof = join(tmpdir(), `overfit-soak-${Date.now()}`); mkdirSync(prof, { recursive: true });
const PORT = 9334;
const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, '--window-size=1600,900',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch { } await sleep(200); }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value || a.description).join(' '));
});
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: URL_ });
const t0 = Date.now(); let deaths = 0, lastState = '', maxWave = 0;
while ((Date.now() - t0) / 1000 < SECS) {
  await sleep(5000);
  const r = await send('Runtime.evaluate', { expression: `(() => { const o = window.__overfit; if (!o) return null; const g = o.game; return { wave: g.wave, st: g.state, hp: g.player.hp, score: g.score, gen: o.pop.generation, duels: o.trainer.totalDuels, ents: g.hunters.length + g.drones.length, bul: g.eb.length + g.pb.length, scene: o.R.scene.children.length, curve: (g.curve||[]).length + ' labs' }; })()`, returnByValue: true });
  const v = r?.result?.value;
  if (!v) continue;
  if (v.st === 'dead' && lastState !== 'dead') deaths++;
  lastState = v.st; maxWave = Math.max(maxWave, v.wave || 0);
  console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s wave ${v.wave} ${v.st.padEnd(7)} hp ${v.hp} score ${v.score} gen ${v.gen} duels ${v.duels} ents ${v.ents} bullets ${v.bul} sceneObjs ${v.scene} ${v.curve}`);
}
console.log(`\nmax wave ${maxWave}, deaths ${deaths}, errors ${errors.length}`);
errors.slice(0, 10).forEach(e => console.log('ERR', e));
ws.close(); chrome.kill(); process.exit(0);
