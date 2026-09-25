import { applyMatchMove, IllegalMove, MatchState, Move, newMatch, nextHand, legalMoves } from '../engine/game';
import { DEFAULT_RULES, playersFor, teamOf } from '../engine/rules';
import { viewFor } from '../engine/view';
import { BotLevel, chooseMove } from '../bots/bots';
import { mulberry32, secureSeed } from '../lib/rng';
import { ClientMsg, ClientState, HostMsg, Phase, RoomSnapshot, Seat, Settings } from './protocol';

export const BOT_NAMES = ['Zé Robô', 'Dona Bit', 'Tião 3000', 'Chiquinha', 'Seu Byte', 'Nenê Chip', 'Juju', 'Mestre Tonho'];
export const BOT_AVATARS = ['🦜', '🐢', '🦊', '🐓', '🐸', '🦉', '🐱', '🐻'];

export const DEFAULT_SETTINGS: Settings = { rules: DEFAULT_RULES, botSpeed: 'normal', hints: true };

const DISCONNECT_GRACE_MS = 40_000;
const AUTO_NEXT_MS = 9_000;
const SPEED = { slow: [1300, 2300], normal: [750, 1500], fast: [300, 600] } as const;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newRoomCode(): string {
  const rng = mulberry32(secureSeed());
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}

interface Client {
  send: (m: HostMsg) => void;
  name: string;
  avatar: string;
  connected: boolean;
  lostAt: number;
}

const emptySeat = (): Seat => ({ kind: 'empty', name: '', avatar: '', level: 'medium' });

/**
 * The authoritative game host. Runs in the browser of whoever created the table
 * (or locally for solo games) and talks to clients through `send` callbacks, so it is
 * agnostic of the transport.
 */
export class Room {
  code: string;
  hostId: string;
  online: boolean;
  seats: Seat[];
  settings: Settings;
  phase: Phase = 'lobby';
  match: MatchState | null = null;
  matchNo = 0;
  ready: boolean[] = [];
  autoNextAt: number | null = null;
  clients = new Map<string, Client>();
  voice = new Map<string, { peerId: string; muted: boolean }>();
  onSnapshot?: (s: RoomSnapshot) => void;

