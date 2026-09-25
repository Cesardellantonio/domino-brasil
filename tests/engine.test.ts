import { describe, expect, it } from 'vitest';
import { applyMatchMove, applyMove, batidaKind, dealHand, HandState, legalMoves, newMatch, nextHand, resolveBlocked, tilesOnTable } from '../src/engine/game';
import { DEFAULT_RULES, Mode, Rules } from '../src/engine/rules';
import { DOUBLE_SIX, tileId } from '../src/engine/tiles';
import { viewFor } from '../src/engine/view';
import { mulberry32 } from '../src/lib/rng';

const rules = (mode: Mode = 'duplas', scoring: Rules['scoring'] = 'batida'): Rules => ({ ...DEFAULT_RULES, mode, scoring, targetScore: scoring === 'pips' ? 100 : 6 });

describe('dealing', () => {
  it('deals 7 tiles each and 6-6 starts the first 4-player hand', () => {
    for (let seed = 0; seed < 50; seed++) {
      const h = dealHand('duplas', mulberry32(seed), null, 1);
      expect(h.hands.every((x) => x.length === 7)).toBe(true);
      expect(h.boneyard.length).toBe(0);
      expect(h.mustPlay).toBe(DOUBLE_SIX);
      expect(h.hands[h.turn]).toContain(DOUBLE_SIX);
      expect(legalMoves(h)).toEqual([{ t: 'play', id: DOUBLE_SIX, side: 'R' }]);
    }
  });

  it('1v1 has a 14-tile boneyard', () => {
    const h = dealHand('1v1', mulberry32(3), null, 1);
    expect(h.boneyard.length).toBe(14);
    expect(h.hands.length).toBe(2);
  });
});

describe('batida kinds', () => {
  it('classifies the last tile', () => {
    expect(batidaKind(tileId(3, 4), [3, 1])).toBe('simples');
    expect(batidaKind(tileId(3, 3), [3, 1])).toBe('carroca');
    expect(batidaKind(tileId(3, 5), [3, 5])).toBe('laELo');
    expect(batidaKind(tileId(5, 5), [5, 5])).toBe('cruzada');
  });

  it('scores a lá-e-lô for the pair', () => {
    const m = newMatch(rules(), mulberry32(1));
    const h: HandState = {
      ...m.hand,
      hands: [[tileId(2, 5)], [tileId(0, 0)], [tileId(1, 1)], [tileId(0, 1)]],
      root: { id: tileId(2, 4), inner: 2, outer: 4, seat: 1 },
      left: [],
      right: [{ id: tileId(4, 5), inner: 4, outer: 5, seat: 2 }],
      ends: [2, 5],
      turn: 0,
      mustPlay: null,
    };
    const out = applyMatchMove({ ...m, hand: h }, 0, { t: 'play', id: tileId(2, 5), side: 'L' });
    expect(out.hand.result?.kind).toBe('laELo');
    expect(out.scores).toEqual([3, 0]);
  });
});

