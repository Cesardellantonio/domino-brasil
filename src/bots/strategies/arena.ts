import { applyMatchMove, newMatch, nextHand, MatchState, Move, legalMoves } from '../../engine/game';
import { DEFAULT_RULES, Rules } from '../../engine/rules';
import { viewFor } from '../../engine/view';
import { mulberry32 } from '../../lib/rng';
import { Strategy } from './types';

export interface DuelResult {
  a: string;
  b: string;
  matches: number;
  aWins: number;
  hands: number;
  /** Penalty points taken by A minus by B (negative = A better, in the race-to-100 rules). */
  pointDiff: number;
  aTimeMs: number;
  bTimeMs: number;
  aDecisions: number;
  bDecisions: number;
  illegal: string[];
}

/**
 * Duplicate format: every seed is played twice with the SAME deals, once with A on seats 0/2
 * and once with A on seats 1/3. Deals come from a dedicated RNG so bot randomness can't change them.
 */
export function duel(A: Strategy, B: Strategy, seeds: number, seed0: number, budgetMs: number, rules: Rules = DEFAULT_RULES): DuelResult {
  const r: DuelResult = { a: A.id, b: B.id, matches: 0, aWins: 0, hands: 0, pointDiff: 0, aTimeMs: 0, bTimeMs: 0, aDecisions: 0, bDecisions: 0, illegal: [] };
  for (let i = 0; i < seeds; i++) {
    for (const aTeam of [0, 1]) {
      const dealRng = mulberry32(seed0 + i * 7919);
      const botRng = mulberry32((seed0 + i) * 31 + aTeam);
      let m: MatchState = newMatch(rules, dealRng);
      let guard = 0;
      while (m.winner === null && guard++ < 5000) {
        if (m.hand.result) {
          m = nextHand(m, dealRng);
          continue;
        }
        const seat = m.hand.turn;
        const isA = seat % 2 === aTeam;
        const S = isA ? A : B;
        const view = viewFor(m, seat);
        const t0 = performance.now();
        let mv: Move;
        try {
          mv = S.choose(view, botRng, budgetMs);
        } catch (e) {
          r.illegal.push(`${S.id} threw: ${(e as Error).message}`);
          mv = legalMoves(m.hand, seat)[0];
        }
        const dt = performance.now() - t0;
        if (isA) {
          r.aTimeMs += dt;
          r.aDecisions++;
        } else {
          r.bTimeMs += dt;
          r.bDecisions++;
        }
        try {
          m = applyMatchMove(m, seat, mv);
        } catch {
          r.illegal.push(`${S.id} illegal move ${JSON.stringify(mv)}`);
          m = applyMatchMove(m, seat, legalMoves(m.hand, seat)[0]);
        }
      }
      r.matches++;
      r.hands += m.history.length;
      if (m.winner === aTeam) r.aWins++;
      r.pointDiff += m.scores[aTeam] - m.scores[1 - aTeam];
    }
  }
  return r;
}

export function summarize(r: DuelResult) {
  const rate = r.aWins / r.matches;
  const se = Math.sqrt((rate * (1 - rate)) / r.matches);
  return {
    pair: `${r.a} vs ${r.b}`,
    matches: r.matches,
    aWinRate: +(rate * 100).toFixed(1),
    ci95: +(1.96 * se * 100).toFixed(1),
    penaltyDiffPerMatch: +(r.pointDiff / r.matches).toFixed(1),
    aMsPerMove: +(r.aTimeMs / Math.max(1, r.aDecisions)).toFixed(1),
    bMsPerMove: +(r.bTimeMs / Math.max(1, r.bDecisions)).toFixed(1),
    illegal: r.illegal.slice(0, 3),
  };
}
