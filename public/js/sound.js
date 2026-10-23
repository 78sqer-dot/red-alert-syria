// Synthesised alert ringtones (Web Audio API) — no audio files needed.
let ctx = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0.0001;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.02);
}

function tone(c, out, { type = 'sine', f0, f1, t, d, a = 0.01, r = 0.08, gain = 1 }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.linearRampToValueAtTime(f1, t + d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + a);
  g.gain.setValueAtTime(gain, t + Math.max(a, d - r));
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + d + 0.02);
}

const TONES = {
  alert1(c, out, t) { // siren sweep
    for (let i = 0; i < 3; i++) {
      tone(c, out, { type: 'sawtooth', f0: 620, f1: 1180, t: t + i * 0.7, d: 0.35, gain: 0.35 });
      tone(c, out, { type: 'sawtooth', f0: 1180, f1: 620, t: t + i * 0.7 + 0.35, d: 0.35, gain: 0.35 });
    }
    return 2.1;
  },
  alert2(c, out, t) { // rapid pulses
    for (let i = 0; i < 8; i++) tone(c, out, { type: 'square', f0: 1040, t: t + i * 0.16, d: 0.09, r: 0.03, gain: 0.25 });
    return 1.3;
  },
  alert3(c, out, t) { // two-tone (hi-lo)
    for (let i = 0; i < 4; i++) tone(c, out, { type: 'triangle', f0: i % 2 ? 660 : 880, t: t + i * 0.42, d: 0.4, gain: 0.6 });
    return 1.7;
  },
  alert4(c, out, t) { // soft chime
    [784, 988, 1175, 1568].forEach((f, i) => tone(c, out, { type: 'sine', f0: f, t: t + i * 0.13, d: 0.9, r: 0.7, gain: 0.5 }));
    return 1.4;
  },
  alert5(c, out, t) { // radar ping
    for (let i = 0; i < 3; i++) {
      tone(c, out, { type: 'sine', f0: 1400, f1: 1300, t: t + i * 0.55, d: 0.5, a: 0.005, r: 0.45, gain: 0.7 });
      tone(c, out, { type: 'sine', f0: 2800, t: t + i * 0.55, d: 0.2, a: 0.005, r: 0.18, gain: 0.12 });
    }
    return 1.7;
  },
};
export const RINGTONES = Object.keys(TONES);

let playingUntil = 0;
export function playRingtone(name = 'alert1', volume = 0.8) {
  const c = ac();
  if (!c) return;
  if (c.currentTime < playingUntil) return; // avoid overlapping bursts
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.9;
  const comp = c.createDynamicsCompressor();
  master.connect(comp).connect(c.destination);
  const dur = (TONES[name] || TONES.alert1)(c, master, c.currentTime + 0.03);
  playingUntil = c.currentTime + dur;
}
