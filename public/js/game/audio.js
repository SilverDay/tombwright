// Sound: Gloamhollow's synthesised effects, ported verbatim (reference/gloamhollow/Gloamhollow.html, "audio").
// Nothing to download. Renderer side only: Math.random here never touches the sim.
const AUD = { ctx: null, master: null, noise: null, on: true };
try { AUD.on = localStorage.getItem('tombwright:sound') !== 'off'; } catch (e) { /* storage unavailable */ }
function audioInit() {
  if (AUD.ctx) { if (AUD.ctx.state === 'suspended') AUD.ctx.resume().catch(() => {}); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    AUD.ctx = new AC(); AUD.master = AUD.ctx.createGain(); AUD.master.gain.value = 0.32; AUD.master.connect(AUD.ctx.destination);
    const len = AUD.ctx.sampleRate, buf = AUD.ctx.createBuffer(1, len, len), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    AUD.noise = buf;
  } catch (e) { AUD.ctx = null; }
}
function tone(f, dur, type = 'sine', vol = 0.25, to = null, delay = 0) {
  const a = AUD.ctx; if (!a || !AUD.on) return;
  const t0 = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(AUD.master); o.start(t0); o.stop(t0 + dur + 0.03);
}
function hiss(dur, vol = 0.2, freq = 1000, type = 'lowpass', to = null, delay = 0) {
  const a = AUD.ctx; if (!a || !AUD.on || !AUD.noise) return;
  const t0 = a.currentTime + delay, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = AUD.noise; f.type = type; f.frequency.setValueAtTime(freq, t0); if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(AUD.master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.03);
}
const sfx = {
  swing() { hiss(0.16, 0.22, 2600, 'bandpass', 700); },
  hit() { tone(150, 0.13, 'sine', 0.5, 55); hiss(0.08, 0.22, 1100); },
  smoke() { hiss(0.3, 0.16, 600, 'lowpass', 200); },
  hurt() { tone(230, 0.22, 'sawtooth', 0.22, 90); },
  kill() { tone(320, 0.32, 'square', 0.1, 70); },
  gold() { tone(1320, 0.07, 'square', 0.08); tone(1760, 0.1, 'square', 0.07, null, 0.06); },
  pickup() { tone(660, 0.08, 'triangle', 0.2); tone(990, 0.1, 'triangle', 0.18, null, 0.07); },
  door() { tone(70, 0.6, 'sawtooth', 0.09, 110); hiss(0.6, 0.08, 400); },
  grate() { for (let k = 0; k < 6; k++) tone(300 + k * 30, 0.05, 'square', 0.05, null, k * 0.09); hiss(0.6, 0.06, 2400, 'bandpass'); },
  thud() { tone(60, 0.25, 'sine', 0.55, 32); hiss(0.18, 0.22, 380); },
  locked() { tone(160, 0.07, 'square', 0.12); tone(160, 0.07, 'square', 0.12, null, 0.11); },
  chest() { tone(170, 0.2, 'square', 0.08, 120); tone(880, 0.12, 'triangle', 0.16, null, 0.18); },
  read() { hiss(0.25, 0.1, 3000, 'bandpass', 1200); },
  probe() { tone(520, 0.05, 'square', 0.06); hiss(0.05, 0.08, 3000, 'bandpass'); },
  hollow() { tone(220, 0.08, 'sine', 0.2, 160); tone(110, 0.3, 'sine', 0.1, 70, 0.05); },
  clink() { tone(1900, 0.05, 'triangle', 0.12); tone(2600, 0.08, 'triangle', 0.08, null, 0.04); },
  pebble() { tone(800, 0.04, 'square', 0.06); tone(600, 0.04, 'square', 0.05, null, 0.07); },
  hood() { hiss(0.12, 0.1, 1800, 'bandpass'); tone(300, 0.06, 'square', 0.04); },
  pour() { for (let i = 0; i < 6; i++) tone(240 + Math.random() * 200, 0.07, 'sine', 0.12, 420, i * 0.06); },
  bell(f) { tone(f, 3.2, 'sine', 0.28); tone(f * 2.76, 1.8, 'sine', 0.08); tone(f * 5.4, 0.9, 'sine', 0.05); tone(f * 1.5, 2.4, 'triangle', 0.04); },
  clash() { for (const f of [233, 311, 415]) tone(f, 1.2, 'sawtooth', 0.06, f * 0.9); },
  dart() { for (let k = 0; k < 5; k++) hiss(0.08, 0.12, 4200, 'highpass', null, k * 0.05); },
  rumble() { tone(45, 0.9, 'sawtooth', 0.12, 60); hiss(0.9, 0.1, 300, 'lowpass', 900); },
  roar() { hiss(1.1, 0.26, 700, 'lowpass', 2400); tone(70, 1.0, 'sawtooth', 0.1, 50); },
  wake() { tone(330, 1.0, 'sine', 0.1, 990); tone(331, 1.0, 'triangle', 0.05, 1320); },
  sear() { hiss(0.9, 0.3, 5000, 'highpass', 900); tone(1200, 0.6, 'square', 0.08, 200); },
  fall() { tone(500, 1.4, 'sine', 0.18, 60); hiss(1.3, 0.12, 2000, 'lowpass', 200); },
  crunch() { tone(55, 0.3, 'square', 0.3, 30); hiss(0.4, 0.3, 700); },
  water() { hiss(1.4, 0.24, 900, 'lowpass', 300); for (let i = 0; i < 8; i++) tone(200 + Math.random() * 300, 0.1, 'sine', 0.08, 120, i * 0.15); },
  laugh() { for (let i = 0; i < 6; i++) tone(260 - i * 12, 0.09, 'sawtooth', 0.07, 200, i * 0.13); },
  checkpoint() { [392, 523, 659].forEach((f, i) => tone(f, 0.4, 'sine', 0.12, null, i * 0.12)); },
  mirror() { tone(660, 0.12, 'triangle', 0.1); tone(990, 0.2, 'sine', 0.06, null, 0.05); },
  solve() { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.5, 'triangle', 0.14, null, i * 0.11)); },
  ignite() { hiss(0.5, 0.22, 900, 'lowpass', 2600); tone(180, 0.4, 'sine', 0.1, 360); },
  gulp() { hiss(0.6, 0.25, 2400, 'lowpass', 200); tone(240, 0.6, 'sine', 0.16, 60); },
  shriek() { tone(900, 0.9, 'sawtooth', 0.12, 1400); tone(620, 0.9, 'sawtooth', 0.1, 300); hiss(0.9, 0.2, 3000, 'bandpass'); },
  step() { tone(90, 0.06, 'sine', 0.05, 60); },
  win() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.45, 'triangle', 0.2, null, i * 0.13)); },
  die() { tone(220, 1.2, 'sawtooth', 0.2, 50); },
};

export { AUD, audioInit, sfx };
