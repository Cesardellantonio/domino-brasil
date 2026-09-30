/**
 * agent3 ("Parceiro") search core: bitmask hands, a cooperative greedy rollout policy and an
 * exact alpha-beta endgame solver on one determinized deal. Values are the match-win
 * probability of the side to evaluate (see agent3-match.ts), so they are team-zero-sum.
 */
import { ALL_TILES } from '../../engine/tiles';

export const A = ALL_TILES.map((t) => t.a);
export const B = ALL_TILES.map((t) => t.b);
export const PIPS = ALL_TILES.map((t) => t.a + t.b);
export const DBL = ALL_TILES.map((t) => t.a === t.b);
/** NUM[n] = mask of the tiles carrying number n. */
export const NUM: number[] = [0, 1, 2, 3, 4, 5, 6].map((n) => ALL_TILES.reduce((m, t) => (t.a === n || t.b === n ? m | (1 << t.id) : m), 0));
export const other = (id: number, n: number) => (A[id] === n ? B[id] : A[id]);
export const lowBit = (x: number) => 31 - Math.clz32(x & -x);

const PIPLO = new Uint8Array(1 << 14);
const PIPHI = new Uint8Array(1 << 14);
for (let m = 1; m < 1 << 14; m++) {
  const t = lowBit(m);
  PIPLO[m] = PIPLO[m & (m - 1)] + PIPS[t];
  PIPHI[m] = PIPHI[m & (m - 1)] + PIPS[t + 14];
}
export const pipsM = (m: number) => PIPLO[m & 0x3fff] + PIPHI[m >>> 14];
export function popc(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

// ------------------------------------------------------------------ policy weights

export interface Policy {
  pip: number;
  dbl: number;
  follow: number;
  nextPass: number;
  partnerPass: number;
  /** bonus when the move leaves the next opponent able to go out... negative weight */
  lock: number;
  noise: number;
}

export const POLICY: Policy = { pip: 1, dbl: 3, follow: 3, nextPass: 5, partnerPass: 2, lock: 40, noise: 2.5 };

// ------------------------------------------------------------------ state

/** Hands being simulated (mutated by rollout / solver). */
export const H = new Int32Array(4);

/** Utility context: value of outcomes for `myTeam`. */
let myTeam = 0;
let uWin: Float64Array = new Float64Array(170);
let uLose: Float64Array = new Float64Array(170);
let uTie = 0.5;
export function setUtility(team: number, win: Float64Array, lose: Float64Array, tie: number) {
  myTeam = team;
  uWin = win;
  uLose = lose;
  uTie = tie;
}

export function leaf(team: number, pts: number): number {
  if (team < 0) return uTie;
  if (pts > 169) pts = 169;
  return team === myTeam ? uWin[pts] : uLose[pts];
}

function blockedValue(): number {
  const t0 = pipsM(H[0] | H[2]);
  const t1 = pipsM(H[1] | H[3]);
  if (t0 === t1) return uTie;
  return t0 < t1 ? leaf(0, t1) : leaf(1, t0);
}

// ------------------------------------------------------------------ fast PRNG seeded by the caller

let xs = 1;
export function seedX(seed: number) {
  xs = seed >>> 0 || 1;
}
const xr = () => {
  xs ^= xs << 13;
  xs ^= xs >>> 17;
  xs ^= xs << 5;
  return (xs >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ exact solver

export let nodes = 0;
export let nodeLimit = 1e9;
export function resetNodes(limit: number) {
  nodes = 0;
  nodeLimit = limit;
}

const MOVES = new Int32Array(64 * 16); // per depth: up to 14 (tile, side) entries
function ab(turn: number, l: number, r: number, passes: number, alpha: number, beta: number, depth: number): number {
  nodes++;
  const h = H[turn];
  const cand = h & (NUM[l] | NUM[r]);
  if (!cand) {
    if (passes >= 3) return blockedValue();
    return ab((turn + 1) & 3, l, r, passes + 1, alpha, beta, depth + 1);
  }
  const team = turn & 1;
  if ((h & (h - 1)) === 0) return leaf(team, pipsM(H[(turn + 1) & 3] | H[(turn + 3) & 3]));
  // collect moves, heavy first
  const base = depth * 16;
  let n = 0;
  let c = cand;
  while (c) {
    const t = lowBit(c);
    c &= c - 1;
    const fl = A[t] === l || B[t] === l;
    const fr = A[t] === r || B[t] === r;
    if (fl) MOVES[base + n++] = t * 2;
    if (fr && !(fl && l === r)) MOVES[base + n++] = t * 2 + 1;
  }
  // insertion sort by pips desc
  for (let i = 1; i < n; i++) {
    const x = MOVES[base + i];
    const px = PIPS[x >> 1];
    let j = i - 1;
    while (j >= 0 && PIPS[MOVES[base + j] >> 1] < px) {
      MOVES[base + j + 1] = MOVES[base + j];
      j--;
    }
    MOVES[base + j + 1] = x;
  }
  const maxi = team === myTeam;
  let best = maxi ? -1 : 2;
  for (let i = 0; i < n; i++) {
    const mv = MOVES[base + i];
    const t = mv >> 1;
    let nl = l;
    let nr = r;
    if (mv & 1) nr = other(t, r);
    else nl = other(t, l);
    H[turn] = h & ~(1 << t);
    const val = ab((turn + 1) & 3, nl, nr, 0, alpha, beta, depth + 1);
    H[turn] = h;
    if (maxi) {
      if (val > best) {
        best = val;
        if (best > alpha) alpha = best;
      }
    } else if (val < best) {
      best = val;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

export function solve(turn: number, l: number, r: number, passes: number): number {
  return ab(turn, l, r, passes, -1, 2, 0);
}

// ------------------------------------------------------------------ rollout

/**
 * Plays the sampled deal greedily until at most `solveAt` tiles remain in all hands, then
 * solves the rest exactly. Returns the utility for myTeam. Mutates H.
 */
export function rollout(l: number, r: number, turn: number, passes: number, solveAt: number): number {
  const P = POLICY;
  let total = popc(H[0]) + popc(H[1]) + popc(H[2]) + popc(H[3]);
  for (let guard = 0; guard < 80; guard++) {
    if (total <= solveAt) return solve(turn, l, r, passes);
    const h = H[turn];
    const cand = h & (NUM[l] | NUM[r]);
    if (cand === 0) {
      passes++;
      if (passes >= 4) return blockedValue();
      turn = (turn + 1) & 3;
      continue;
    }
    passes = 0;
    if ((h & (h - 1)) === 0) {
      H[turn] = 0;
      return leaf(turn & 1, pipsM(H[(turn + 1) & 3] | H[(turn + 3) & 3]));
    }
    const nx = H[(turn + 1) & 3];
    const pt = H[(turn + 2) & 3];
    const all = H[0] | H[1] | H[2] | H[3];
    let bestT = -1;
    let bestL = 0;
    let bestR = 0;
    let bestS = -1e9;
    let c = cand;
    while (c) {
      const t = lowBit(c);
      c &= c - 1;
      const rest = h & ~(1 << t);
      const base = PIPS[t] * P.pip + (DBL[t] ? P.dbl : 0);
      for (let side = 0; side < 2; side++) {
        let nl: number;
        let nr: number;
        if (side === 0) {
          if (A[t] !== l && B[t] !== l) continue;
          nl = other(t, l);
          nr = r;
        } else {
          if (A[t] !== r && B[t] !== r) continue;
          if (l === r) continue;
          nl = l;
          nr = other(t, r);
        }
        const E = NUM[nl] | NUM[nr];
        let sc = base + xr() * P.noise;
        if (rest & E) sc += P.follow;
        if (!(nx & E)) sc += P.nextPass;
        if (!(pt & E)) sc -= P.partnerPass;
        if (!(all & ~(1 << t) & E)) {
          const my = pipsM(rest | pt);
          const op = pipsM(nx | H[(turn + 3) & 3]);
          sc += my < op ? P.lock : my > op ? -P.lock : 0;
        }
        if (sc > bestS) {
          bestS = sc;
          bestT = t;
          bestL = nl;
          bestR = nr;
        }
      }
    }
    H[turn] = h & ~(1 << bestT);
    total--;
    l = bestL;
    r = bestR;
    turn = (turn + 1) & 3;
  }
  return blockedValue();
}
