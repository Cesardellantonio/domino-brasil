/**
 * agent1 "O Contador" core: bitmask tile tables, public-log inference (voids + a soft
 * behavioural model of what each seat chose to play), MCMC deal sampling weighted by that
 * model, fast rollouts and a match-equity table for the penalty race to 100.
 *
 * Only public information (PlayerView) is used.
 */
import { ALL_TILES } from '../../engine/tiles';
import { PlayerView } from '../../engine/view';
import { Rng } from '../../lib/rng';

// ------------------------------------------------------------------ tile tables

export const TA = new Int8Array(28);
export const TB = new Int8Array(28);
export const PIP = new Int8Array(28);
export const DBL = new Int8Array(28);
/** NM[n] = mask of tiles carrying number n. */
export const NM = new Int32Array(7);
export const TILE_BIT = new Int32Array(28);
for (const t of ALL_TILES) {
  TA[t.id] = t.a;
  TB[t.id] = t.b;
  PIP[t.id] = t.a + t.b;
  DBL[t.id] = t.a === t.b ? 1 : 0;
  TILE_BIT[t.id] = 1 << t.id;
  NM[t.a] |= 1 << t.id;
  NM[t.b] |= 1 << t.id;
}
export const ALL_MASK = (1 << 28) - 1;

export const bitIdx = (b: number) => 31 - Math.clz32(b);
export function popcnt(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}
export function maskPips(m: number): number {
  let s = 0;
  while (m) {
    const b = m & -m;
    s += PIP[bitIdx(b)];
    m ^= b;
  }
  return s;
}
export const other = (id: number, n: number) => (TA[id] === n ? TB[id] : TA[id]);
/** Tiles allowed for a seat given its void mask (numbers it is known not to hold). */
export function allowedMask(voidMask: number): number {
  let bad = 0;
  for (let n = 0; n < 7; n++) if (voidMask & (1 << n)) bad |= NM[n];
  return ALL_MASK & ~bad;
}

// ------------------------------------------------------------------ match equity

/**
 * Empirical distribution of the penalty a losing pair takes in one hand
 * (from 16k simulated hands). Index = points, value = relative frequency.
 */
const PEN_HIST: [number, number][] = [
  [1, 86], [2, 108], [3, 265], [4, 334], [5, 544], [6, 557], [7, 713], [8, 722], [9, 856], [10, 856],
  [11, 841], [12, 819], [13, 839], [14, 832], [15, 811], [16, 730], [17, 670], [18, 628], [19, 599], [20, 596],
  [21, 492], [22, 471], [23, 433], [24, 419], [25, 367], [26, 320], [27, 337], [28, 302], [29, 256], [30, 242],
  [31, 212], [32, 181], [33, 198], [34, 174], [35, 136], [36, 139], [37, 125], [38, 110], [39, 106], [40, 78],
  [41, 62], [42, 59], [43, 55], [44, 48], [45, 57], [46, 35], [47, 36], [48, 32], [49, 20], [50, 15],
  [51, 15], [52, 20], [53, 13], [54, 7], [55, 10], [56, 10], [57, 4], [58, 6], [59, 4], [60, 1],
  [61, 3], [62, 3], [63, 1], [64, 1], [67, 1], [80, 1],
];
/** Probability that the pair that opens a hand wins it. */
const P_STARTER = 0.6;

/**
 * EQ[s][my*100+opp] = probability my pair wins the match from these scores when
 * s = 1 (my pair opens the next hand) or 0. Scores >= 100 are terminal.
 */
export const EQ: [Float64Array, Float64Array] = (() => {
  const total = PEN_HIST.reduce((a, [, c]) => a + c, 0);
  const px = PEN_HIST.map(([x, c]) => [x, c / total] as [number, number]);
  const v0 = new Float64Array(100 * 100);
  const v1 = new Float64Array(100 * 100);
  const get = (s: number, m: number, t: number) => (m >= 100 ? 0 : t >= 100 ? 1 : (s ? v1 : v0)[m * 100 + t]);
  for (let m = 99; m >= 0; m--)
    for (let t = 99; t >= 0; t--) {
      let winNext = 0; // I win this hand: opp takes X, I open next
      let loseNext = 0; // I lose: I take X, opp opens
      for (const [x, p] of px) {
        winNext += p * get(1, m, t + x);
        loseNext += p * get(0, m + x, t);
      }
      v1[m * 100 + t] = P_STARTER * winNext + (1 - P_STARTER) * loseNext;
      v0[m * 100 + t] = (1 - P_STARTER) * winNext + P_STARTER * loseNext;
    }
  return [v0, v1];
})();

