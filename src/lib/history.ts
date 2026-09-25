import { Mode } from '../engine/rules';
import { HandResult } from '../engine/game';

export interface MatchRecord {
  id: string;
  at: number;
  mode: Mode;
  players: { name: string; avatar: string; bot: boolean; slot: number }[];
  mySlot: number;
  myName: string;
  winnerSlot: number;
  scores: number[];
  myBatidas: number;
}

const KEY = 'domino.history';

export function loadHistory(): MatchRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function recordMatch(r: MatchRecord) {
  const all = loadHistory();
  if (all.some((x) => x.id === r.id)) return;
  all.unshift(r);
  try {
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 300)));
  } catch {
    /* ignore */
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const countBatidas = (history: HandResult[], seat: number) =>
  history.filter((h) => h.winnerSeat === seat && h.kind !== 'blocked' && h.kind !== 'tie').length;

export interface Rival {
  name: string;
  avatar: string;
  togetherPlayed: number;
  togetherWon: number;
  againstPlayed: number;
  againstWon: number;
}

/** Head-to-head and partnership records against other humans. */
export function rivals(all: MatchRecord[]): Rival[] {
  const map = new Map<string, Rival>();
  for (const m of all) {
    for (const p of m.players) {
      if (p.bot || p.name === m.myName) continue;
      const key = p.name.trim().toLowerCase();
      const r = map.get(key) ?? { name: p.name, avatar: p.avatar, togetherPlayed: 0, togetherWon: 0, againstPlayed: 0, againstWon: 0 };
      const won = m.winnerSlot === m.mySlot;
      if (p.slot === m.mySlot) {
        r.togetherPlayed++;
        if (won) r.togetherWon++;
      } else {
        r.againstPlayed++;
        if (won) r.againstWon++;
      }
      map.set(key, r);
    }
  }
  return [...map.values()].sort((a, b) => b.togetherPlayed + b.againstPlayed - (a.togetherPlayed + a.againstPlayed));
}