  private rng = mulberry32(secureSeed());
  private createdAt = Date.now();
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private botKey = '';
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, hostId: string, online: boolean, snap?: RoomSnapshot) {
    this.code = code;
    this.hostId = hostId;
    this.online = online;
    this.settings = snap?.settings ?? DEFAULT_SETTINGS;
    this.seats = snap?.seats ?? Array.from({ length: 4 }, emptySeat);
    if (snap) {
      this.phase = snap.phase;
      this.match = snap.match;
      this.matchNo = snap.matchNo;
      if (this.phase === 'handOver') this.armAutoNext();
      this.graceTimer = setTimeout(() => this.update(), DISCONNECT_GRACE_MS + 50);
    }
    this.ready = new Array(4).fill(false);
  }

  get n() {
    return playersFor(this.settings.rules.mode);
  }

  // ------------------------------------------------------------- connections

  connect(clientId: string, send: (m: HostMsg) => void) {
    const c = this.clients.get(clientId);
    if (c) {
      c.send = send;
      c.connected = true;
    } else this.clients.set(clientId, { send, name: '', avatar: '', connected: true, lostAt: 0 });
  }

  disconnect(clientId: string) {
    const c = this.clients.get(clientId);
    if (!c) return;
    c.connected = false;
    c.lostAt = Date.now();
    this.voice.delete(clientId);
    this.broadcast();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.update(), DISCONNECT_GRACE_MS + 50);
  }

  seatOf(clientId: string): number | null {
    const i = this.seats.findIndex((s) => s.kind === 'human' && s.clientId === clientId);
    return i >= 0 && i < this.n ? i : null;
  }

  /** A seat is played by a bot if it is a bot, or its human has been away too long. */
  private covered(seat: number): boolean {
    const s = this.seats[seat];
    if (s.kind !== 'human') return false;
    const c = s.clientId ? this.clients.get(s.clientId) : undefined;
    const lostAt = c ? c.lostAt : this.createdAt; // never reconnected since the host reloaded
    return (!c || !c.connected) && Date.now() - lostAt > DISCONNECT_GRACE_MS;
  }
  private botControlled(seat: number) {
    return this.seats[seat].kind === 'bot' || this.covered(seat);
  }

  // ------------------------------------------------------------- messages

  handle(clientId: string, msg: ClientMsg) {
    try {
      this.dispatch(clientId, msg);
    } catch (e) {
      const c = this.clients.get(clientId);
      c?.send({ t: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
    this.update();
  }

  private isHost(clientId: string) {
    return clientId === this.hostId;
  }

  private dispatch(clientId: string, msg: ClientMsg) {
    const client = this.clients.get(clientId);
    const seat = this.seatOf(clientId);
    switch (msg.t) {
      case 'hello': {
        if (client) {
          client.name = msg.name.slice(0, 18);
          client.avatar = msg.avatar.slice(0, 8);
        }
        if (seat !== null) {
          this.seats[seat].name = client!.name;
          this.seats[seat].avatar = client!.avatar;
        } else if (this.phase === 'lobby' && !this.isHost(clientId)) {
          // Newcomers sit down automatically: partner seat first, then opponents.
          const order = this.n === 4 ? [2, 1, 3, 0] : [...Array(this.n).keys()];
          const free = order.find((i) => this.seats[i].kind === 'empty') ?? order.find((i) => this.seats[i].kind === 'bot');
          if (free !== undefined) this.seats[free] = { kind: 'human', name: client!.name, avatar: client!.avatar, level: 'medium', clientId };
        }
        return;
      }
      case 'sit': {
        if (this.phase !== 'lobby') throw new Error('Partida em andamento');
        const target = this.seats[msg.seat];
        if (!target || msg.seat >= this.n) throw new Error('Lugar inválido');
        if (target.kind === 'human' && target.clientId !== clientId) throw new Error('Lugar ocupado');
        if (seat !== null) this.seats[seat] = emptySeat();
        this.seats[msg.seat] = { kind: 'human', name: client?.name ?? '', avatar: client?.avatar ?? '🙂', level: 'medium', clientId };
        return;
      }
      case 'stand': {
        if (this.phase !== 'lobby' || seat === null) return;
        this.seats[seat] = emptySeat();
        return;
      }
      case 'setSeat': {
        if (!this.isHost(clientId)) throw new Error('Só o anfitrião pode mudar os lugares');
        if (this.phase !== 'lobby') throw new Error('Partida em andamento');
        const s = this.seats[msg.seat];
        if (!s || (s.kind === 'human' && s.clientId === this.hostId && msg.kind === 'empty')) return;
        if (msg.kind === 'empty') this.seats[msg.seat] = emptySeat();
        else this.seats[msg.seat] = this.makeBot(msg.seat, msg.level ?? 'medium', s.kind === 'bot' ? s : undefined);
        return;
      }
      case 'swap': {
        if (!this.isHost(clientId) || this.phase !== 'lobby') return;
        const { a, b } = msg;
        [this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]];
        return;
      }
      case 'settings': {
        if (!this.isHost(clientId)) throw new Error('Só o anfitrião pode mudar as regras');
        if (this.phase !== 'lobby' && msg.settings.rules.mode !== this.settings.rules.mode) throw new Error('Partida em andamento');
        this.settings = msg.settings;
        return;
      }
      case 'start': {
        if (!this.isHost(clientId)) throw new Error('Só o anfitrião pode começar');
        if (this.phase !== 'lobby' && this.phase !== 'matchOver') return;
        this.startMatch();
        return;
      }
      case 'rematch': {
        if (this.phase !== 'matchOver') return;
        if (seat === null && !this.isHost(clientId)) return;
        this.startMatch();
        return;
      }
      case 'toLobby': {
        if (!this.isHost(clientId)) return;
        this.clearTimers();
        this.phase = 'lobby';
        this.match = null;
        return;
      }
      case 'move': {
        if (this.phase !== 'playing' || !this.match) throw new Error('Não é hora de jogar');
        if (seat === null) throw new Error('Você não está sentado');
        if (msg.handNo !== this.match.handNo) return; // stale
        this.play(seat, msg.move);
        return;
      }
      case 'ready': {
        if (this.phase !== 'handOver' || seat === null) return;
        this.ready[seat] = true;
        const humans = this.seats.slice(0, this.n).map((s, i) => (s.kind === 'human' && !this.covered(i) ? i : -1)).filter((i) => i >= 0);
        const connectedHumans = humans.filter((i) => this.clients.get(this.seats[i].clientId!)?.connected);
        if (connectedHumans.every((i) => this.ready[i])) this.advance();
        return;
      }
      case 'voice': {
        if (!this.online) return;
        if (msg.on && typeof msg.peerId === 'string' && msg.peerId) this.voice.set(clientId, { peerId: msg.peerId.slice(0, 80), muted: !!msg.muted });
        else this.voice.delete(clientId);
        return;
      }
      case 'emote': {
        const key = msg.key.slice(0, 80);
        const from = seat ?? -1;
        const name = client?.name ?? '';
        for (const c of this.clients.values()) if (c.connected) c.send({ t: 'emote', seat: from, name, key });
        return;
      }
    }
  }

  private makeBot(seat: number, level: BotLevel, prev?: Seat): Seat {
    const used = new Set(this.seats.map((s) => s.name));
    let i = seat;
    while (used.has(BOT_NAMES[i % BOT_NAMES.length]) && i < seat + BOT_NAMES.length) i++;
    return {
      kind: 'bot',
      level,
      name: prev?.name ?? BOT_NAMES[i % BOT_NAMES.length],
      avatar: prev?.avatar ?? BOT_AVATARS[i % BOT_AVATARS.length],
    };
  }

  // ------------------------------------------------------------- game flow

  startMatch() {
    const n = this.n;
    for (let i = 0; i < n; i++) if (this.seats[i].kind === 'empty') this.seats[i] = this.makeBot(i, 'medium');
    for (let i = n; i < 4; i++) this.seats[i] = emptySeat();
    this.clearTimers();
    this.rng = mulberry32(secureSeed());
    this.match = newMatch(this.settings.rules, this.rng);
    this.matchNo++;
    this.phase = 'playing';
    this.ready = new Array(4).fill(false);
  }

  private play(seat: number, move: Move) {
    try {
      this.match = applyMatchMove(this.match!, seat, move);
    } catch (e) {
      if (e instanceof IllegalMove) throw new Error('Jogada inválida');
      throw e;
    }
    const res = this.match.hand.result;
    if (res) {
      this.phase = this.match.winner !== null ? 'matchOver' : 'handOver';
      this.ready = new Array(4).fill(false);
      if (this.phase === 'handOver') this.armAutoNext();
      this.botBanter(res.winnerSlot, res.kind);
    }
  }

  private armAutoNext() {
    this.autoNextAt = Date.now() + AUTO_NEXT_MS;
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = setTimeout(() => {
      this.advance();
      this.update();
    }, AUTO_NEXT_MS);
  }

  private advance() {
    if (this.phase !== 'handOver' || !this.match) return;
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.autoNextAt = null;
    this.match = nextHand(this.match, this.rng);
    this.phase = 'playing';
    this.ready = new Array(4).fill(false);
  }

  private clearTimers() {
    if (this.botTimer) clearTimeout(this.botTimer);
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.botTimer = this.nextTimer = null;
    this.botKey = '';
    this.autoNextAt = null;
  }

  /** Schedule automatic actions: bot turns and forced passes/draws for humans. */
  private schedule() {
    if (this.phase !== 'playing' || !this.match) return;
    const h = this.match.hand;
    if (h.result) return;
    const seat = h.turn;
    const key = `${this.matchNo}:${this.match.handNo}:${h.log.length}`;
    if (this.botKey === key) return;
    const legal = legalMoves(h, seat);
    const bot = this.botControlled(seat);
    const forced = legal.length === 1 && legal[0].t !== 'play';
    if (!bot && !forced) return;

    if (this.botTimer) clearTimeout(this.botTimer);
    this.botKey = key;
    const [lo, hi] = SPEED[this.settings.botSpeed];
    let delay = lo + Math.random() * (hi - lo);
    if (forced) delay = legal[0].t === 'draw' ? 550 : bot ? delay * 0.8 : 1100;
    if (h.log.length === 0) delay += 900; // let the deal animation breathe
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (!this.match || this.match.hand !== h) return;
      const level: BotLevel = this.seats[seat].kind === 'bot' ? this.seats[seat].level : 'hard';
      const move = forced ? legal[0] : chooseMove(viewFor(this.match, seat), level, this.rng);
      try {
        this.play(seat, move);
      } catch (e) {
        console.error('bot move failed', e);
      }
      this.update();
    }, delay);
  }

  private botBanter(winnerSlot: number, kind: string) {
    const mode = this.settings.rules.mode;
    const bots = this.seats.slice(0, this.n).map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'bot');
    if (!bots.length || Math.random() > 0.55) return;
    const pick = bots[Math.floor(Math.random() * bots.length)];
    const won = winnerSlot >= 0 && teamOf(mode, pick.i) === winnerSlot;
    const pool = won
      ? kind === 'laELo' || kind === 'cruzada'
        ? ['e.segura', 'e.olha', 'e.laELo']
        : ['e.boa', 'e.facil', 'e.segura', 'e.cafe']
      : winnerSlot < 0
        ? ['e.empate']
        : ['e.sorte', 'e.proxima', 'e.dificil'];
    const key = pool[Math.floor(Math.random() * pool.length)];
    setTimeout(() => {
      for (const c of this.clients.values()) if (c.connected) c.send({ t: 'emote', seat: pick.i, name: pick.s.name, key });
    }, 900 + Math.random() * 900);
  }

  // ------------------------------------------------------------- outbound

  update() {
    this.schedule();
    this.broadcast();
    this.onSnapshot?.(this.snapshot());
  }

  snapshot(): RoomSnapshot {
    return {
      v: 1,
      code: this.code,
      hostId: this.hostId,
      online: this.online,
      seats: this.seats,
      settings: this.settings,
      phase: this.phase,
      match: this.match,
      matchNo: this.matchNo,
      savedAt: Date.now(),
    };
  }

  stateFor(clientId: string): ClientState {
    const seat = this.seatOf(clientId);
    const seatIds = new Set(this.seats.map((s) => s.clientId));
    return {
      code: this.code,
      online: this.online,
      you: { clientId, seat, isHost: this.isHost(clientId) },
      seats: this.seats.map((s, i) => ({
        ...s,
        connected: s.kind !== 'human' || !!(s.clientId && this.clients.get(s.clientId)?.connected),
        covered: i < this.n && this.covered(i),
        isHost: s.clientId === this.hostId,
      })),
      settings: this.settings,
      phase: this.phase,
      view: this.match ? viewFor(this.match, seat ?? -1) : null,
      ready: this.ready,
      autoNextIn: this.autoNextAt ? Math.max(0, this.autoNextAt - Date.now()) : null,
      matchNo: this.matchNo,
      voice: [...this.voice.entries()].map(([id, v]) => {
        const c = this.clients.get(id);
        return { clientId: id, peerId: v.peerId, muted: v.muted, name: c?.name ?? '', avatar: c?.avatar ?? '', seat: this.seatOf(id) };
      }),
      spectators: [...this.clients.entries()].filter(([id, c]) => c.connected && !seatIds.has(id) && c.name).map(([, c]) => c.name),
    };
  }

  broadcast() {
    for (const [id, c] of this.clients) if (c.connected) c.send({ t: 'state', state: this.stateFor(id) });
  }

  dispose() {
    this.clearTimers();
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.onSnapshot = undefined;
  }
}
