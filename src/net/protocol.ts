import { MatchState, Move } from '../engine/game';
import { Rules } from '../engine/rules';
import { PlayerView } from '../engine/view';
import { BotLevel } from '../bots/bots';

export type SeatKind = 'empty' | 'human' | 'bot';

export interface Seat {
  kind: SeatKind;
  name: string;
  avatar: string;
  level: BotLevel;
  clientId?: string;
}

export interface Settings {
  rules: Rules;
  botSpeed: 'slow' | 'normal' | 'fast';
  hints: boolean;
}

export type Phase = 'lobby' | 'playing' | 'handOver' | 'matchOver';

export interface SeatPublic extends Seat {
  connected: boolean;
  /** A bot is temporarily playing for a disconnected human. */
  covered: boolean;
  isHost: boolean;
}

export interface ClientState {
  code: string;
  online: boolean;
  you: { clientId: string; seat: number | null; isHost: boolean };
  seats: SeatPublic[];
  settings: Settings;
  phase: Phase;
  view: PlayerView | null;
  ready: boolean[];
  /** ms until the host auto-advances to the next hand (relative, so device clocks don't matter). */
  autoNextIn: number | null;
  matchNo: number;
  spectators: string[];
  /** Quem está na chamada de voz (malha WebRTC entre os navegadores). */
  voice: VoiceMember[];
}

export interface VoiceMember {
  clientId: string;
  peerId: string;
  name: string;
  avatar: string;
  seat: number | null;
  muted: boolean;
}

export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string; avatar: string }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'setSeat'; seat: number; kind: 'bot' | 'empty'; level?: BotLevel }
  | { t: 'swap'; a: number; b: number }
  | { t: 'settings'; settings: Settings }
  | { t: 'start' }
  | { t: 'move'; move: Move; handNo: number }
  | { t: 'ready' }
  | { t: 'emote'; key: string }
  | { t: 'rematch' }
  | { t: 'toLobby' }
  | { t: 'voice'; on: boolean; muted: boolean; peerId: string };

export type HostMsg =
  | { t: 'state'; state: ClientState }
  | { t: 'emote'; seat: number; name: string; key: string }
  | { t: 'error'; msg: string };

export interface RoomSnapshot {
  v: 1;
  code: string;
  hostId: string;
  online: boolean;
  seats: Seat[];
  settings: Settings;
  phase: Phase;
  match: MatchState | null;
  matchNo: number;
  savedAt: number;
}
