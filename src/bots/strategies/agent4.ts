import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { teamOf } from '../../engine/rules';
import { Rng } from '../../lib/rng';
import { buildKnowledge, sampleDeal } from '../knowledge';
import { Strategy } from './types';
import { Solver, TA, TB, linearUtility, Utility } from './agent4-solver';
import { equity, EQ_TARGET } from './agent4-equity';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const env = (k: string, d: number): number => {
  const p = (globalThis as any).process;
  const x = p?.env?.[k];
  return x !== undefined && x !== '' ? Number(x) : d;
};

const solver = new Solver();

type Play = Move & { t: 'play' };

function dedupe(v: PlayerView): Move[] {
  const seen = new Set<number>();
  return v.legal.filter((m) => {
    if (m.t !== 'play' || !v.ends || v.ends[0] !== v.ends[1]) return true;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function endsAfter(v: PlayerView, m: Play): [number, number] {
  const a = TA[m.id];
  const b = TB[m.id];
  if (!v.ends) return [a, b];
  if (m.side === 'L') return [a === v.ends[0] ? b : a, v.ends[1]];
  return [v.ends[0], a === v.ends[1] ? b : a];
}

/**
 * Terminal utilities in team-0 perspective. With the equity model the value of a hand outcome is
 * our probability of winning the match afterwards (race to 100), so near the end we value
 * "not taking a big penalty" and "pushing them over 100" correctly instead of linearly.
 */
function makeUtility(v: PlayerView): Utility {
  const mult = v.multiplier;
  if (env('A4_EQ', 0) === 0 || v.rules.scoring !== 'pips' || v.rules.targetScore !== EQ_TARGET || v.n !== 4) return linearUtility(mult);
  const myTeam = v.seat & 1;
  const us = v.scores[myTeam];
  const them = v.scores[1 - myTeam];
  const win0 = new Float64Array(400);
  const win1 = new Float64Array(400);
  const sgn = myTeam === 0 ? 1 : -1;
  for (let p = 0; p < 400; p++) {
    const iWin = equity(us, them + p * mult, true);
    const iLose = equity(us + p * mult, them, false);
    if (myTeam === 0) {
      win0[p] = iWin;
      win1[p] = iLose; // team 1 wins, team 0 (us) holds p
    } else {
      win0[p] = sgn * iLose; // team 0 wins, we (team 1) hold p
      win1[p] = sgn * iWin;
    }
  }
  const nextStarterTeam = (v.starter + 1) & 1;
  const tie = sgn * equity(us, them, nextStarterTeam === myTeam);
  return { win0, win1, tie };
}

function choose(v: PlayerView, rng: Rng, budgetMs: number): Move {
  const moves = dedupe(v);
  if (moves.length <= 1) return moves[0] ?? v.legal[0];
  const plays = moves.filter((m): m is Play => m.t === 'play');
  if (plays.length !== moves.length) return moves[0];

  const start = now();
  const budget = budgetMs * env('A4_BUDGET_FRAC', 0.8);
  const stopAt = env('A4_STOPAT', 0);
  const me = v.seat;
  const sign = teamOf(v.rules.mode, me) === 0 ? 1 : -1;
  const u: Utility = makeUtility(v);
  const k = buildKnowledge(v);

  const totals = new Float64Array(plays.length);
  const ends = plays.map((m) => endsAfter(v, m));
  let samples = 0;
  const hands = [0, 0, 0, 0];
  const minSamples = env('A4_MINS', 8);
  const maxSamples = env('A4_MAXS', 2000);
  while (samples < maxSamples && (samples < minSamples || now() - start < budget)) {
    const deal = sampleDeal(k, v.myHand, rng);
    for (let s = 0; s < 4; s++) {
      let m = 0;
      for (const id of deal.hands[s]) m |= 1 << id;
      hands[s] = m;
    }
    for (let i = 0; i < plays.length; i++) {
      solver.setup(hands, u);
      const id = plays[i].id;
      solver.hands[me] ^= 1 << id;
      solver.pips[me] -= TA[id] + TB[id];
      let val: number;
      if (solver.hands[me] === 0) {
        val = (me & 1) === 0 ? u.win0[solver.pips[1] + solver.pips[3]] : u.win1[solver.pips[0] + solver.pips[2]];
      } else {
        val = solver.rolloutSolve((me + 1) & 3, ends[i][0], ends[i][1], stopAt, rng);
      }
      totals[i] += sign * val;
    }
    samples++;
  }
  let best = 0;
  for (let i = 1; i < plays.length; i++) if (totals[i] > totals[best]) best = i;
  return plays[best];
}

export const agent4: Strategy = {
  id: 'agent4',
  name: 'O Trancador',
  description:
    'Determinized Monte Carlo on bitmasks: samples hidden hands consistent with passes, evaluates every legal move ' +
    'on the same deals (common random numbers) with fast info-fair greedy rollouts scored by the penalty difference. ' +
    'Includes an exact alpha-beta endgame solver and a race-to-100 match-equity utility (both off by default: they measured worse).',
  choose,
};
