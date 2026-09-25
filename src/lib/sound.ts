import { getPrefs } from './prefs';

/** All sounds are synthesized with WebAudio: no assets to download. */
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!getPrefs().sound) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Call from a user gesture so iOS unlocks audio. */
export function unlockAudio() {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
}

function click(c: AudioContext, t: number, freq: number, q: number, gain: number, dur: number) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function thump(c: AudioContext, t: number, freq: number, gain: number, dur: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function tone(c: AudioContext, t: number, freq: number, gain: number, dur: number, type: OscillatorType = 'triangle') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  /** A tile placed on the table. */
  clack() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    click(c, t, 2600 + Math.random() * 500, 3, 0.55, 0.06);
    click(c, t + 0.028, 1800 + Math.random() * 300, 4, 0.25, 0.05);
    thump(c, t, 180, 0.25, 0.08);
  },
  /** The batida: slamming the last tile on the table. */
  slam() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    thump(c, t, 110, 0.9, 0.35);
    click(c, t, 1400, 1.5, 0.9, 0.18);
    click(c, t + 0.01, 3200, 2, 0.5, 0.12);
    // tiles rattling on the table
    for (let i = 0; i < 5; i++) click(c, t + 0.09 + i * 0.045 + Math.random() * 0.02, 2800 + Math.random() * 900, 5, 0.18, 0.04);
  },
  shuffle() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 16; i++) click(c, t + i * 0.055 + Math.random() * 0.03, 2200 + Math.random() * 1600, 4, 0.12 + Math.random() * 0.1, 0.045);
  },
  pick() {
    const c = ac();
    if (!c) return;
    click(c, c.currentTime, 3600, 6, 0.18, 0.03);
  },
  turn() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 660, 0.12, 0.18, 'sine');
    tone(c, t + 0.09, 990, 0.1, 0.25, 'sine');
  },
  pass() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    // two knocks on the table
    thump(c, t, 150, 0.5, 0.12);
    click(c, t, 900, 2, 0.35, 0.07);
    thump(c, t + 0.16, 150, 0.45, 0.12);
    click(c, t + 0.16, 900, 2, 0.3, 0.07);
  },
  pop() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    tone(c, t, 520, 0.12, 0.09, 'sine');
    tone(c, t + 0.05, 880, 0.1, 0.12, 'sine');
  },
  fanfare(big = false) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    const notes = big ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784, 1047];
    notes.forEach((f, i) => tone(c, t + i * 0.11, f, 0.16, big && i === notes.length - 1 ? 0.8 : 0.3));
  },
  sad() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    [392, 370, 349, 294].forEach((f, i) => tone(c, t + i * 0.16, f, 0.12, 0.35, 'sine'));
  },
};

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
