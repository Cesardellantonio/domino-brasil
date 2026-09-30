import { chooseMove } from '../bots';
import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { Rng } from '../../lib/rng';
import { Strategy } from './types';
import { afterHandValue } from './agent2-value';
import { PlayModel, SEARCH_MODEL, SHARP_MODEL, collectEvents, logLik } from './agent2-infer';
import {
  DEFAULT_POLICY,
  H,
  Leaf,
  PolicyW,
  Sampler,
  TA,
  TB,
  leafAfterPlay,
  popc,
  rollout,
  setContext,
  solve,
} from './agent2-core';

export interface A2Config {
  /** Rollouts switch to the exact solver when at most this many tiles remain in hands. */
  solveAt: number;
  /** Solve exactly from the root when at most this many tiles remain after my move. */
  rootSolve: number;
  /** Fraction of the budget actually used. */
  safety: number;
  policy: PolicyW;
  /** Leaf value: 'diff' = signed penalty points of the hand, 'match' = match win probability. */
  value: 'diff' | 'match';
  /** Strength of play-based inference (0 = only passes are used). Scales the play model. */
  infer: number;
  model: 'search' | 'sharp';
}

export const A2_DEFAULT: A2Config = { solveAt: 12, rootSolve: 18, safety: 0.85, policy: DEFAULT_POLICY, value: 'diff', infer: 1, model: 'search' };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Cand {
  move: Move;
  t: number;
  l: number;
  r: number;
}

function candidates(v: PlayerView): Cand[] {
  const out: Cand[] = [];
  const seen = new Set<string>();
  for (const m of v.legal) {
    if (m.t !== 'play') continue;
    let l: number, r: number;
    if (!v.ends) {
      l = TA[m.id];
      r = TB[m.id];
    } else if (m.side === 'L') {
      l = TA[m.id] === v.ends[0] ? TB[m.id] : TA[m.id];
      r = v.ends[1];
    } else {
      l = v.ends[0];
      r = TA[m.id] === v.ends[1] ? TB[m.id] : TA[m.id];
    }
    const key = `${m.id}:${Math.min(l, r)}:${Math.max(l, r)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ move: m, t: m.id, l, r });
  }
  return out;
}

function think(v: PlayerView, rng: Rng, budgetMs: number, CFG: A2Config): Move {
  const start = now();
  const me = v.seat;
  const cands = candidates(v);
  if (cands.length === 0) return v.legal[0];
  if (cands.length === 1) return cands[0].move;

  let myMask = 0;
  for (const id of v.myHand) myMask |= 1 << id;
  let table = 0;
  if (v.root) table |= 1 << v.root.id;
  for (const p of v.left) table |= 1 << p.id;
  for (const p of v.right) table |= 1 << p.id;
  const unseen = ((1 << 28) - 1) & ~myMask & ~table;
  const voids = [0, 0, 0, 0];
  for (const e of v.log) if (e.t === 'pass' && e.ends) voids[e.seat] |= (1 << e.ends[0]) | (1 << e.ends[1]);
  const sampler = new Sampler(me, v.counts, unseen, voids);

  const T = me & 1;
  const mult = v.multiplier;
  const us = v.scores[T] ?? 0;
  const them = v.scores[1 - T] ?? 0;
  const starterTeam = v.starter & 1;
  const leaf: Leaf =
    CFG.value === 'match'
      ? (w, p0, p1) => afterHandValue(us, them, T, w, (w === 0 ? p1 : p0) * mult, mult, starterTeam)
      : (w, p0, p1) => {
          if (w < 0) return 0;
          const loser = w === 0 ? p1 : p0;
          return (w === T ? loser : -loser) * mult;
        };
  setContext(T, leaf);

  const nC = cands.length;
  const tot = new Float64Array(nC);
  const evs = CFG.infer > 0 ? collectEvents(v) : [];
  const base0 = CFG.model === 'sharp' ? SHARP_MODEL : SEARCH_MODEL;
  const pm: PlayModel = { pip: base0.pip * CFG.infer, dbl: base0.dbl * CFG.infer, fol: base0.fol * CFG.infer, suit: base0.suit * CFG.infer };
  const models = [pm, pm, pm, pm];
  const base = new Int32Array(4);
  const next = (me + 1) & 3;
  const deadline = start + budgetMs * CFG.safety;
  let samples = 0;
  const remainingAfter = popc(unseen) + v.myHand.length - 1;
  const exact = remainingAfter <= CFG.rootSolve;
  while (samples < 2000) {
    sampler.sample(rng, base);
    base[me] = myMask;
    const w = evs.length ? Math.exp(logLik(evs, base, models)) : 1;
    for (let i = 0; i < nC; i++) {
      const c = cands[i];
      H[0] = base[0];
      H[1] = base[1];
      H[2] = base[2];
      H[3] = base[3];
      H[me] ^= 1 << c.t;
      let val = leafAfterPlay(me, c.l, c.r);
      if (val !== val) val = exact ? solve(next, c.l, c.r) : rollout(next, c.l, c.r, rng, CFG.policy, CFG.solveAt);
      tot[i] += w * val;
    }
    samples++;
    if (now() > deadline) break;
  }
  let best = 0;
  for (let i = 1; i < nC; i++) if (tot[i] > tot[best]) best = i;
  if (STATS) STATS.push([remainingAfter, samples, nC]);
  return cands[best].move;
}

/** Optional instrumentation for development harnesses: [remainingAfter, samples, candidates]. */
export let STATS: number[][] | null = null;
export const setStats = (s: number[][] | null) => (STATS = s);

export function makeAgent2(cfg: Partial<A2Config> = {}, id = 'agent2'): Strategy {
  const C: A2Config = { ...A2_DEFAULT, ...cfg, policy: { ...A2_DEFAULT.policy, ...(cfg.policy ?? {}) } };
  return {
    id,
  name: 'Calculista',
  description:
    'Determinized Monte Carlo on a bitmask simulator: exact-uniform sampling of hidden hands from passes, deals weighted by the likelihood of the plays seen, alpha-beta endgame solver, semi-omniscient greedy rollouts.',
  choose(v: PlayerView, rng: Rng, budgetMs: number): Move {
    if (v.legal.length <= 1) return v.legal[0];
    if (v.n !== 4 || v.boneyard > 0 || v.rules.mode !== 'duplas') return chooseMove(v, 'hard', rng, budgetMs);
    return think(v, rng, budgetMs, C);
  },
  };
}

export const agent2: Strategy = makeAgent2();
