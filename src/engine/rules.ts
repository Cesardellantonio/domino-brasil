export type Mode = 'duplas' | 'ffa4' | 'three' | '1v1';

export interface Rules {
  mode: Mode;
  /**
   * 'pips' (corrida até 100): each side that loses the hand adds the pips left in its own
   * hands to its own score; whoever reaches `targetScore` LOSES the match.
   * 'batida': the winning side scores fixed points per kind of go-out (simples 1, carroça 2,
   * lá-e-lô 3, cruzada 4); whoever reaches `targetScore` WINS.
   */
  scoring: 'pips' | 'batida';
  /** Points needed to win the match. */
  targetScore: number;
  points: {
    simples: number;
    carroca: number;
    laELo: number;
    cruzada: number;
    blocked: number;
  };
  /** How a blocked hand (jogo trancado) is decided. */
  blockedResolution: 'pairTotal' | 'lowestPlayer';
  /** On a blocked tie nobody scores and the next hand is worth double. */
  tieDoublesNext: boolean;
  /** Who starts hands after the first one. */
  nextStarter: 'winner' | 'rotate';
}

export const DEFAULT_RULES: Rules = {
  mode: 'duplas',
  scoring: 'pips',
  targetScore: 100,
  points: { simples: 1, carroca: 2, laELo: 3, cruzada: 4, blocked: 1 },
  blockedResolution: 'pairTotal',
  tieDoublesNext: true,
  nextStarter: 'winner',
};

export const playersFor = (mode: Mode) => (mode === '1v1' ? 2 : mode === 'three' ? 3 : 4);
export const hasTeams = (mode: Mode) => mode === 'duplas';
export const HAND_SIZE = 7;

/** Score slot for a seat: team index in duplas, otherwise the seat itself. */
export const teamOf = (mode: Mode, seat: number) => (hasTeams(mode) ? seat % 2 : seat);
export const scoreSlots = (mode: Mode) => (hasTeams(mode) ? 2 : playersFor(mode));

/** Pips held by everyone outside the winning score slot (used by the bots' evaluation). */
export function losersPips(mode: Mode, pipCounts: number[], winnerSlot: number): number {
  let sum = 0;
  pipCounts.forEach((c, seat) => {
    if (teamOf(mode, seat) !== winnerSlot) sum += c;
  });
  return sum;
}
