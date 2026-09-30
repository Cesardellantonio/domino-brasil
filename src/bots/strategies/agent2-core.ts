/**
 * agent2 core: allocation-free bitmask simulator for 4-player partnership dominoes
 * (double-six, no boneyard), an exact-uniform sampler of hidden hands, an alpha-beta
 * perfect-information solver and a cheap semi-omniscient rollout policy.
 *
 * Hands are 28-bit masks (bit = tile id). Ends are numbers 0..6.
 */
import { ALL_TILES } from '../../engine/tiles';
import { Rng } from '../../lib/rng';

export const TA = new Int8Array(28);
export const TB = new Int8Array(28);
export const PIP = new Int8Array(28);
/** NM[n] = mask of tiles containing number n. */
export const NM = new Int32Array(7);
export let DOUBLES = 0;
for (const t of ALL_TILES) {
  TA[t.id] = t.a;
  TB[t.id] = t.b;
  PIP[t.id] = t.a + t.b;
  NM[t.a] |= 1 << t.id;
  NM[t.b] |= 1 << t.id;
  if (t.a === t.b) DOUBLES |= 1 << t.id;
}
export const ALL_MASK = (1 << 28) - 1;

const PIPLO = new Uint8Array(1 << 14);
const PIPHI = new Uint8Array(1 << 14);
for (let m = 1; m < 1 << 14; m++) {
  const low = 31 - Math.clz32(m & -m);
  PIPLO[m] = PIPLO[m & (m - 1)] + PIP[low];
  PIPHI[m] = PIPHI[m & (m - 1)] + PIP[low + 14];
}
export const pipsM = (m: number) => PIPLO[m & 0x3fff] + PIPHI[m >>> 14];
export function popc(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}
export const other = (t: number, n: number) => (TA[t] === n ? TB[t] : TA[t]);

// ------------------------------------------------------------------ sampler

/**
 * Exact uniform sampler over assignments of the unseen tiles to the three other seats,
 * given hand counts and per-seat void numbers. Built once per decision.
 */
export class Sampler {
  seats: number[];
  caps: number[];
  tiles: number[];
  allowed: Int8Array;
  f: Float64Array;
  ok: boolean;
  constructor(me: number, counts: number[], unseen: number, voids: number[]) {
    this.seats = [1, 2, 3].map((d) => (me + d) & 3);
    this.caps = this.seats.map((s) => counts[s]);
    const tiles: number[] = [];
    for (let t = 0; t < 28; t++) if (unseen & (1 << t)) tiles.push(t);
    this.tiles = tiles;
    const N = tiles.length;
    this.allowed = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      const t = tiles[i];
      let a = 0;
      for (let k = 0; k < 3; k++) {
        const v = voids[this.seats[k]];
        if (!(v & (1 << TA[t])) && !(v & (1 << TB[t]))) a |= 1 << k;
      }
      this.allowed[i] = a;
    }
    this.f = new Float64Array((N + 1) * 64);
    this.ok = this.build();
    if (!this.ok) {
      // Inconsistent constraints (should not happen): ignore voids.
      this.allowed.fill(7);
      this.ok = this.build();
    }
  }
  private build(): boolean {
    const N = this.tiles.length;
    const f = this.f;
    f.fill(0);
    f[N * 64] = 1;
    for (let i = N - 1; i >= 0; i--) {
      const al = this.allowed[i];
      const rem = N - i;
      for (let a = 0; a <= 7; a++)
        for (let b = 0; b <= 7; b++) {
          const c = rem - a - b;
          if (c < 0 || c > 7) continue;
          let v = 0;
          const nx = (i + 1) * 64;
          if (al & 1 && a > 0) v += f[nx + (a - 1) * 8 + b];
          if (al & 2 && b > 0) v += f[nx + a * 8 + b - 1];
          if (al & 4 && c > 0) v += f[nx + a * 8 + b];
          f[i * 64 + a * 8 + b] = v;
        }
    }
    const [c0, c1, c2] = this.caps;
    return c0 + c1 + c2 === N && c0 <= 7 && c1 <= 7 && f[c0 * 8 + c1] > 0;
  }
  /** Fills out[seat] with sampled masks for the three other seats. */
  sample(rng: Rng, out: Int32Array) {
    const N = this.tiles.length;
    const f = this.f;
    let a = this.caps[0];
    let b = this.caps[1];
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < N; i++) {
      const al = this.allowed[i];
      const c = N - i - a - b;
      const nx = (i + 1) * 64;
      const w0 = al & 1 && a > 0 ? f[nx + (a - 1) * 8 + b] : 0;
      const w1 = al & 2 && b > 0 ? f[nx + a * 8 + b - 1] : 0;
      const w2 = al & 4 && c > 0 ? f[nx + a * 8 + b] : 0;
      let x = rng() * (w0 + w1 + w2);
      const bit = 1 << this.tiles[i];
      if (x < w0) {
        m0 |= bit;
        a--;
      } else if ((x -= w0) < w1) {
        m1 |= bit;
        b--;
      } else m2 |= bit;
    }
    out[this.seats[0]] = m0;
    out[this.seats[1]] = m1;
    out[this.seats[2]] = m2;
  }
}

// ------------------------------------------------------------------ leaf values

/**
 * Leaf evaluator: called when the hand ends. winnerTeam = team that won (-1 tie),
 * pips0/pips1 = pips held by team 0 / team 1. Returns value for `rootTeam`.
 */
export type Leaf = (winnerTeam: number, pips0: number, pips1: number) => number;

// ------------------------------------------------------------------ solver