export function equity(iOpen: number, my: number, opp: number): number {
  if (my >= 100) return 0;
  if (opp >= 100) return 1;
  return EQ[iOpen][my * 100 + opp];
}

// ------------------------------------------------------------------ public-log inference

export interface PlayEvent {
  seat: number;
  tile: number;
  /** Ends before the play; -1 when it was the opening play. */
  l: number;
  r: number;
  /** Created end value (the new open number). */
  created: number;
  /** Mask of tiles this seat played at or after this event. */
  fromHere: number;
  /** Opening move forced by mustPlay (no information). */
  forced: boolean;
  /** Public context at the time of the play. */
  table: number;
  vN: number; // void mask of the next seat
  vP: number; // void mask of the partner
  vQ: number; // void mask of the previous seat
}

export interface Inference {
  me: number;
  myMask: number;
  unseen: number;
  voids: Int32Array; // per seat void number-mask
  allowed: Int32Array; // per seat allowed tile mask
  counts: Int32Array;
  events: PlayEvent[][]; // per seat
}

export function buildInference(v: PlayerView): Inference {
  const me = v.seat;
  let myMask = 0;
  for (const id of v.myHand) myMask |= 1 << id;
  let table = 0;
  const voids = new Int32Array(4);
  const events: PlayEvent[][] = [[], [], [], []];
  let first = true;
  for (const e of v.log) {
    if (e.t === 'pass') {
      if (e.ends) voids[e.seat] |= (1 << e.ends[0]) | (1 << e.ends[1]);
    } else if (e.t === 'play') {
      let l = -1;
      let r = -1;
      let created = TB[e.id];
      if (e.ends) {
        l = e.ends[0];
        r = e.ends[1];
        created = e.side === 'L' ? other(e.id, l) : other(e.id, r);
      }
      const forced = first && v.handNo === 0; // first hand opens with the forced 6-6
      const s = e.seat;
      events[s].push({
        seat: s,
        tile: e.id,
        l,
        r,
        created,
        fromHere: 0,
        forced,
        table,
        vN: voids[(s + 1) & 3],
        vP: voids[(s + 2) & 3],
        vQ: voids[(s + 3) & 3],
      });
      table |= 1 << e.id;
      first = false;
    }
  }
  for (const list of events) {
    let acc = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      acc |= 1 << list[i].tile;
      list[i].fromHere = acc;
    }
  }
  const unseen = ALL_MASK & ~myMask & ~table;
  const allowed = new Int32Array(4);
  for (let s = 0; s < 4; s++) allowed[s] = allowedMask(voids[s]);
  const counts = new Int32Array(4);
  for (let s = 0; s < 4; s++) counts[s] = v.counts[s];
  return { me, myMask, unseen, voids, allowed, counts, events };
}

/** Number of features of the behavioural model. */
export const NF = 11;

/**
 * Features of one option: playing tile t (bit b) so the ends become (e = created, o = other).
 * hand = the seat's hand before the play.
 */
export function optionFeatures(
  f: Float64Array,
  hand: number,
  t: number,
  e: number,
  o: number,
  opening: boolean,
  table: number,
  vN: number,
  vP: number,
  vQ: number,
) {
  const b = 1 << t;
  const rest = hand & ~b;
  f[0] = PIP[t];
  f[1] = DBL[t];
  const fe = popcnt(rest & NM[e]);
  const fo = popcnt(rest & NM[o]);
  if (opening) {
    f[2] = fe > fo ? fe : fo;
    f[3] = fe > fo ? fo : fe;
  } else {
    f[2] = fe;
    f[3] = fo;
  }
  f[4] = rest & (NM[e] | NM[o]) ? 0 : 1;
  const both = (1 << e) | (1 << o);
  f[5] = (vN & both) === both ? 1 : 0;
  f[6] = (vP & both) === both ? 1 : 0;
  f[7] = e === o ? 1 : 0;
  f[8] = popcnt((table | hand) & NM[e]);
  f[9] = popcnt(rest) <= 2 ? PIP[t] : 0;
  f[10] = (vQ & both) === both ? 1 : 0;
}

