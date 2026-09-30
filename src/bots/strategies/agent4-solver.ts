/**
 * agent4 ("O Trancador") perfect-information solver for one determinized deal.
 *
 * Hands are 28-bit masks. Teams alternate with the seat order (0,1,2,3 -> team 0,1,0,1), so a
 * perfect-information hand of dupla is a two-player zero-sum game: team 0 maximizes, team 1
 * minimizes. Terminal utilities come from lookup tables so the caller can plug in either the
 * raw penalty difference or a match-equity (race-to-100) utility.
 */
import { ALL_TILES } from '../../engine/tiles';

export const TA = ALL_TILES.map((t) => t.a);
export const TB = ALL_TILES.map((t) => t.b);
export const PIP = ALL_TILES.map((t) => t.a + t.b);
/** NM[n] = mask of tiles carrying number n. */
export const NM: number[] = (() => {
  const out = new Array(7).fill(0);
  for (let id = 0; id < 28; id++) {
    out[TA[id]] |= 1 << id;
    out[TB[id]] |= 1 << id;
  }
  return out;
})();

export const bitCount = (x: number) => {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
/** Index of the lowest set bit. */
export const lowBit = (x: number) => 31 - Math.clz32(x & -x);

export const maskPips = (m: number) => {
  let s = 0;
  while (m) {
    const b = m & -m;
    s += PIP[31 - Math.clz32(b)];
    m ^= b;
  }
  return s;
}

/**
 * Terminal utility tables (team-0 perspective).
 * win0[p]  = utility when team 0 wins the hand and team 1 is left with p pips (already x multiplier by caller).
 * win1[p]  = utility when team 1 wins and team 0 holds p pips.
 * tie      = utility of a tied lock.
 */
export interface Utility {
  win0: Float64Array;
  win1: Float64Array;
  tie: number;
}

export function linearUtility(mult: number): Utility {
  const win0 = new Float64Array(400);
  const win1 = new Float64Array(400);
  for (let p = 0; p < 400; p++) {
    win0[p] = p * mult;
    win1[p] = -p * mult;
  }
  return { win0, win1, tie: 0 };
}

export class Solver {
  hands = new Int32Array(4);
  pips = new Int32Array(4);
  nodes = 0;
  nodeLimit = Infinity;
  aborted = false;
  u: Utility = linearUtility(1);
  // Move buffers per ply (id, side, newL, newR).
  private buf: Int32Array[] = Array.from({ length: 64 }, () => new Int32Array(64));
  // Transposition table. Within one deal the set of remaining tiles determines every hand.
  useTT = false;
  private ttBits = 18;
  private ttKey = new Float64Array(1 << 18);
  private ttVal = new Float64Array(1 << 18);
  private ttFlag = new Uint8Array(1 << 18); // 1 exact, 2 lower bound, 3 upper bound
  private ttGen = new Int32Array(1 << 18);
  private gen = 1;

  setup(hands: number[], u: Utility) {
    for (let s = 0; s < 4; s++) {
      this.hands[s] = hands[s];
      this.pips[s] = maskPips(hands[s]);
    }
    this.u = u;
    this.gen++;
  }

  private blocked(): number {
    const t0 = this.pips[0] + this.pips[2];
    const t1 = this.pips[1] + this.pips[3];
    if (t0 < t1) return this.u.win0[t1];
    if (t1 < t0) return this.u.win1[t0];
    return this.u.tie;
  }

  /** Value (team-0 perspective) of the position with `turn` to act on ends l/r. */
  search(turn: number, l: number, r: number, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    if (this.nodes > this.nodeLimit) {
      this.aborted = true;
      return 0;
    }
    const open = NM[l] | NM[r];
    const hands = this.hands;
    let m = hands[turn] & open;
    if (m === 0) {
      let t = turn;
      for (let k = 1; k < 4; k++) {
        t = (turn + k) & 3;
        if (hands[t] & open) break;
      }
      if ((hands[t] & open) === 0) return this.blocked();
      turn = t;
      m = hands[turn] & open;
    }
    const max = (turn & 1) === 0;
    let slot = -1;
    let key = 0;
    const alpha0 = alpha;
    const beta0 = beta;
    const rem = hands[0] | hands[1] | hands[2] | hands[3];
    if (this.useTT && bitCount(rem) > 5) {
      const lo = l < r ? l : r;
      const hi = l < r ? r : l;
      const tag = (lo * 7 + hi) * 4 + turn;
      key = rem * 256 + tag;
      slot = (Math.imul(rem ^ Math.imul(tag + 1, 0x27d4eb2d), 0x9e3779b1) >>> (32 - this.ttBits));
      if (this.ttGen[slot] === this.gen && this.ttKey[slot] === key) {
        const f = this.ttFlag[slot];
        const tv = this.ttVal[slot];
        if (f === 1) return tv;
        if (f === 2) { if (tv > alpha) alpha = tv; }
        else if (tv < beta) beta = tv;
        if (alpha >= beta) return tv;
      }
    }
    // Collect moves.
    const buf = this.buf[ply];
    let n = 0;
    while (m) {
      const b = m & -m;
      m ^= b;
      const id = 31 - Math.clz32(b);
      const a = TA[id];
      const bb = TB[id];
      if (a === l || bb === l) {
        buf[n++] = id;
        buf[n++] = a === l ? bb : a; // new left
        buf[n++] = r;
        buf[n++] = PIP[id] * 4 + (a === bb ? 3 : 0);
      }
      if (l !== r && (a === r || bb === r)) {
        buf[n++] = id;
        buf[n++] = l;
        buf[n++] = a === r ? bb : a;
        buf[n++] = PIP[id] * 4 + (a === bb ? 3 : 0);
      }
    }
    // Order: heavier first (simple insertion sort on key).
    const cnt = n >> 2;
    for (let i = 1; i < cnt; i++) {
      for (let j = i; j > 0 && buf[j * 4 + 3] > buf[(j - 1) * 4 + 3]; j--) {
        for (let q = 0; q < 4; q++) {
          const tmp = buf[j * 4 + q];
          buf[j * 4 + q] = buf[(j - 1) * 4 + q];
          buf[(j - 1) * 4 + q] = tmp;
        }
      }
    }
    const next = (turn + 1) & 3;
    let best = max ? -Infinity : Infinity;
    for (let i = 0; i < cnt; i++) {
      const id = buf[i * 4];
      const bit = 1 << id;
      hands[turn] ^= bit;
      this.pips[turn] -= PIP[id];
      let v: number;
      if (hands[turn] === 0) {
        v = max ? this.u.win0[this.pips[1] + this.pips[3]] : this.u.win1[this.pips[0] + this.pips[2]];
      } else {
        v = this.search(next, buf[i * 4 + 1], buf[i * 4 + 2], alpha, beta, ply + 1);
      }
      hands[turn] ^= bit;
      this.pips[turn] += PIP[id];
      if (this.aborted) return 0;
      if (max) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) break;
    }
    if (slot >= 0) {
      this.ttGen[slot] = this.gen;
      this.ttKey[slot] = key;
      this.ttVal[slot] = best;
      this.ttFlag[slot] = best <= alpha0 ? 3 : best >= beta0 ? 2 : 1;
    }
    return best;
  }

  /**
   * Value after `turn` plays tile `id` making ends (nl, nr). Assumes the tile is in hands[turn].
   */
  valueAfter(turn: number, id: number, nl: number, nr: number, alpha = -Infinity, beta = Infinity): number {
    const bit = 1 << id;
    this.hands[turn] ^= bit;
    this.pips[turn] -= PIP[id];
    let v: number;
    if (this.hands[turn] === 0) {
      v = (turn & 1) === 0 ? this.u.win0[this.pips[1] + this.pips[3]] : this.u.win1[this.pips[0] + this.pips[2]];
    } else v = this.search((turn + 1) & 3, nl, nr, alpha, beta, 0);
    this.hands[turn] ^= bit;
    this.pips[turn] += PIP[id];
    return v;
  }

  /**
   * Play a fast greedy policy (heavy tiles, doubles, keep a follow-up) from `turn` until at most
   * `stopAt` tiles remain in all hands, then solve exactly. Mutates hands; caller restores.
   * Returns the team-0 utility.
   */
  rolloutSolve(turn: number, l: number, r: number, stopAt: number, rng: () => number): number {
    const hands = this.hands;
    let passes = 0;
    for (let guard = 0; guard < 200; guard++) {
      const rem = hands[0] | hands[1] | hands[2] | hands[3];
      if (bitCount(rem) <= stopAt) return this.search(turn, l, r, -Infinity, Infinity, 0);
      const h = hands[turn];
      let m = h & (NM[l] | NM[r]);
      if (m === 0) {
        passes++;
        if (passes >= 4) return this.blocked();
        turn = (turn + 1) & 3;
        continue;
      }
      passes = 0;
      let bestId = -1;
      let bestL = 0;
      let bestR = 0;
      let bestSc = -1e9;
      while (m) {
        const b = m & -m;
        m ^= b;
        const id = 31 - Math.clz32(b);
        const a = TA[id];
        const bb = TB[id];
        const rest = h ^ b;
        for (let side = 0; side < 2; side++) {
          let nl = l;
          let nr = r;
          if (side === 0) {
            if (a !== l && bb !== l) continue;
            nl = a === l ? bb : a;
          } else {
            if (l === r || (a !== r && bb !== r)) continue;
            nr = a === r ? bb : a;
          }
          let sc = PIP[id] + (a === bb ? 4 : 0) + rng() * 3;
          if (rest & (NM[nl] | NM[nr])) sc += 3;
          if (sc > bestSc) {
            bestSc = sc;
            bestId = id;
            bestL = nl;
            bestR = nr;
          }
        }
      }
      hands[turn] ^= 1 << bestId;
      this.pips[turn] -= PIP[bestId];
      if (hands[turn] === 0) {
        return (turn & 1) === 0 ? this.u.win0[this.pips[1] + this.pips[3]] : this.u.win1[this.pips[0] + this.pips[2]];
      }
      l = bestL;
      r = bestR;
      turn = (turn + 1) & 3;
    }
    return this.blocked();
  }

  /** Blocked-hand utility for the current hands (public for callers). */
  lockValue(): number {
    return this.blocked();
  }
}
