// Процедурный звук на WebAudio: двигатель, сирена, удары, выстрелы, взрывы.
export class Sfx {
  constructor() { this.ctx = null; this.t = 0; }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const ctx = this.ctx = new C();
      this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
      // двигатель
      this.eng = ctx.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 40;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(f).connect(this.engGain).connect(this.master); this.eng.start();
      // сирена
      this.sir = ctx.createOscillator(); this.sir.type = 'square'; this.sir.frequency.value = 700;
      this.sirGain = ctx.createGain(); this.sirGain.gain.value = 0;
      this.sir.connect(this.sirGain).connect(this.master); this.sir.start();
      // клаксон
      this.hornO = ctx.createOscillator(); this.hornO.type = 'square'; this.hornO.frequency.value = 330;
      this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
      this.hornO.connect(this.hornGain).connect(this.master); this.hornO.start();
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // шум дождя — зацикленный отфильтрованный шум
      const rs = ctx.createBufferSource(); rs.buffer = this.noiseBuf; rs.loop = true;
      const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1200;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      rs.connect(rf).connect(this.rainGain).connect(this.master); rs.start();
    } catch (e) { this.ctx = null; }
  }

  update(dt, engineOn, rpm, sirenLevel, horn) {
    if (!this.ctx) return;
    this.t += dt;
    const now = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(engineOn ? 0.05 + rpm * 0.04 : 0, now, 0.1);
    this.eng.frequency.setTargetAtTime(38 + rpm * 110, now, 0.08);
    this.sir.frequency.setTargetAtTime(720 + 260 * Math.sin(this.t * 4), now, 0.02);
    this.sirGain.gain.setTargetAtTime(sirenLevel * 0.035, now, 0.2);
    this.hornGain.gain.setTargetAtTime(horn ? 0.06 : 0, now, 0.02);
  }

  noise(dur, vol, freq, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.master); s.start(); s.stop(ctx.currentTime + dur);
  }

  beep(freq, dur, vol = 0.15, type = 'sine', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + delay;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur);
  }

  rain(level) {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(level * 0.08, this.ctx.currentTime, 0.5);
  }

  hit(v = 0.5) { this.noise(0.18, Math.min(1, v), 700); }
  punch() { this.noise(0.07, 0.25, 1800, 'bandpass'); }
  shot() { this.noise(0.12, 0.35, 2500, 'highpass'); }
  boom() { this.noise(1.2, 1, 180); }
  cash() { this.beep(880, 0.12, 0.12, 'triangle'); this.beep(1320, 0.18, 0.12, 'triangle', 0.08); }
  ok() { [523, 659, 784, 1046].forEach((f, i) => this.beep(f, 0.25, 0.12, 'triangle', i * 0.12)); }
  fail() { [400, 300, 200].forEach((f, i) => this.beep(f, 0.3, 0.12, 'sawtooth', i * 0.18)); }
  check() { this.beep(988, 0.15, 0.15, 'square'); }
}
