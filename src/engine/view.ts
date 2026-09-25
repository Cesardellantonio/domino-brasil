import { HandResult, HandState, LogEntry, MatchState, Move, Placed, legalMoves } from './game';
import { Rules } from './rules';

/** Everything one seat is allowed to know. This is the only game data sent to clients. */
export interface PlayerView {
  seat: number; // -1 for spectators
  n: number;
  rules: Rules;
  myHand: number[];
  counts: number[];
  boneyard: number;
  root: Placed | null;
  left: Placed[];
  right: Placed[];
  ends: [number, number] | null;
  turn: number;
  starter: number;
  mustPlay: number | null;
  multiplier: number;
  log: LogEntry[];
  result: HandResult | null;
  scores: number[];
  handNo: number;
  history: HandResult[];
  winner: number | null;
  legal: Move[];
}

export function viewFor(m: MatchState, seat: number): PlayerView {
  const h: HandState = m.hand;
  return {
    seat,
    n: m.n,
    rules: m.rules,
    myHand: seat >= 0 ? h.hands[seat].slice() : [],
    counts: h.hands.map((x) => x.length),
    boneyard: h.boneyard.length,
    root: h.root,
    left: h.left,
    right: h.right,
    ends: h.ends,
    turn: h.turn,
    starter: h.starter,
    mustPlay: h.mustPlay,
    multiplier: h.multiplier,
    log: h.log,
    result: h.result,
    scores: m.scores,
    handNo: m.handNo,
    history: m.history,
    winner: m.winner,
    legal: seat >= 0 ? legalMoves(h, seat) : [],
  };
}
