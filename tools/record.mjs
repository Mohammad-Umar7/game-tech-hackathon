// Records the cinematic autodemo to MP4 using headless Chrome (DevTools screencast) + ffmpeg.
// usage: node tools/record.mjs [url] [out.mp4] [width] [height]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const URL_ = process.argv[2] || 'http://127.0.0.1:5173/?autodemo';
const OUT = resolve(process.argv[3] || 'docs/overfit-demo.mp4');
const Wd = +(process.argv[4] || 1920), Hd = +(process.argv[5] || 1080);
const MAX_S = 200;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const work = join(tmpdir(), `overfit-rec-${Date.now()}`); mkdirSync(join(work, 'f'), { recursive: true });
const writeRetry = (p, buf) => { for (let i = 0; i < 20; i++) { try { writeFileSync(p, buf); return; } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; const t = Date.now(); while (Date.now() - t < 15); } } };
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PORT}`, `--window-size=${Wd},${Hd}`, '--hide-scrollbars', '--mute-audio',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--user-data-dir=${join(work, 'profile')}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.find(t => t.type === 'page')) break; } catch { } await sleep(200); }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const frames = [];
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = m.params;
    const n = frames.length;
    writeRetry(join(work, 'f', `${String(n).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    frames.push(metadata.timestamp);
    send('Page.screencastFrameAck', { sessionId });
  }
});
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Wd, height: Hd, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });
await sleep(1500);
const gpu = await send('Runtime.evaluate', { expression: `(() => { const gl = document.querySelector('#c').getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`, returnByValue: true });
console.log('GPU:', gpu?.result?.value);
await send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: Wd, maxHeight: Hd, everyNthFrame: 1 });
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < MAX_S) {
  await sleep(1000);
  const r = await send('Runtime.evaluate', { expression: 'window.__demoDone === true', returnByValue: true });
  process.stdout.write(`\r${((Date.now() - t0) / 1000).toFixed(0)}s · ${frames.length} frames · ${(frames.length / ((Date.now() - t0) / 1000)).toFixed(1)} fps   `);
  if (r?.result?.value) break;
}
await send('Page.stopScreencast');
const au = await send('Runtime.evaluate', { expression: 'JSON.stringify({ b: window.__audioB64 || null, t: window.__audioStart || 0 })', returnByValue: true });
const audio = JSON.parse(au?.result?.value || '{}');
if (audio.b) { writeFileSync(join(work, 'audio.webm'), Buffer.from(audio.b, 'base64')); console.log(`
audio: ${(audio.b.length * 0.75 / 1024).toFixed(0)} KB, starts ${(audio.t - frames[0]).toFixed(2)}s in`); }
ws.close(); chrome.kill();
console.log(`\ncaptured ${frames.length} frames`);
// variable-frame-rate concat list using real timestamps
let list = 'ffconcat version 1.0\n';
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1] - frames[i]) : 0.04;
  list += `file 'f/${String(i).padStart(5, '0')}.jpg'\nduration ${d.toFixed(4)}\n`;
}
writeFileSync(join(work, 'list.txt'), list);
const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt')];
if (audio.b) args.push('-itsoffset', String(Math.max(0, audio.t - frames[0])), '-i', join(work, 'audio.webm'), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-af', 'apad', '-shortest');
args.push('-vf', `fps=30,scale=${Wd}:${Hd}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', OUT);
execFileSync('ffmpeg', args, { stdio: 'inherit' });
console.log('wrote', OUT);
try { rmSync(work, { recursive: true, force: true }); } catch { /* temp cleanup best-effort */ }
