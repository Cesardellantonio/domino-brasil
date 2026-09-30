/**
 * agent1 search: flat Monte Carlo over deals drawn from the inference sampler, with fast
 * bitmask rollouts and a match-equity leaf evaluation.
 */
import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { Rng } from '../../lib/rng';
import {
  bitIdx,
  buildInference,
  DBL,
  DEFAULT_MODEL,
  equity,
  makeSampler,
  maskPips,
  mcmcSteps,
  ModelParams,
  NM,
  other,
  PIP,
  restart,
  TA,
  TB,
} from './agent1-core';

export interface SearchParams {
  model: ModelParams;
  /** MCMC swap proposals between two consecutive samples. */
  thin: number;
  burn: number;
  /** Restart the chain every `restartEvery` samples. */
  restartEvery: number;
  /** Fraction of the budget actually used. */
  budgetFrac: number;
  minSamples: number;
  maxSamples: number;
  /** Leaf evaluation: 'equity' (match win probability) or 'pips' (penalty difference). */
  leaf: 'equity' | 'pips';
  /** Rollout policy weights. */
  rp: { pip: number; dbl: number; follow: number; noise: number; block: number };
}

export const DEFAULT_SEARCH: SearchParams = {
  model: DEFAULT_MODEL,
  thin: 6,
  burn: 40,
  restartEvery: 40,
  budgetFrac: 0.8,
  minSamples: 24,
  maxSamples: 4000,
  leaf: 'equity',
  rp: { pip: 0.5, dbl: 3, follow: 3, noise: 3, block: 3 },
};

type Play = Move & { t: 'play' };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** xorshift32 used inside rollouts (seeded from the strategy rng). */
let xs = 1;
const xr = () => {
  xs ^= xs << 13;
  xs ^= xs >>> 17;
  xs ^= xs << 5;
  return (xs >>> 0) / 4294967296;
};

interface LeafCtx {
  myTeam: number;
  my: number;
  opp: number;
  mult: number;
  leaf: 'equity' | 'pips';
}

function leafValue(c: LeafCtx, winner: number, pts: number): number {
  if (c.leaf === 'pips') return winner < 0 ? 0 : winner === c.myTeam ? pts : -pts;
  if (winner < 0) return 0.5 * (equity(1, c.my, c.opp) + equity(0, c.my, c.opp));
  if (winner === c.myTeam) return equity(1, c.my, c.opp + pts * c.mult);
  return equity(0, c.my + pts * c.mult, c.opp);
}

function blockedValue(c: LeafCtx, h: Int32Array): number {
  const p0 = maskPips(h[0]) + maskPips(h[2]);
  const p1 = maskPips(h[1]) + maskPips(h[3]);
  if (p0 === p1) return leafValue(c, -1, 0);
  return p0 < p1 ? leafValue(c, 0, p1) : leafValue(c, 1, p0);
}

/**
 * Greedy-with-noise rollout from `turn` with ends l,r (both >= 0). Mutates h.
 */
function rollout(h: Int32Array, l: number, r: number, turn: number, c: LeafCtx, rp: SearchParams['rp']): number {
  let passes = 0;
  for (let guard = 0; guard < 120; guard++) {
    const H = h[turn];
    const cand = H & (NM[l] | NM[r]);
    if (cand === 0) {
      if (++passes >= 4) return blockedValue(c, h);
      turn = (turn + 1) & 3;
      continue;
    }
    passes = 0;
    let bestT = -1;
    let bestL = l;
    let bestR = r;
    let bestSc = -1e9;
    let m = cand;
    const nextH = h[(turn + 1) & 3];
    while (m) {
      const b = m & -m;
      m ^= b;
      const t = bitIdx(b);
      const rest = H & ~b;
      if (rest === 0) {
        // Going out.
        h[turn] = 0;
        const w = turn & 1;
        return leafValue(c, w, maskPips(h[w ^ 1]) + maskPips(h[w ^ 3]));
      }
      const base = rp.pip * PIP[t] + rp.dbl * DBL[t] + rp.noise * xr();
      if (TA[t] === l || TB[t] === l) {
        const nl = other(t, l);
        let sc = base;
        if (rest & (NM[nl] | NM[r])) sc += rp.follow;
        if (rp.block && !(nextH & (NM[nl] | NM[r]))) sc += rp.block;
        if (sc > bestSc) {
          bestSc = sc;
          bestT = t;
          bestL = nl;
          bestR = r;
        }
      }
      if ((TA[t] === r || TB[t] === r) && l !== r) {
        const nr = other(t, r);
        let sc = base;
        if (rest & (NM[l] | NM[nr])) sc += rp.follow;
        if (rp.block && !(nextH & (NM[l] | NM[nr]))) sc += rp.block;
        if (sc > bestSc) {
          bestSc = sc;
          bestT = t;
          bestL = l;
          bestR = nr;
        }
      }
    }
    h[turn] &= ~(1 << bestT);
    l = bestL;
    r = bestR;
    turn = (turn + 1) & 3;
  }
  return blockedValue(c, h);
}

