import { ALL_TILES, pipsOf } from '../engine/tiles';
import { Rules, teamOf, hasTeams } from '../engine/rules';
import { Rng } from '../lib/rng';

/** A tiny mutable perfect-information simulator used for Monte Carlo playouts. */
export interface Sim {
  n: number;
  rules: Rules;
  hands: number[][];
  bone: number[];
  l: number; // -1 when the table is empty
  r: number;
  turn: number;
  passes: number;
}

export interface SimOutcome {
  slot: number; // -1 = tie
  points: number;
}

const A = ALL_TILES.map((t) => t.a);
const B = ALL_TILES.map((t) => t.b);
const fits = (id: number, n: number) => A[id] === n || B[id] === n;

/** Play `id` on side 0 (left) or 1 (right). Returns an outcome if the hand ends. */
export function simPlay(s: Sim, id: number, side: 0 | 1, mult: number): SimOutcome | null {
  const hand = s.hands[s.turn];
  hand.splice(hand.indexOf(id), 1);
  let both = false;
  if (s.l < 0) {
    s.l = A[id];
    s.r = B[id];
  } else {
    both = fits(id, s.l) && fits(id, s.r);
    if (side === 0) s.l = A[id] === s.l ? B[id] : A[id];
    else s.r = A[id] === s.r ? B[id] : A[id];
  }
  s.passes = 0;
  if (hand.length === 0) {
    const dbl = A[id] === B[id];
    const p = s.rules.points;
    const pts = both && dbl ? p.cruzada : both ? p.laELo : dbl ? p.carroca : p.simples;
    return { slot: teamOf(s.rules.mode, s.turn), points: pts * mult };
  }
  s.turn = (s.turn + 1) % s.n;
  return null;
}

export function simPass(s: Sim, mult: number): SimOutcome | null {
  s.passes++;
  s.turn = (s.turn + 1) % s.n;
  if (s.passes >= s.n) return blockedOutcome(s, mult);
  return null;
}

export function blockedOutcome(s: Sim, mult: number): SimOutcome {
  const c = s.hands.map((h) => h.reduce((x, id) => x + pipsOf(id), 0));
  const pts = s.rules.points.blocked * mult;
  if (hasTeams(s.rules.mode) && s.rules.blockedResolution === 'pairTotal') {
    const t0 = c[0] + c[2];
    const t1 = c[1] + c[3];
    return t0 === t1 ? { slot: -1, points: 0 } : { slot: t0 < t1 ? 0 : 1, points: pts };
  }
  const min = Math.min(...c);
  const slots = new Set<number>();
  c.forEach((v, i) => v === min && slots.add(teamOf(s.rules.mode, i)));
  return slots.size > 1 ? { slot: -1, points: 0 } : { slot: [...slots][0], points: pts };
}

/**
 * Fast greedy policy for playouts: prefer heavy tiles and doubles, keep a follow-up,
 * try to leave ends the next player cannot match (using the simulated hands, which are
 * a sample, not the truth).
 */
export function playout(s: Sim, mult: number, rng: Rng): SimOutcome {
  for (let guard = 0; guard < 200; guard++) {
    const hand = s.hands[s.turn];
    let bestId = -1;
    let bestSide: 0 | 1 = 0;
    let bestScore = -1e9;
    for (let i = 0; i < hand.length; i++) {
      const id = hand[i];
      for (let side = 0 as 0 | 1; side <= 1; side = (side + 1) as 0 | 1) {
        const end = side === 0 ? s.l : s.r;
        if (s.l >= 0 && !fits(id, end)) continue;
        if (s.l >= 0 && side === 1 && s.l === s.r) continue;
        const newEnd = s.l < 0 ? B[id] : A[id] === end ? B[id] : A[id];
        const other = s.l < 0 ? A[id] : side === 0 ? s.r : s.l;
        let sc = A[id] + B[id] + (A[id] === B[id] ? 4 : 0) + rng() * 3;
        if (hand.length === 1) sc += 1000;
        // Follow-up: can I play again on the new ends?
        for (let j = 0; j < hand.length; j++)
          if (j !== i && (fits(hand[j], newEnd) || fits(hand[j], other))) {
            sc += 3;
            break;
          }
        if (sc > bestScore) {
          bestScore = sc;
          bestId = id;
          bestSide = side;
          if (s.l < 0) break;
        }
      }
    }
    if (bestId >= 0) {
      const out = simPlay(s, bestId, bestSide, mult);
      if (out) return out;
      continue;
    }
    if (s.bone.length > 0) {
      hand.push(s.bone.pop()!);
      continue;
    }
    const out = simPass(s, mult);
    if (out) return out;
  }
  return blockedOutcome(s, mult);
}
