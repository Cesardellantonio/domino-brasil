import { ALL_TILES, hasNum, isDouble, otherSide, pipsOf, TILE_COUNT } from './tiles';
import { HAND_SIZE, Rules, Mode, playersFor, scoreSlots, teamOf, hasTeams, losersPips } from './rules';
import { Rng, shuffle } from '../lib/rng';

export type Side = 'L' | 'R';

export interface Placed {
  id: number;
  /** Pip value touching the previous tile (for the root: the value on its left). */
  inner: number;
  /** Pip value on the open side (for the root: the value on its right). */
  outer: number;
  seat: number;
}

export type Move = { t: 'play'; id: number; side: Side } | { t: 'draw' } | { t: 'pass' };

export type LogEntry =
  | { t: 'play'; seat: number; id: number; side: Side; ends: [number, number] | null }
  | { t: 'pass'; seat: number; ends: [number, number] | null }
  | { t: 'draw'; seat: number; ends: [number, number] | null };

export type ResultKind = 'simples' | 'carroca' | 'laELo' | 'cruzada' | 'blocked' | 'tie';

export interface HandResult {
  kind: ResultKind;
  /** Seat that went out, or the lowest-count seat of the winning side in a block. -1 on tie. */
  winnerSeat: number;
  /** Score slot that scores (team or seat). -1 on tie. */
  winnerSlot: number;
  points: number;
  pipCounts: number[];
  hands: number[][];
}

export interface HandState {
  n: number;
  mode: Mode;
  hands: number[][];
  boneyard: number[];
  root: Placed | null;
  /** Arms grow outward: left[0] touches the root. */
  left: Placed[];
  right: Placed[];
  ends: [number, number] | null;
  turn: number;
  starter: number;
  /** The first play of the hand must be this tile (e.g. 6-6 on the first hand). */
  mustPlay: number | null;
  multiplier: number;
  log: LogEntry[];
  result: HandResult | null;
}

export interface MatchState {
  rules: Rules;
  n: number;
  scores: number[];
  handNo: number;
  multiplier: number;
  hand: HandState;
  history: HandResult[];
  /** Winning score slot once the match is over. */
  winner: number | null;
}

// ---------------------------------------------------------------- dealing

export function newMatch(rules: Rules, rng: Rng): MatchState {
  const n = playersFor(rules.mode);
  const m: MatchState = {
    rules,
    n,
    scores: new Array(scoreSlots(rules.mode)).fill(0),
    handNo: 0,
    multiplier: 1,
    hand: null as unknown as HandState,
    history: [],
    winner: null,
  };
  m.hand = dealHand(rules.mode, rng, null, 1);
  return m;
}

/** Deal a hand. `starter` null means "first hand" rules (6-6 / highest double starts). */
export function dealHand(mode: Mode, rng: Rng, starter: number | null, multiplier: number): HandState {
  const n = playersFor(mode);
  const ids = shuffle(ALL_TILES.map((t) => t.id), rng);
  const hands: number[][] = [];
  for (let s = 0; s < n; s++) hands.push(ids.slice(s * HAND_SIZE, (s + 1) * HAND_SIZE).sort((x, y) => x - y));
  const boneyard = ids.slice(n * HAND_SIZE);

  let mustPlay: number | null = null;
  if (starter === null) {
    // First hand: the holder of the highest double starts with it (6-6 in the 4-player game).
    // If no player holds a double (possible with a boneyard) the heaviest tile starts.
    const rank = (id: number) => (isDouble(id) ? 100 + ALL_TILES[id].a : pipsOf(id) * 7 + ALL_TILES[id].b);
    let best = -1;
    for (const h of hands) for (const id of h) if (best < 0 || rank(id) > rank(best)) best = id;
    mustPlay = best; // DOUBLE_SIX whenever it was dealt
    starter = hands.findIndex((h) => h.includes(best));
  }

  return {
    n,
    mode,
    hands,
    boneyard,
    root: null,
    left: [],
    right: [],
    ends: null,
    turn: starter,
    starter,
    mustPlay,
    multiplier,
    log: [],
    result: null,
  };
}

// ---------------------------------------------------------------- queries