/** Moves without mirror duplicates (both ends equal). */
export function uniquePlays(v: PlayerView): Play[] {
  const out: Play[] = [];
  const seen = new Set<string>();
  for (const m of v.legal) {
    if (m.t !== 'play') continue;
    let key = `${m.id}`;
    if (v.ends) {
      const ne = m.side === 'L' ? [other(m.id, v.ends[0]), v.ends[1]] : [v.ends[0], other(m.id, v.ends[1])];
      key += `:${Math.min(ne[0], ne[1])},${Math.max(ne[0], ne[1])}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export interface SearchStats {
  samples: number;
  values: number[];
}

export function searchMove(v: PlayerView, plays: Play[], rng: Rng, budgetMs: number, SP: SearchParams, stats?: SearchStats): Play {
  const start = now();
  const deadline = start + budgetMs * SP.budgetFrac;
  const inf = buildInference(v);
  const S = makeSampler(inf, SP.model, rng);
  mcmcSteps(S, SP.burn, rng);
  const me = v.seat;
  const myTeam = me & 1;
  const c: LeafCtx = {
    myTeam,
    my: v.scores[myTeam],
    opp: v.scores[myTeam ^ 1],
    mult: v.multiplier,
    leaf: SP.leaf,
  };
  const myMask = inf.myMask;
  // Precompute the result of each candidate move.
  const mv = plays.map((m) => {
    let l: number, r: number;
    if (!v.ends) {
      l = TA[m.id];
      r = TB[m.id];
    } else if (m.side === 'L') {
      l = other(m.id, v.ends[0]);
      r = v.ends[1];
    } else {
      l = v.ends[0];
      r = other(m.id, v.ends[1]);
    }
    return { l, r, bit: 1 << m.id };
  });
  const totals = new Float64Array(plays.length);
  const h = new Int32Array(4);
  let samples = 0;
  while (samples < SP.maxSamples && (samples < SP.minSamples || now() < deadline)) {
    if (samples > 0) {
      if (samples % SP.restartEvery === 0) {
        restart(S, rng);
        mcmcSteps(S, SP.burn, rng);
      } else mcmcSteps(S, SP.thin, rng);
    }
    const seed = (Math.floor(rng() * 4294967296) | 1) >>> 0;
    for (let i = 0; i < plays.length; i++) {
      for (let s = 0; s < 4; s++) h[s] = s === me ? myMask : S.hidden[s];
      h[me] &= ~mv[i].bit;
      xs = seed;
      let val: number;
      if (h[me] === 0) {
        val = leafValue(c, myTeam, maskPips(h[myTeam ^ 1]) + maskPips(h[myTeam ^ 3]));
      } else val = rollout(h, mv[i].l, mv[i].r, (me + 1) & 3, c, SP.rp);
      totals[i] += val;
    }
    samples++;
  }
  let best = 0;
  for (let i = 1; i < plays.length; i++) if (totals[i] > totals[best]) best = i;
  if (stats) {
    stats.samples = samples;
    stats.values = Array.from(totals, (x) => x / samples);
  }
  return plays[best];
}
