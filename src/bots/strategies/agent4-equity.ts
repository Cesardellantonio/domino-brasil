/**
 * agent4 match equity for the race to 100 ("corrida até 100", penalty scoring).
 *
 * E(us, them, weStart) = probability that our side wins the match from these scores when a fresh
 * single-value hand is about to be dealt. Computed once by dynamic programming over a simple
 * model: the starting side wins a hand ~59% of the time (measured in self-play), the loser adds a
 * penalty drawn from the empirical per-hand distribution, and the hand winner starts the next hand.
 */

// Empirical histogram of the penalty a losing side takes in one hand (index = pips), from
// ~2900 hands of bot self-play under DEFAULT_RULES.
const HIST = [
  0, 5, 9, 18, 26, 31, 59, 55, 64, 74, 83, 92, 102, 101, 110, 102, 83, 107, 114, 108, 94, 101, 88, 83, 81, 89, 68, 72, 70,
  60, 47, 44, 53, 47, 48, 41, 31, 32, 32, 35, 21, 23, 26, 21, 24, 24, 14, 17, 14, 15, 14, 11, 8, 6, 4, 8, 6, 7, 4, 1, 1, 2,
  1, 1, 1, 3, 1, 1, 1,
];
const P_STARTER = 0.59;
const TARGET = 100;

const dist = (() => {
  // Light smoothing.
  const out: number[] = [];
  for (let i = 0; i < HIST.length; i++) {
    const a = HIST[i - 1] ?? 0;
    const b = HIST[i];
    const c = HIST[i + 1] ?? 0;
    out.push(i === 0 ? 0 : (a + 2 * b + c) / 4 + 0.2);
  }
  const s = out.reduce((x, y) => x + y, 0);
  return out.map((x) => x / s);
})();

/** EQ[s][a*T + b]: our win probability at scores (a, b) with s=1 if we start the next hand. */
const EQ: Float64Array[] = (() => {
  const T = TARGET;
  const e0 = new Float64Array(T * T);
  const e1 = new Float64Array(T * T);
  for (let a = T - 1; a >= 0; a--) {
    for (let b = T - 1; b >= 0; b--) {
      // We win the hand: they add x, we start next.
      let win = 0;
      let lose = 0;
      for (let x = 1; x < dist.length; x++) {
        const p = dist[x];
        if (p === 0) continue;
        win += p * (b + x >= T ? 1 : e1[a * T + b + x]);
        lose += p * (a + x >= T ? 0 : e0[(a + x) * T + b]);
      }
      e1[a * T + b] = P_STARTER * win + (1 - P_STARTER) * lose;
      e0[a * T + b] = (1 - P_STARTER) * win + P_STARTER * lose;
    }
  }
  return [e0, e1];
})();

/** Our match-win probability at scores (us, them) before a fresh hand. */
export function equity(us: number, them: number, weStart: boolean): number {
  if (us >= TARGET) return them >= TARGET && them > us ? 1 : 0;
  if (them >= TARGET) return 1;
  return EQ[weStart ? 1 : 0][us * TARGET + them];
}

export const EQ_TARGET = TARGET;