/**
 * Enumerate the distinct options (tile, resulting ends) available with `hand` on ends l,r
 * (l < 0 = opening) and fill their features. Returns the number of options; `chosen` gets
 * the index of the option matching (tile, created) or -1.
 */
export function enumerateOptions(
  feats: Float64Array[],
  hand: number,
  l: number,
  r: number,
  table: number,
  vN: number,
  vP: number,
  vQ: number,
  tile: number,
  created: number,
  out: { chosen: number },
): number {
  let n = 0;
  out.chosen = -1;
  const legal = l < 0 ? hand : hand & (NM[l] | NM[r]);
  let m = legal;
  while (m) {
    const b = m & -m;
    m ^= b;
    const t = bitIdx(b);
    if (l < 0) {
      optionFeatures(feats[n], hand, t, TA[t], TB[t], true, table, vN, vP, vQ);
      if (t === tile) out.chosen = n;
      n++;
      continue;
    }
    const fitsL = TA[t] === l || TB[t] === l;
    const fitsR = TA[t] === r || TB[t] === r;
    let eL = -1;
    if (fitsL) {
      eL = other(t, l);
      optionFeatures(feats[n], hand, t, eL, r, false, table, vN, vP, vQ);
      if (t === tile && eL === created) out.chosen = n;
      n++;
    }
    if (fitsR) {
      const eR = other(t, r);
      // Same resulting ends as the left option: not a distinct choice.
      if (fitsL && ((eL === eR && l === r) || (eL === l && eR === r))) continue;
      optionFeatures(feats[n], hand, t, eR, l, false, table, vN, vP, vQ);
      if (t === tile && eR === created && out.chosen < 0) out.chosen = n;
      n++;
    }
  }
  return n;
}

/** Weights of the soft "reasonable player" model used to weigh deals. */
export interface ModelParams {
  /** Weights for seats of the other pair. */
  opp: number[];
  /** Weights for my partner (who plays this same strategy). */
  partner: number[];
  /** Tempering of the whole likelihood (0 = ignore plays, only voids). */
  lambda: number;
}

export const DEFAULT_MODEL: ModelParams = {
  opp: [0.12, 1.2, 0.3, 0.25, -0.05, 0.58, -0.5, 1.15, 0.26, -0.05, -0.18],
  partner: [0.08, 1.11, 0.21, 0.27, 0.04, 0.59, -0.45, 1.15, 0.24, -0.07, -0.12],
  lambda: 1,
};

const FEATS: Float64Array[] = Array.from({ length: 40 }, () => new Float64Array(NF));
const U = new Float64Array(40);
const OUT = { chosen: -1 };

/** log P(seat chose this play | its hand then) under the soft model. */
export function eventLogLik(ev: PlayEvent, hand: number, w: number[]): number {
  if (ev.forced) return 0;
  const n = enumerateOptions(FEATS, hand, ev.l, ev.r, ev.table, ev.vN, ev.vP, ev.vQ, ev.tile, ev.created, OUT);
  if (n <= 1 || OUT.chosen < 0) return 0;
  let maxU = -1e9;
  for (let i = 0; i < n; i++) {
    const f = FEATS[i];
    let u = 0;
    for (let k = 0; k < NF; k++) u += w[k] * f[k];
    U[i] = u;
    if (u > maxU) maxU = u;
  }
  let z = 0;
  for (let i = 0; i < n; i++) z += Math.exp(U[i] - maxU);
  return U[OUT.chosen] - maxU - Math.log(z);
}

export function seatLogLik(inf: Inference, seat: number, hidden: number, P: ModelParams): number {
  const w = ((seat - inf.me) & 1) === 0 ? P.partner : P.opp;
  let s = 0;
  for (const ev of inf.events[seat]) s += eventLogLik(ev, hidden | ev.fromHere, w);
  return s * P.lambda;
}

// ------------------------------------------------------------------ deal sampling (MCMC)

export interface Sampler {
  inf: Inference;
  P: ModelParams;
  others: number[];
  hidden: Int32Array; // current chain state, per seat
  ll: Float64Array; // per-seat log-likelihood of the current state
  useModel: boolean;
}

