// Every sound is synthesized live with WebAudio — zero audio files.
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.intensity = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    this.musicLP = ctx.createBiquadFilter(); this.musicLP.type = 'lowpass'; this.musicLP.frequency.value = 900; this.musicLP.connect(this.music);
    const len = ctx.sampleRate * 1.5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.step = 0; this.nextT = ctx.currentTime + 0.1; this.playing = false;
    this.last = {};
  }
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; return this.muted; }
  _rate(name, ms) { const n = performance.now(); if (this.last[name] && n - this.last[name] < ms) return false; this.last[name] = n; return true; }
  _env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  _osc(type, f0, f1, dur, vol, dest = this.sfx, t = this.ctx.currentTime) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, 0.004, vol, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, vol, f0, f1, type = 'lowpass', dest = this.sfx, t = this.ctx.currentTime, q = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain(); this._env(g, t, 0.003, vol, dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  shoot() { if (!this.ctx || !this._rate('shoot', 60)) return; this._osc('square', 1400 + Math.random() * 200, 300, 0.07, 0.05); }
  enemyShoot() { if (!this.ctx || !this._rate('eshoot', 45)) return; this._osc('sine', 700, 180, 0.12, 0.06); }
  hit() { if (!this.ctx || !this._rate('hit', 30)) return; this._osc('triangle', 500, 120, 0.06, 0.12); this._noise(0.05, 0.12, 4000, 1500, 'bandpass'); }
  boom(size = 1) {
    if (!this.ctx || !this._rate('boom', 25)) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 160 * (1.2 - size * 0.2), 32, 0.35 + size * 0.3, 0.55 * Math.min(1.4, size));
    this._noise(0.4 + size * 0.5, 0.42 * Math.min(1.5, size), 3500, 120, 'lowpass', this.sfx, t);
    this._noise(0.12, 0.2, 8000, 2000, 'highpass', this.sfx, t);
  }
  pop() { if (!this.ctx || !this._rate('pop', 20)) return; this._noise(0.15, 0.2, 2500, 300); this._osc('square', 300, 60, 0.1, 0.06); }
  dash() { if (!this.ctx) return; this._noise(0.22, 0.22, 600, 5000, 'bandpass', this.sfx, this.ctx.currentTime, 2); }
  hurt() { if (!this.ctx) return; this._osc('sawtooth', 220, 40, 0.45, 0.35); this._noise(0.35, 0.4, 1800, 100); }
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime; [660, 880, 1320].forEach((f, i) => this._osc('triangle', f, f * 1.01, 0.12, 0.12, this.sfx, t + i * 0.06)); }
  nova() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 90, 25, 1.4, 0.9); this._osc('sawtooth', 600, 40, 0.9, 0.18);
    this._noise(1.4, 0.55, 6000, 60, 'lowpass', this.sfx, t);
  }
  tick(p = 0) { if (!this.ctx || !this._rate('tick', 40)) return; this._osc('square', 900 + p * 900, 900 + p * 900, 0.03, 0.035); }
  glitch() { if (!this.ctx) return; const t = this.ctx.currentTime; for (let i = 0; i < 6; i++) this._osc('square', 80 + Math.random() * 1500, 50 + Math.random() * 400, 0.06, 0.08, this.sfx, t + i * 0.05); this._noise(0.5, 0.3, 300, 4000, 'bandpass', this.sfx, t, 4); }
  wave() { if (!this.ctx) return; const t = this.ctx.currentTime; [0, 3, 7, 12].forEach((s, i) => this._osc('sawtooth', 220 * Math.pow(2, s / 12), 220 * Math.pow(2, s / 12), 0.25, 0.08, this.sfx, t + i * 0.08)); }

  // ---- generative darksynth: A minor, 124 bpm, layers unlock with intensity ----
  startMusic() { if (!this.ctx) return; this.playing = true; this.nextT = Math.max(this.nextT, this.ctx.currentTime + 0.05); }
  stopMusic() { this.playing = false; }
  updateMusic(intensity) {
    if (!this.ctx || !this.playing) return;
    this.intensity += (intensity - this.intensity) * 0.02;
    this.musicLP.frequency.setTargetAtTime(500 + this.intensity * 5500, this.ctx.currentTime, 0.3);
    const spb = 60 / 124 / 4; // 16th notes
    while (this.nextT < this.ctx.currentTime + 0.15) { this._step(this.step, this.nextT); this.step++; this.nextT += spb; }
  }
  _step(s, t) {
    const ctx = this.ctx, bar = Math.floor(s / 16) % 4, k = s % 16;
    const roots = [45, 41, 43, 40]; // A F G E
    const root = roots[bar];
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const I = this.intensity;
    if (k % 4 === 0) { // kick
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      this._env(g, t, 0.002, 0.8, 0.22); o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.3);
    }
    if (I > 0.25 && k % 2 === 1) this._noise(0.03, 0.07 + I * 0.08, 9000, 7000, 'highpass', this.music, t);
    if (I > 0.5 && (k === 4 || k === 12)) this._noise(0.16, 0.25, 2500, 800, 'bandpass', this.music, t);
    // rolling bass
    const bn = root + (k % 8 === 6 ? 12 : 0);
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(bn - 12);
    this._env(g, t, 0.005, 0.22, 0.11); o.connect(g); g.connect(this.musicLP); o.start(t); o.stop(t + 0.15);
    // arp
    if (I > 0.15 && k % 2 === 0) {
      const chord = [0, 3, 7, 10, 12, 15];
      const n = root + 24 + chord[(s / 2 + bar) % chord.length | 0];
      const a = ctx.createOscillator(), ag = ctx.createGain(); a.type = 'square'; a.frequency.value = hz(n);
      this._env(ag, t, 0.004, 0.05 + I * 0.04, 0.12); a.connect(ag); ag.connect(this.musicLP); a.start(t); a.stop(t + 0.16);
    }
  }
}
