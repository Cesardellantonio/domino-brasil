import { getPrefs } from './prefs';

/**
 * Todos os sons são sintetizados com WebAudio (nenhum arquivo para baixar).
 * Cadeia: fontes -> (seco + reverb de sala) -> compressor -> saída.
 */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let verb: ConvolverNode | null = null;
let verbIn: GainNode | null = null;
let noise: AudioBuffer | null = null;
let brown: AudioBuffer | null = null;

function build(c: AudioContext) {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  comp.connect(c.destination);
  out = c.createGain();
  out.gain.value = 0.9;
  out.connect(comp);

  // Sala pequena de boteco: resposta ao impulso gerada (ruído com decaimento).
  verb = c.createConvolver();
  const len = Math.floor(c.sampleRate * 0.9);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 200 ? i / 200 : 1);
    }
  }
  verb.buffer = ir;
  verbIn = c.createGain();
  verbIn.gain.value = 0.22;
  verbIn.connect(verb).connect(out);

  noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  brown = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
  const bd = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bd.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    bd[i] = last * 3.5;
  }
}

function ac(force = false): AudioContext | null {
  if (!force && !getPrefs().sound) return null;
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      build(ctx);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Chamar num gesto do usuário para liberar o áudio no iPhone. */
export function unlockAudio() {
  const c = ac(true);
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
  syncAmbience();
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Envia um nó para a saída seca e para o reverb. */
function route(node: AudioNode, wet = 0.5) {
  node.connect(out!);
  if (wet > 0) {
    const s = ctx!.createGain();
    s.gain.value = wet;
    node.connect(s).connect(verbIn!);
  }
}

function env(c: AudioContext, t: number, peak: number, attack: number, decay: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noiseBurst(c: AudioContext, t: number, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, wet = 0.4) {
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = env(c, t, peak, 0.001, decay);
  src.connect(f).connect(g);
  route(g, wet);
  src.start(t, Math.random() * 0.8);
  src.stop(t + decay + 0.05);
}

function partial(c: AudioContext, t: number, freq: number, peak: number, decay: number, type: OscillatorType = 'sine', wet = 0.4, glideTo?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + decay);
  const g = env(c, t, peak, 0.002, decay);
  o.connect(g);
  route(g, wet);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** Uma pedra (osso/resina) batendo na mesa de madeira. */
function tileHit(c: AudioContext, t: number, force: number) {
  const pitch = rnd(0.9, 1.12);
  // estalo do contato
  noiseBurst(c, t, 'highpass', 3500, 0.7, 0.55 * force, 0.012, 0.25);
  // modos de ressonância da pedra
  partial(c, t, 2150 * pitch, 0.22 * force, 0.05, 'sine', 0.35);
  partial(c, t, 3380 * pitch, 0.15 * force, 0.035, 'sine', 0.35);
  partial(c, t, 5230 * pitch, 0.08 * force, 0.025, 'sine', 0.3);
  // corpo da mesa
  noiseBurst(c, t, 'lowpass', 420, 1, 0.5 * force, 0.07, 0.5);
  partial(c, t, 150 * pitch, 0.35 * force, 0.09, 'sine', 0.3, 90);
}

export const sfx = {
  /** Pedra colocada na mesa: batida + pequena acomodação. */
  clack() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.005;
    tileHit(c, t, 1);
    tileHit(c, t + rnd(0.028, 0.045), 0.28);
  },
  /** A batida: aquela pancada na mesa que faz todas as pedras pularem. */
  slam() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.005;
    partial(c, t, 95, 1.0, 0.45, 'sine', 0.6, 45);
    noiseBurst(c, t, 'lowpass', 900, 0.8, 1.0, 0.25, 0.9);
    noiseBurst(c, t, 'bandpass', 1800, 1.2, 0.6, 0.12, 0.8);
    tileHit(c, t, 1.3);
    // as outras pedras sacodem na mesa
    for (let i = 0; i < 12; i++) tileHit(c, t + 0.07 + i * rnd(0.025, 0.05), rnd(0.12, 0.35));
  },
  /** Embaralhar: as pedras girando na mesa. */
  shuffle() {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + 0.01;
    const dur = 1.3;
    const src = c.createBufferSource();
    src.buffer = brown;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400;
    f.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.15);
    g.gain.setValueAtTime(0.35, t0 + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    route(g, 0.4);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
    let t = t0;
    while (t < t0 + dur) {
      tileHit(c, t, rnd(0.08, 0.3));
      t += rnd(0.018, 0.07);
    }
  },
  pick() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.005;
    noiseBurst(c, t, 'highpass', 4000, 0.7, 0.25, 0.01, 0.1);
    partial(c, t, 3000, 0.06, 0.03, 'sine', 0.1);
  },
  /** Sua vez: duas notas de marimba. */
  turn() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.01;
    for (const [i, f] of [659, 988].entries()) {
      partial(c, t + i * 0.1, f, 0.16, 0.35, 'sine', 0.5);
      partial(c, t + i * 0.1, f * 4, 0.03, 0.06, 'sine', 0.3);
    }
  },
  /** Passou: duas batidinhas com o nó do dedo na mesa. */
  pass() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.01;
    for (const d of [0, 0.17]) {
      partial(c, t + d, 190, 0.55, 0.12, 'sine', 0.5, 120);
      noiseBurst(c, t + d, 'bandpass', 750, 1.5, 0.45, 0.06, 0.5);
      noiseBurst(c, t + d, 'highpass', 2500, 0.7, 0.12, 0.01, 0.2);
    }
  },
  pop() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.01;
    partial(c, t, 520, 0.12, 0.09, 'sine', 0.3, 880);
    partial(c, t + 0.06, 1040, 0.07, 0.1, 'sine', 0.3);
  },
  /** Vitória: arpejo com tamborim no ritmo de samba. */
  fanfare(big = false) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    const notes = big ? [523, 659, 784, 1047, 784, 1047] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      partial(c, t + i * 0.12, f, 0.16, big && i === notes.length - 1 ? 0.9 : 0.3, 'triangle', 0.6);
      partial(c, t + i * 0.12, f * 2, 0.04, 0.15, 'sine', 0.4);
    });
    if (big) {
      const beat = 0.125;
      const pattern = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1];
      pattern.forEach((on, i) => on && noiseBurst(c, t + 0.2 + i * beat, 'bandpass', 3200, 2.5, i % 4 === 0 ? 0.5 : 0.3, 0.05, 0.4));
      for (let i = 0; i < 4; i++) partial(c, t + 0.2 + i * beat * 4, 70, 0.6, 0.3, 'sine', 0.3, 45); // surdo
    }
  },
  sad() {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + 0.02;
    [392, 370, 349, 294].forEach((f, i) => partial(c, t + i * 0.18, f, 0.13, 0.4, 'triangle', 0.6));
  },
};