/** Shared mutable world. */
export const H = new Int32Array(4);
let ROOT_TEAM = 0;
let LEAF: Leaf = () => 0;
export let nodes = 0;

export function leafAfterPlay(turn: number, l: number, r: number): number {
  // Called after H[turn] had a tile removed. Returns NaN if hand continues.
  if (H[turn] === 0) return LEAF(turn & 1, pipsM(H[0]) + pipsM(H[2]), pipsM(H[1]) + pipsM(H[3]));
  if (((H[0] | H[1] | H[2] | H[3]) & (NM[l] | NM[r])) === 0) {
    const p0 = pipsM(H[0]) + pipsM(H[2]);
    const p1 = pipsM(H[1]) + pipsM(H[3]);
    return LEAF(p0 < p1 ? 0 : p0 > p1 ? 1 : -1, p0, p1);
  }
  return NaN;
}

function ab(turn: number, l: number, r: number, alpha: number, beta: number): number {
  nodes++;
  let h = H[turn];
  let cand = h & (NM[l] | NM[r]);
  while (cand === 0) {
    turn = (turn + 1) & 3;
    h = H[turn];
    cand = h & (NM[l] | NM[r]);
  }
  const maxing = (turn & 1) === ROOT_TEAM;
  const nt = (turn + 1) & 3;
  let best = maxing ? -1e9 : 1e9;
  while (cand) {
    const t = 31 - Math.clz32(cand);
    cand ^= 1 << t;
    H[turn] = h ^ (1 << t);
    for (let side = 0; side < 2; side++) {
      let nl = l;
      let nr = r;
      if (side === 0) {
        if (TA[t] !== l && TB[t] !== l) continue;
        nl = TA[t] === l ? TB[t] : TA[t];
      } else {
        if (TA[t] !== r && TB[t] !== r) continue;
        if (l === r) continue;
        nr = TA[t] === r ? TB[t] : TA[t];
      }
      let v = leafAfterPlay(turn, nl, nr);
      if (v !== v) v = ab(nt, nl, nr, alpha, beta);
      if (maxing) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) {
        H[turn] = h;
        return best;
      }
    }
    H[turn] = h;
  }
  return best;
}

export function setContext(rootTeam: number, leaf: Leaf) {
  ROOT_TEAM = rootTeam;
  LEAF = leaf;
}

/**
 * Value of the current world (H, ends l/r, `turn` to move) under perfect play.
 */
export function solve(turn: number, l: number, r: number): number {
  return ab(turn, l, r, -1e9, 1e9);
}

// ------------------------------------------------------------------ rollout

export interface PolicyW {
  pip: number;
  dbl: number;
  oppPass: number;
  partnerPass: number;
  follow: number;
  noise: number;
  block: number;
  /** Weight per remaining own tile matching the new ends (number control, no peeking). */
  ctrl: number;
}

export const DEFAULT_POLICY: PolicyW = { pip: 1, dbl: 3, oppPass: 6, partnerPass: 3, follow: 3, noise: 2, block: 30, ctrl: 0 };

/**
 * Play the hand out from (turn, l, r) with a greedy semi-omniscient policy, switching to the
 * exact solver once at most `solveAt` tiles remain in hands. Returns the leaf value.
 */
export function rollout(turn: number, l: number, r: number, rng: Rng, P: PolicyW, solveAt: number): number {
  for (let guard = 0; guard < 64; guard++) {
    if (solveAt > 0 && popc(H[0] | H[1] | H[2] | H[3]) <= solveAt) return solve(turn, l, r);
    const h = H[turn];
    let cand = h & (NM[l] | NM[r]);
    if (cand === 0) {
      turn = (turn + 1) & 3;
      continue;
    }
    const opp = H[(turn + 1) & 3];
    const partner = H[(turn + 2) & 3];
    let bestT = -1;
    let bestL = l;
    let bestR = r;
    let bestS = -1e9;
    while (cand) {
      const t = 31 - Math.clz32(cand);
      cand ^= 1 << t;
      const rest = h ^ (1 << t);
      for (let side = 0; side < 2; side++) {
        let nl = l;
        let nr = r;
        if (side === 0) {
          if (TA[t] !== l && TB[t] !== l) continue;
          nl = TA[t] === l ? TB[t] : TA[t];
        } else {
          if (TA[t] !== r && TB[t] !== r) continue;
          if (l === r) continue;
          nr = TA[t] === r ? TB[t] : TA[t];
        }
        let sc: number;
        if (rest === 0) sc = 1e6;
        else {
          const em = NM[nl] | NM[nr];
          sc = PIP[t] * P.pip + rng() * P.noise;
          if (TA[t] === TB[t]) sc += P.dbl;
          if ((opp & em) === 0) sc += P.oppPass;
          if ((partner & em) === 0) sc -= P.partnerPass;
          if (rest & em) sc += P.follow + P.ctrl * popc(rest & em);
          if (((rest | opp | partner | H[(turn + 3) & 3]) & em) === 0) {
            // This play locks the game.
            const pu = pipsM(rest) + pipsM(partner);
            const pt = pipsM(opp) + pipsM(H[(turn + 3) & 3]);
            sc += pu < pt ? P.block : pu > pt ? -P.block : 0;
          }
        }
        if (sc > bestS) {
          bestS = sc;
          bestT = t;
          bestL = nl;
          bestR = nr;
        }
      }
    }
    H[turn] = h ^ (1 << bestT);
    const v = leafAfterPlay(turn, bestL, bestR);
    if (v === v) return v;
    l = bestL;
    r = bestR;
    turn = (turn + 1) & 3;
  }
  return 0;
}