describe('pip scoring (soma dos pontos)', () => {
  it('the pair that loses adds the pips left in their own hands', () => {
    const m = newMatch(rules('duplas', 'pips'), mulberry32(1));
    const h: HandState = {
      ...m.hand,
      hands: [[tileId(2, 5)], [tileId(6, 6)], [tileId(1, 1)], [tileId(3, 4), tileId(0, 2)]],
      root: { id: tileId(2, 4), inner: 2, outer: 4, seat: 1 },
      left: [],
      right: [{ id: tileId(4, 5), inner: 4, outer: 5, seat: 2 }],
      ends: [2, 5],
      turn: 0,
      mustPlay: null,
    };
    const out = applyMatchMove({ ...m, hand: h }, 0, { t: 'play', id: tileId(2, 5), side: 'L' });
    // losers are seats 1 (6-6 = 12) and 3 (3-4 + 0-2 = 9): they take 21; the winners take nothing
    expect(out.scores).toEqual([0, 21]);
    expect(out.winner).toBe(null);
  });

  it('whoever reaches the limit loses the match', () => {
    const m = newMatch(rules('duplas', 'pips'), mulberry32(1));
    const h: HandState = {
      ...m.hand,
      hands: [[tileId(2, 5)], [tileId(6, 6)], [tileId(1, 1)], [tileId(3, 4)]],
      root: { id: tileId(2, 4), inner: 2, outer: 4, seat: 1 },
      left: [],
      right: [{ id: tileId(4, 5), inner: 4, outer: 5, seat: 2 }],
      ends: [2, 5],
      turn: 0,
      mustPlay: null,
    };
    const out = applyMatchMove({ ...m, scores: [40, 85], hand: h }, 0, { t: 'play', id: tileId(2, 5), side: 'L' });
    expect(out.scores).toEqual([40, 104]);
    expect(out.winner).toBe(0); // team 1 passed 100 and lost
  });
});

describe('blocked games', () => {
  const res = (pipCounts: number[]) => ({ kind: 'blocked' as const, winnerSeat: -1, winnerSlot: -1, points: 0, pipCounts, hands: [] });
  it('pair total decides', () => {
    const r = res([10, 3, 2, 4]);
    resolveBlocked(r, 'duplas', rules());
    expect(r.winnerSlot).toBe(1);
  });
  it('tie gives nobody the point', () => {
    const r = res([5, 3, 2, 4]);
    resolveBlocked(r, 'duplas', rules());
    expect(r.kind).toBe('tie');
  });
  it('lowest player mode', () => {
    const r = res([1, 3, 20, 4]);
    resolveBlocked(r, 'duplas', { ...rules(), blockedResolution: 'lowestPlayer' });
    expect(r.winnerSlot).toBe(0);
  });
});

describe('random full matches', () => {
  for (const [mode, scoring] of [['duplas', 'batida'], ['duplas', 'pips'], ['1v1', 'pips'], ['three', 'batida'], ['ffa4', 'pips']] as [Mode, Rules['scoring']][]) {
    it(`${mode}/${scoring}: tiles are conserved, views never leak, matches finish`, () => {
      for (let seed = 0; seed < 120; seed++) {
        const rng = mulberry32(seed);
        let m = newMatch(rules(mode, scoring), rng);
        let steps = 0;
        while (m.winner === null) {
          const h = m.hand;
          if (h.result) {
            m = nextHand(m, rng);
            continue;
          }
          const count = h.hands.flat().length + h.boneyard.length + tilesOnTable(h).length;
          expect(count).toBe(28);
          for (let s = 0; s < m.n; s++) {
            const v = viewFor(m, s);
            const json = JSON.stringify({ ...v, myHand: [], history: [] });
            expect(json.includes('"hands"')).toBe(false); // live hands never leak
            expect(Array.isArray((v as any).boneyard)).toBe(false);
            expect(v.myHand).toEqual(h.hands[s]);
          }
          const legal = legalMoves(h);
          const mv = legal[Math.floor(rng() * legal.length)];
          m = applyMatchMove(m, h.turn, mv);
          if (++steps > 20000) throw new Error('did not terminate');
        }
        expect(Math.max(...m.scores)).toBeGreaterThanOrEqual(m.rules.targetScore);
        if (scoring === 'pips') expect(m.scores[m.winner!]).toBe(Math.min(...m.scores));
      }
    });
  }

  it('rejects illegal moves', () => {
    const h = dealHand('duplas', mulberry32(9), null, 1);
    const other = h.hands[h.turn].find((x) => x !== DOUBLE_SIX)!;
    expect(() => applyMove(h, h.turn, { t: 'play', id: other, side: 'R' })).toThrow();
    expect(() => applyMove(h, (h.turn + 1) % 4, { t: 'pass' })).toThrow();
  });
});