// ------------------------------------------------------------------ ambiente de boteco

let amb: { stop: () => void } | null = null;

/** Liga/desliga o burburinho de bar de acordo com as preferências. */
export function syncAmbience(active = ambienceWanted) {
  ambienceWanted = active;
  const want = active && getPrefs().sound && getPrefs().ambience;
  if (!want) {
    amb?.stop();
    amb = null;
    return;
  }
  if (amb) return;
  const c = ac();
  if (!c || !brown) return;
  const src = c.createBufferSource();
  src.buffer = brown;
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'bandpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.5;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.09, c.currentTime + 2);
  // o volume da conversa sobe e desce devagar
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.13;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.03;
  lfo.connect(lfoG).connect(g.gain);
  src.connect(lp).connect(g);
  route(g, 0.8);
  src.start();
  lfo.start();
  let timer: ReturnType<typeof setTimeout>;
  const clink = () => {
    const cc = ac();
    if (cc) {
      const t = cc.currentTime + 0.01;
      const base = rnd(2400, 3600);
      // copo americano batendo
      for (const [i, m] of [1, 2.7, 5.1].entries()) partial(cc, t, base * m, [0.035, 0.018, 0.01][i], rnd(0.3, 0.6), 'sine', 0.9);
      if (Math.random() < 0.4) for (const [i, m] of [1, 2.7].entries()) partial(cc, t + 0.09, base * 1.07 * m, [0.025, 0.012][i], 0.3, 'sine', 0.9);
    }
    timer = setTimeout(clink, rnd(5000, 14000));
  };
  timer = setTimeout(clink, 2500);
  amb = {
    stop: () => {
      clearTimeout(timer);
      try {
        g.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
        src.stop(c.currentTime + 0.9);
        lfo.stop(c.currentTime + 0.9);
      } catch {
        /* ignore */
      }
    },
  };
}
let ambienceWanted = false;

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}
