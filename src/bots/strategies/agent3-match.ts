/**
 * Match-context utility for the "corrida até 100" penalty race.
 *
 * W[us][them][s] = probability that our pair wins the match when the scores are (us, them)
 * and s = 1 if our side opens the next hand (the hand winner opens the next one, which is an
 * edge). Hands are modelled as: the opening side wins with probability P_START, and the losing
 * side adds X pips drawn from an empirical distribution (measured from bot-vs-bot play).
 */

const TARGET = 100;
const P_START = 0.57;

// Empirical distribution of penalty points in a decided hand (1..60), smoothed.
const RAW = [
  0, 10, 27, 44, 55, 103, 105, 143, 132, 155, 143, 177, 148, 152, 127, 139, 118, 123, 125, 125, 85, 85, 88, 84, 58, 72, 51, 48, 47,
  37, 49, 21, 34, 34, 20, 21, 20, 23, 11, 15, 20, 11, 12, 6, 8, 7, 5, 4, 2, 6, 2, 3, 0, 1, 2, 1, 1, 1, 1, 1, 1,
];

const DIST: { x: number; p: number }[] = (() => {
  const sm: number[] = RAW.map((_, i) => {
    let s = 0;
    let w = 0;
    for (let d = -1; d <= 1; d++) {
      const j = i + d;
      if (j >= 1 && j < RAW.length) {
        s += RAW[j] * (d === 0 ? 2 : 1);
        w += d === 0 ? 2 : 1;
      }
    }
    return i === 0 ? 0 : s / w;
  });
  const tot = sm.reduce((a, b) => a + b, 0);
  return sm.map((c, x) => ({ x, p: c / tot })).filter((e) => e.p > 0);
})();

const T = TARGET;
/** Flat table: idx = (us * T + them) * 2 + s */
const WT = new Float64Array(T * T * 2);

(() => {
  // Process states in decreasing order of us + them (transitions only increase scores).
  for (let sum = 2 * (T - 1); sum >= 0; sum--) {
    for (let us = Math.min(T - 1, sum); us >= 0 && sum - us < T; us--) {
      const them = sum - us;
      for (let s = 0; s < 2; s++) {
        const pWin = s === 1 ? P_START : 1 - P_START;
        let win = 0;
        let lose = 0;
        for (const { x, p } of DIST) {
          win += p * (them + x >= T ? 1 : WT[(us * T + them + x) * 2 + 1]);
          lose += p * (us + x >= T ? 0 : WT[((us + x) * T + them) * 2 + 0]);
        }
        WT[(us * T + them) * 2 + s] = pWin * win + (1 - pWin) * lose;
      }
    }
  }
})();

/** Match win probability for our side. */
export function matchWin(us: number, them: number, weStart: number): number {
  if (them >= T) return 1;
  if (us >= T) return 0;
  if (us < 0) us = 0;
  if (them < 0) them = 0;
  return WT[(us * T + them) * 2 + weStart];
}