export function playableSides(ends: [number, number] | null, id: number): Side[] {
  if (!ends) return ['R'];
  const out: Side[] = [];
  if (hasNum(id, ends[0])) out.push('L');
  if (hasNum(id, ends[1])) out.push('R');
  return out;
}

export function legalMoves(h: HandState, seat = h.turn, dedupe = false): Move[] {
  if (h.result || seat !== h.turn) return [];
  const hand = h.hands[seat];
  const out: Move[] = [];
  if (!h.ends) {
    if (h.mustPlay !== null) return hand.includes(h.mustPlay) ? [{ t: 'play', id: h.mustPlay, side: 'R' }] : [];
    for (const id of hand) out.push({ t: 'play', id, side: 'R' });
    return out;
  }
  for (const id of hand) {
    const sides = playableSides(h.ends, id);
    if (dedupe && sides.length === 2 && h.ends[0] === h.ends[1]) sides.pop();
    for (const side of sides) out.push({ t: 'play', id, side });
  }
  if (out.length) return out;
  return h.boneyard.length > 0 ? [{ t: 'draw' }] : [{ t: 'pass' }];
}

export function canPlayAny(h: HandState, seat: number): boolean {
  if (!h.ends) return true;
  const [l, r] = h.ends;
  return h.hands[seat].some((id) => hasNum(id, l) || hasNum(id, r));
}

export const tilesOnTable = (h: HandState): Placed[] => (h.root ? [...h.left.slice().reverse(), h.root, ...h.right] : []);

// ---------------------------------------------------------------- moves

function cloneHand(h: HandState): HandState {
  return {
    ...h,
    hands: h.hands.map((x) => x.slice()),
    boneyard: h.boneyard.slice(),
    left: h.left.slice(),
    right: h.right.slice(),
    ends: h.ends ? [h.ends[0], h.ends[1]] : null,
    log: h.log.slice(),
  };
}

export class IllegalMove extends Error {}

export function applyMove(h0: HandState, seat: number, move: Move): HandState {
  if (h0.result) throw new IllegalMove('hand is over');
  if (seat !== h0.turn) throw new IllegalMove('not your turn');
  const legal = legalMoves(h0, seat);
  const ok = legal.some((m) => m.t === move.t && (m.t !== 'play' || (move.t === 'play' && m.id === move.id && m.side === move.side)));
  if (!ok) throw new IllegalMove(`illegal move ${JSON.stringify(move)}`);

  const h = cloneHand(h0);
  const endsBefore = h.ends ? ([h.ends[0], h.ends[1]] as [number, number]) : null;

  if (move.t === 'draw') {
    h.hands[seat].push(h.boneyard.shift()!);
    h.hands[seat].sort((x, y) => x - y);
    h.log.push({ t: 'draw', seat, ends: endsBefore });
    return h; // same player keeps the turn
  }

  if (move.t === 'pass') {
    h.log.push({ t: 'pass', seat, ends: endsBefore });
    h.turn = (seat + 1) % h.n;
    checkBlocked(h);
    return h;
  }

  const { id, side } = move;
  h.hands[seat] = h.hands[seat].filter((x) => x !== id);
  const t = ALL_TILES[id];
  if (!h.ends) {
    h.root = { id, inner: t.a, outer: t.b, seat };
    h.ends = [t.a, t.b];
    h.mustPlay = null;
  } else if (side === 'L') {
    const outer = otherSide(id, h.ends[0]);
    h.left.push({ id, inner: h.ends[0], outer, seat });
    h.ends[0] = outer;
  } else {
    const outer = otherSide(id, h.ends[1]);
    h.right.push({ id, inner: h.ends[1], outer, seat });
    h.ends[1] = outer;
  }
  h.log.push({ t: 'play', seat, id, side, ends: endsBefore });

  if (h.hands[seat].length === 0) {
    finishBatida(h, seat, id, endsBefore!);
    return h;
  }
  h.turn = (seat + 1) % h.n;
  checkBlocked(h);
  return h;
}

export function batidaKind(id: number, endsBefore: [number, number]): ResultKind {
  const both = hasNum(id, endsBefore[0]) && hasNum(id, endsBefore[1]);
  const dbl = isDouble(id);
  if (both && dbl) return 'cruzada';
  if (both) return 'laELo';
  if (dbl) return 'carroca';
  return 'simples';
}

