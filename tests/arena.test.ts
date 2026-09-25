import { describe, expect, it } from 'vitest';
import { applyMatchMove, newMatch, nextHand } from '../src/engine/game';
import { DEFAULT_RULES } from '../src/engine/rules';
import { viewFor } from '../src/engine/view';
import { BotLevel, chooseMove } from '../src/bots/bots';
import { mulberry32 } from '../src/lib/rng';

/** Team 0 (seats 0 & 2) plays `a`, team 1 (seats 1 & 3) plays `b`. Returns team-0 match win rate. */
function duel(a: BotLevel, b: BotLevel, matches: number, seed: number, budget = 25) {
  let wins = 0;
  let hands = 0;
  let blocked = 0;
  for (let i = 0; i < matches; i++) {
    const rng = mulberry32(seed + i);
    // Swap which team starts with the 6-6 by alternating seed use; also mirror seats every other match.
    const flip = i % 2 === 1;
    let m = newMatch(DEFAULT_RULES, rng);
    while (m.winner === null) {
      if (m.hand.result) {
        hands++;
        if (m.hand.result.kind === 'blocked' || m.hand.result.kind === 'tie') blocked++;
        m = nextHand(m, rng);
        continue;
      }
      const seat = m.hand.turn;
      const lvl = (seat % 2 === 0) !== flip ? a : b;
      m = applyMatchMove(m, seat, chooseMove(viewFor(m, seat), lvl, rng, budget));
    }
    if ((m.winner === 0) !== flip) wins++;
  }
  return { rate: wins / matches, hands, blocked };
}

describe('bot arena', () => {
  it('medium beats easy', () => {
    const r = duel('medium', 'easy', 300, 1000);
    console.log('medium vs easy', r);
    expect(r.rate).toBeGreaterThan(0.6);
  });
  it('hard beats medium', () => {
    const r = duel('hard', 'medium', 200, 5000);
    console.log('hard vs medium', r);
    expect(r.rate).toBeGreaterThan(0.53);
  });
});