function initialDeal(inf: Inference, others: number[], rng: Rng, respect: boolean): Int32Array | null {
  const hidden = new Int32Array(4);
  const cap = others.map((s) => inf.counts[s]);
  const tiles: { id: number; opts: number; r: number }[] = [];
  let m = inf.unseen;
  while (m) {
    const b = m & -m;
    m ^= b;
    const id = bitIdx(b);
    let opts = 0;
    for (const s of others) if (!respect || inf.allowed[s] & b) opts++;
    tiles.push({ id, opts, r: rng() });
  }
  tiles.sort((a, b) => a.opts - b.opts || a.r - b.r);
  for (const { id } of tiles) {
    const b = 1 << id;
    let total = 0;
    for (let i = 0; i < others.length; i++) if (cap[i] > 0 && (!respect || inf.allowed[others[i]] & b)) total += cap[i];
    if (total === 0) return null;
    let x = rng() * total;
    for (let i = 0; i < others.length; i++) {
      if (cap[i] > 0 && (!respect || inf.allowed[others[i]] & b)) {
        x -= cap[i];
        if (x < 0) {
          hidden[others[i]] |= b;
          cap[i]--;
          break;
        }
      }
    }
  }
  return hidden;
}

export function makeSampler(inf: Inference, P: ModelParams, rng: Rng): Sampler {
  const others = [0, 1, 2, 3].filter((s) => s !== inf.me && inf.counts[s] > 0);
  let hidden: Int32Array | null = null;
  for (let a = 0; a < 80 && !hidden; a++) hidden = initialDeal(inf, others, rng, true);
  if (!hidden) hidden = initialDeal(inf, others, rng, false)!;
  const useModel = P.lambda > 0;
  const ll = new Float64Array(4);
  if (useModel) for (const s of others) ll[s] = seatLogLik(inf, s, hidden[s], P);
  return { inf, P, others, hidden, ll, useModel };
}

/** Restart the chain from a fresh constrained deal (keeps chains from getting stuck). */
export function restart(S: Sampler, rng: Rng) {
  let hidden: Int32Array | null = null;
  for (let a = 0; a < 40 && !hidden; a++) hidden = initialDeal(S.inf, S.others, rng, true);
  if (!hidden) return;
  S.hidden = hidden;
  if (S.useModel) for (const s of S.others) S.ll[s] = seatLogLik(S.inf, s, hidden[s], S.P);
}

function randomBit(m: number, rng: Rng): number {
  let k = Math.floor(rng() * popcnt(m));
  while (true) {
    const b = m & -m;
    if (k-- === 0) return b;
    m ^= b;
  }
}

/** Metropolis swap moves between two hidden hands; stationary law ∝ likelihood on consistent deals. */
export function mcmcSteps(S: Sampler, steps: number, rng: Rng) {
  const o = S.others;
  if (o.length < 2) return;
  const inf = S.inf;
  for (let k = 0; k < steps; k++) {
    const i = Math.floor(rng() * o.length);
    let j = Math.floor(rng() * (o.length - 1));
    if (j >= i) j++;
    const a = o[i];
    const b = o[j];
    // Only tiles that may legally move to the other seat.
    const fromA = S.hidden[a] & inf.allowed[b];
    const fromB = S.hidden[b] & inf.allowed[a];
    if (!fromA || !fromB) continue;
    const x = randomBit(fromA, rng);
    const y = randomBit(fromB, rng);
    // Proposal asymmetry correction (candidate-set sizes change after the swap).
    const na = S.hidden[a] ^ x ^ y;
    const nb = S.hidden[b] ^ y ^ x;
    const q = popcnt(fromA) * popcnt(fromB);
    const q2 = popcnt(na & inf.allowed[b]) * popcnt(nb & inf.allowed[a]);
    let logAcc = Math.log(q / q2);
    let lla = 0;
    let llb = 0;
    if (S.useModel) {
      lla = seatLogLik(inf, a, na, S.P);
      llb = seatLogLik(inf, b, nb, S.P);
      logAcc += lla + llb - S.ll[a] - S.ll[b];
    }
    if (logAcc >= 0 || rng() < Math.exp(logAcc)) {
      S.hidden[a] = na;
      S.hidden[b] = nb;
      S.ll[a] = lla;
      S.ll[b] = llb;
    }
  }
}
