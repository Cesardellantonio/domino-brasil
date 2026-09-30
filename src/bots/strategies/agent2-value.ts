/**
 * Match-level value for the penalty race to 100 ("corrida até 100", whoever reaches 100 loses).
 *
 * W(us, them, weStart, mult) = probability that our side wins the match from these scores,
 * before a hand in which `weStart` tells who leads and `mult` is the tie multiplier.
 * Computed once by dynamic programming over a simple hand model measured from self-play:
 * the leading side wins ~61% of hands, ~2% of hands tie (next hand doubled), and the losing
 * side's penalty follows the empirical histogram below.
 */

// Empirical penalty histogram (pips added to the losing side, per unit multiplier), 0..79.
const HIST = [
  0, 47, 85, 182, 246, 406, 469, 561, 588, 684, 548, 641, 576, 614, 610, 575, 519, 475, 509, 435, 396, 357, 353, 335, 310,
  284, 257, 227, 201, 214, 203, 165, 160, 135, 117, 111, 112, 85, 93, 59, 56, 63, 59, 43, 29, 22, 24, 23, 16, 13, 13, 6, 7,
  13, 6, 3, 6, 2, 5, 1, 5, 4, 2, 2, 0, 1, 1, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0,
];
const P_TIE = 0.022;
const P_LEAD_WIN = 0.608;
const TARGET = 100;
const MULTS = [1, 2, 4, 8];

const S = TARGET; // scores 0..99
/** idx(a, b, s, mi) */
const idx = (a: number, b: number, s: number, mi: number) => ((a * S + b) * 2 + s) * 4 + mi;
const W = new Float32Array(S * S * 2 * 4);

(function build() {
  const tot = HIST.reduce((x, y) => x + y, 0);
  const px: number[] = [];
  const xs: number[] = [];
  HIST.forEach((c, x) => {
    if (c > 0) {
      xs.push(x);
      px.push(c / tot);
    }
  });
  W.fill(0.5);
  // Value of the state after we take `pen` penalty points (we lost), next hand led by them.
  const afterWeLose = (a: number, b: number, pen: number) => (a + pen >= TARGET ? 0 : W[idx(a + pen, b, 0, 0)]);
  const afterTheyLose = (a: number, b: number, pen: number) => (b + pen >= TARGET ? 1 : W[idx(a, b + pen, 1, 0)]);
  for (let pass = 0; pass < 2; pass++) {
    for (let a = S - 1; a >= 0; a--)
      for (let b = S - 1; b >= 0; b--)
        for (let mi = 3; mi >= 0; mi--)
          for (let s = 1; s >= 0; s--) {
            // s = 1: we lead; s = 0: they lead.
            const m = MULTS[mi];
            const pWin = (1 - P_TIE) * (s === 1 ? P_LEAD_WIN : 1 - P_LEAD_WIN);
            const pLose = 1 - P_TIE - pWin;
            let ew = 0;
            let el = 0;
            for (let k = 0; k < xs.length; k++) {
              ew += px[k] * afterTheyLose(a, b, xs[k] * m);
              el += px[k] * afterWeLose(a, b, xs[k] * m);
            }
            const tieV = W[idx(a, b, 1 - s, Math.min(3, mi + 1))];
            W[idx(a, b, s, mi)] = pWin * ew + pLose * el + P_TIE * tieV;
          }
  }
})();

const multIndex = (m: number) => (m >= 8 ? 3 : m >= 4 ? 2 : m >= 2 ? 1 : 0);

/** Match win probability before a hand. */
export function matchValue(us: number, them: number, weLead: boolean, mult: number): number {
  if (us >= TARGET) return 0;
  if (them >= TARGET) return 1;
  return W[idx(us, them, weLead ? 1 : 0, multIndex(mult))];
}

/**
 * Value (our match win probability) after the current hand ends.
 * winnerTeam: -1 tie, else team; penalty = pips added to the losing side (already multiplied);
 * starterTeam = team that led the current hand (a tie passes the lead to the other team).
 */
export function afterHandValue(
  us: number,
  them: number,
  myTeam: number,
  winnerTeam: number,
  penalty: number,
  mult: number,
  starterTeam: number,
): number {
  if (winnerTeam < 0) return matchValue(us, them, starterTeam !== myTeam, mult * 2);
  if (winnerTeam === myTeam) return matchValue(us, them + penalty, true, 1);
  return matchValue(us + penalty, them, false, 1);
}