const handPips = (hand: number[]) => hand.reduce((s, id) => s + pipsOf(id), 0);

function finishBatida(h: HandState, seat: number, id: number, endsBefore: [number, number]) {
  const kind = batidaKind(id, endsBefore);
  h.result = {
    kind,
    winnerSeat: seat,
    winnerSlot: teamOf(h.mode, seat),
    points: 0, // filled in by the match using the rules
    pipCounts: h.hands.map(handPips),
    hands: h.hands.map((x) => x.slice()),
  };
}

function checkBlocked(h: HandState) {
  if (h.result || h.boneyard.length > 0 || !h.ends) return;
  for (let s = 0; s < h.n; s++) if (canPlayAny(h, s)) return;
  h.result = {
    kind: 'blocked',
    winnerSeat: -1,
    winnerSlot: -1,
    points: 0,
    pipCounts: h.hands.map(handPips),
    hands: h.hands.map((x) => x.slice()),
  };
}

/** Decide who wins a blocked hand. Mutates the result. */
export function resolveBlocked(res: HandResult, mode: Mode, rules: Rules) {
  const c = res.pipCounts;
  const lowestSeat = (seats: number[]) => seats.reduce((b, s) => (c[s] < c[b] ? s : b), seats[0]);
  if (hasTeams(mode) && rules.blockedResolution === 'pairTotal') {
    const t0 = c[0] + c[2];
    const t1 = c[1] + c[3];
    if (t0 === t1) return tie(res);
    const team = t0 < t1 ? 0 : 1;
    res.winnerSlot = team;
    res.winnerSeat = lowestSeat(team === 0 ? [0, 2] : [1, 3]);
    return;
  }
  const min = Math.min(...c);
  const seats = c.map((v, s) => (v === min ? s : -1)).filter((s) => s >= 0);
  const slots = new Set(seats.map((s) => teamOf(mode, s)));
  if (slots.size > 1) return tie(res);
  res.winnerSeat = seats[0];
  res.winnerSlot = teamOf(mode, seats[0]);
}

function tie(res: HandResult) {
  res.kind = 'tie';
  res.winnerSeat = -1;
  res.winnerSlot = -1;
}

// ---------------------------------------------------------------- match flow

export function applyMatchMove(m: MatchState, seat: number, move: Move): MatchState {
  const hand = applyMove(m.hand, seat, move);
  const next: MatchState = { ...m, hand };
  if (hand.result) scoreHand(next);
  return next;
}

function scoreHand(m: MatchState) {
  const res = m.hand.result!;
  if (res.kind === 'blocked') resolveBlocked(res, m.rules.mode, m.rules);
  if (res.kind === 'tie') {
    res.points = 0;
  } else {
    const base =
      m.rules.scoring === 'pips'
        ? losersPips(m.rules.mode, res.pipCounts, res.winnerSlot)
        : res.kind === 'blocked'
          ? m.rules.points.blocked
          : m.rules.points[res.kind as keyof Rules['points']];
    res.points = base * m.hand.multiplier;
    m.scores = m.scores.slice();
    m.scores[res.winnerSlot] += res.points;
  }
  m.history = [...m.history, res];
  const top = Math.max(...m.scores);
  if (top >= m.rules.targetScore) m.winner = m.scores.indexOf(top);
}

export function nextHand(m: MatchState, rng: Rng): MatchState {
  if (m.winner !== null) throw new Error('match is over');
  const prev = m.hand;
  const res = prev.result!;
  const multiplier = res.kind === 'tie' && m.rules.tieDoublesNext ? prev.multiplier * 2 : 1;
  let starter: number;
  if (m.rules.nextStarter === 'winner' && res.winnerSeat >= 0) starter = res.winnerSeat;
  else starter = (prev.starter + 1) % m.n;
  return { ...m, handNo: m.handNo + 1, multiplier, hand: dealHand(m.rules.mode, rng, starter, multiplier) };
}

/** Is a 0-point loser present when the match ends (a "buchuda")? */
export function isBuchuda(m: MatchState): boolean {
  return m.winner !== null && m.scores.some((s, i) => i !== m.winner && s === 0);
}

export const totalTiles = TILE_COUNT;
