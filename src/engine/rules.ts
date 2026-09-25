export type Mode = 'duplas' | 'ffa4' | 'three' | '1v1';

export interface Rules {
  mode: Mode;
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
  targetScore: 6,
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
