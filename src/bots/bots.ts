import { ALL_TILES, hasNum, isDouble, otherSide, pipsOf } from '../engine/tiles';
import { Move } from '../engine/game';
import { PlayerView } from '../engine/view';
import { hasTeams, teamOf } from '../engine/rules';
import { Rng } from '../lib/rng';
import { buildKnowledge, inMask, Knowledge, sampleDeal, unseenWith } from './knowledge';
import { playout, Sim, simPlay } from './sim';

export type BotLevel = 'easy' | 'medium' | 'hard';

export function chooseMove(view: PlayerView, level: BotLevel, rng: Rng, budgetMs = 220): Move {
  const moves = dedupe(view);
  if (moves.length === 0) throw new Error('bot has no legal moves');
  if (moves.length === 1) return moves[0];
  if (level === 'easy') return easyMove(view, moves, rng);
  if (level === 'medium') return mediumMove(view, moves, rng);
  return hardMove(view, moves, rng, budgetMs);
}

/** Drop the mirror move when both ends show the same number. */
function dedupe(v: PlayerView): Move[] {
  const seen = new Set<string>();
  return v.legal.filter((m) => {
    if (m.t !== 'play' || !v.ends || v.ends[0] !== v.ends[1]) return true;
    const key = String(m.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ------------------------------------------------------------------ easy

function easyMove(_v: PlayerView, moves: Move[], rng: Rng): Move {
  if (rng() < 0.5) {
    // Half the time dump the heaviest tile, otherwise play at random.
    return moves.reduce((best, m) => (m.t === 'play' && best.t === 'play' && pipsOf(m.id) > pipsOf(best.id) ? m : best), moves[0]);
  }
  return moves[Math.floor(rng() * moves.length)];
}

// ------------------------------------------------------------------ medium

const resultingEnds = (v: PlayerView, m: Move & { t: 'play' }): [number, number] => {
  if (!v.ends) return [ALL_TILES[m.id].a, ALL_TILES[m.id].b];
  return m.side === 'L' ? [otherSide(m.id, v.ends[0]), v.ends[1]] : [v.ends[0], otherSide(m.id, v.ends[1])];
};

export function scoreMedium(v: PlayerView, k: Knowledge, m: Move & { t: 'play' }): number {
  const me = v.seat;
  const n = v.n;
  const teams = hasTeams(v.rules.mode);
  const rest = v.myHand.filter((x) => x !== m.id);
  const [nl, nr] = resultingEnds(v, m);
  let sc = 0;

  if (rest.length === 0) {
    const both = v.ends ? hasNum(m.id, v.ends[0]) && hasNum(m.id, v.ends[1]) : false;
    return 1000 + (both ? 50 : 0) + (isDouble(m.id) ? 20 : 0);
  }

  sc += pipsOf(m.id) * 0.9;
  if (isDouble(m.id)) sc += 4.5;

  // Follow-up and control of the ends.
  const mineOn = (x: number) => rest.reduce((c, id) => c + (hasNum(id, x) ? 1 : 0), 0);
  if (rest.some((id) => hasNum(id, nl) || hasNum(id, nr))) sc += 3;
  sc += Math.min(mineOn(nl), 3) * 1.2 + (nl !== nr ? Math.min(mineOn(nr), 3) * 1.2 : 0);
  if (unseenWith(k, nl) === 0 && mineOn(nl) > 0) sc += 2;
  if (unseenWith(k, nr) === 0 && mineOn(nr) > 0) sc += 2;

  // Keep a varied hand.
  const distinct = new Set<number>();
  rest.forEach((id) => (distinct.add(ALL_TILES[id].a), distinct.add(ALL_TILES[id].b)));
  sc += distinct.size * 0.5;

  // Make opponents pass, help the partner.
  for (let s = 0; s < n; s++) {
    if (s === me) continue;
    const blockedOut = inMask(k.voids[s], nl) && inMask(k.voids[s], nr);
    const halfOut = inMask(k.voids[s], nl) || inMask(k.voids[s], nr);
    const partner = teams && teamOf(v.rules.mode, s) === teamOf(v.rules.mode, me);
    const nextOpp = s === (me + 1) % n;
    if (partner) sc += blockedOut ? -7 : halfOut ? -1.5 : 0;
    else sc += blockedOut ? (nextOpp ? 8 : 5) : halfOut ? 1 : 0;
  }

  // Partner support: keep open the number the partner last played out.
  if (teams) {
    const partner = (me + 2) % 4;
    for (let i = v.log.length - 1; i >= 0; i--) {
      const e = v.log[i];
      if (e.t === 'play' && e.seat === partner) {
        const created = e.ends ? otherSide(e.id, e.side === 'L' ? e.ends[0] : e.ends[1]) : ALL_TILES[e.id].b;
        if (nl === created || nr === created) sc += 1.5;
        break;
      }
    }
  }

  // Setting up to go out next turn.
  if (rest.length === 1 && (hasNum(rest[0], nl) || hasNum(rest[0], nr))) sc += 6;

  // Blocking: if no hidden tile can match either end and neither can mine, the hand locks now.
  const liveOthers = k.unseen.some((id) => hasNum(id, nl) || hasNum(id, nr));
  const liveMine = rest.some((id) => hasNum(id, nl) || hasNum(id, nr));
  if (!liveOthers && !liveMine && v.boneyard === 0) {
    const myPips = rest.reduce((s, id) => s + pipsOf(id), 0);
    const hiddenPips = k.unseen.reduce((s, id) => s + pipsOf(id), 0);
    const hiddenTiles = Math.max(1, k.unseen.length);
    const avg = hiddenPips / hiddenTiles;
    let mine = myPips;
    let theirs = 0;
    for (let s = 0; s < n; s++) {
      if (s === me) continue;
      const est = avg * k.counts[s];
      if (teams && teamOf(v.rules.mode, s) === teamOf(v.rules.mode, me)) mine += est;
      else theirs = teams ? theirs + est : Math.min(theirs || Infinity, est);
    }
    sc += mine < theirs ? 18 : -18;
  }
  return sc;
}

function mediumMove(v: PlayerView, moves: Move[], rng: Rng): Move {
  const k = buildKnowledge(v);
  let best = moves[0];
  let bestSc = -Infinity;
  for (const m of moves) {
    if (m.t !== 'play') return m;
    const sc = scoreMedium(v, k, m) + rng() * 0.5;
    if (sc > bestSc) {
      bestSc = sc;
      best = m;
    }
  }
  return best;
}

// ------------------------------------------------------------------ hard (determinized Monte Carlo)

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function hardMove(v: PlayerView, moves: Move[], rng: Rng, budgetMs: number): Move {
  const plays = moves.filter((m): m is Move & { t: 'play' } => m.t === 'play');
  if (plays.length !== moves.length) return moves[0]; // draw / pass are forced
  const k = buildKnowledge(v);
  const mySlot = teamOf(v.rules.mode, v.seat);
  const totals = new Float64Array(plays.length);
  // Heuristic prior keeps the choice sensible when few samples fit in the budget.
  const prior = plays.map((m) => scoreMedium(v, k, m));
  const start = now();
  let samples = 0;
  const maxSamples = 600;
  while (samples < maxSamples && (samples < 40 || now() - start < budgetMs)) {
    const deal = sampleDeal(k, v.myHand, rng);
    for (let i = 0; i < plays.length; i++) {
      const s: Sim = {
        n: v.n,
        rules: v.rules,
        hands: deal.hands.map((h) => h.slice()),
        bone: deal.boneyard.slice(),
        l: v.ends ? v.ends[0] : -1,
        r: v.ends ? v.ends[1] : -1,
        turn: v.seat,
        passes: 0,
      };
      const m = plays[i];
      let out = simPlay(s, m.id, m.side === 'L' ? 0 : 1, v.multiplier);
      if (!out) out = playout(s, v.multiplier, rng);
      if (out.slot === mySlot) totals[i] += out.points;
      else if (out.slot >= 0) totals[i] -= out.points;
    }
    samples++;
  }
  let best = 0;
  let bestSc = -Infinity;
  for (let i = 0; i < plays.length; i++) {
    const sc = totals[i] / samples + prior[i] * 0.004;
    if (sc > bestSc) {
      bestSc = sc;
      best = i;
    }
  }
  return plays[best];
}
