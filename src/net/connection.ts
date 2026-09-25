import type { DataConnection, Peer as PeerT } from 'peerjs';
import { ClientMsg, HostMsg, RoomSnapshot } from './protocol';
import { Room } from './room';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'notFound' | 'error';

export interface Connection {
  readonly isHost: boolean;
  status: ConnStatus;
  send(m: ClientMsg): void;
  onMessage(fn: (m: HostMsg) => void): () => void;
  onStatus(fn: (s: ConnStatus) => void): () => void;
  close(): void;
  /** The PeerJS peer (online tables only), used for voice calls. */
  getPeer(): PeerT | null;
}

const PEER_PREFIX = 'dominobr-v1-';
const peerIdFor = (code: string) => PEER_PREFIX + code.toUpperCase();

class Emitter<T> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void) {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }
  emit(v: T) {
    for (const f of this.fns) f(v);
  }
}

const snapKey = (code: string) => `domino.room.${code}`;
export function loadSnapshot(code: string): RoomSnapshot | null {
  try {
    const raw = localStorage.getItem(snapKey(code));
    if (!raw) return null;
    const s = JSON.parse(raw) as RoomSnapshot;
    if (s.v !== 1 || Date.now() - s.savedAt > 1000 * 60 * 60 * 24 * 3) return null;
    return s;
  } catch {
    return null;
  }
}
export function clearSnapshot(code: string) {
  try {
    localStorage.removeItem(snapKey(code));
  } catch {
    /* ignore */
  }
}
export function saveSnapshot(s: RoomSnapshot) {
  try {
    localStorage.setItem(snapKey(s.code), JSON.stringify(s));
  } catch {
    /* storage full or blocked: the game still works */
  }
}

/** The host plays in-process with its own Room; online hosts also accept peers. */
export class HostConnection implements Connection {
  readonly isHost = true;
  status: ConnStatus = 'open';
  room: Room;
  private msgs = new Emitter<HostMsg>();
  private statuses = new Emitter<ConnStatus>();
  private peer: PeerT | null = null;
  private closed = false;
  private retry = 0;
  private current = new Map<string, DataConnection>();

  constructor(room: Room, private clientId: string) {
    this.room = room;
    room.onSnapshot = saveSnapshot;
    room.connect(clientId, (m) => queueMicrotask(() => this.msgs.emit(m)));
    if (room.online) {
      this.status = 'connecting';
      void this.listen();
    }
  }

  private setStatus(s: ConnStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  private async listen() {
    const { Peer } = await import('peerjs');
    if (this.closed) return;
    const peer = new Peer(peerIdFor(this.room.code), { debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      this.retry = 0;
      this.setStatus('open');
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.closed) return;
      this.setStatus('reconnecting');
      setTimeout(() => !this.closed && !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err: any) => {
      if (this.closed) return;
      const type = err?.type as string;
      if (type === 'unavailable-id' || type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        // The id may still be held from a previous tab/reload; retry with backoff.
        this.setStatus('reconnecting');
        peer.destroy();
        const wait = Math.min(1000 * 2 ** this.retry++, 8000);
        setTimeout(() => !this.closed && void this.listen(), wait);
      }
    });
  }

  private accept(conn: DataConnection) {
    let clientId: string | null = null;
    conn.on('data', (raw) => {
      const msg = raw as ClientMsg;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        if (typeof msg.clientId !== 'string' || msg.clientId === this.clientId) return;
        clientId = msg.clientId;
        this.current.set(clientId, conn);
        this.room.connect(clientId, (m) => {
          if (conn.open) conn.send(m);
        });
      }
      if (clientId) this.room.handle(clientId, msg);
    });
    const drop = () => {
      // Ignore a stale connection closing after the same client already reconnected.
      if (clientId && this.current.get(clientId) === conn) {
        this.current.delete(clientId);
        this.room.disconnect(clientId);
      }
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  send(m: ClientMsg) {
    queueMicrotask(() => this.room.handle(this.clientId, m));
  }
  getPeer() {
    return this.peer && this.peer.open ? this.peer : null;
  }
  onMessage(fn: (m: HostMsg) => void) {
    return this.msgs.on(fn);
  }
  onStatus(fn: (s: ConnStatus) => void) {
    return this.statuses.on(fn);
  }
  close() {
    this.closed = true;
    this.room.dispose();
    this.peer?.destroy();
  }
}

/** A guest connects to the host's browser over WebRTC. */
export class GuestConnection implements Connection {
  readonly isHost = false;
  status: ConnStatus = 'connecting';
  private msgs = new Emitter<HostMsg>();
  private statuses = new Emitter<ConnStatus>();
  private peer: PeerT | null = null;
  private conn: DataConnection | null = null;
  private closed = false;
  private attempts = 0;
  private hello: ClientMsg;
  private lastData = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(private code: string, hello: ClientMsg & { t: 'hello' }) {
    this.hello = hello;
    void this.start();
  }

  updateHello(h: ClientMsg & { t: 'hello' }) {
    this.hello = h;
    this.send(h);
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statuses.emit(s);
  }

  private async start() {
    const { Peer } = await import('peerjs');
    if (this.closed) return;
    const peer = new Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => this.dial());
    peer.on('disconnected', () => !this.closed && !peer.destroyed && setTimeout(() => peer.reconnect(), 1500));
    peer.on('error', (err: any) => {
      if (this.closed) return;
      if (err?.type === 'peer-unavailable') {
        this.attempts++;
        this.setStatus(this.attempts >= 3 ? 'notFound' : 'reconnecting');
        setTimeout(() => this.dial(), Math.min(1500 * this.attempts, 6000));
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err?.type)) {
        this.setStatus('reconnecting');
        peer.destroy();
        setTimeout(() => !this.closed && void this.start(), 2500);
      }
    });
    this.watchdog ??= setInterval(() => {
      // Connection silently died (phone slept): re-dial.
      if (this.status === 'open' && this.conn && !this.conn.open) this.redial();
    }, 3000);
  }

  private dial() {
    if (this.closed || !this.peer || this.peer.destroyed || !this.peer.open) return;
    this.conn?.close();
    const conn = this.peer.connect(peerIdFor(this.code), { reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      this.attempts = 0;
      this.setStatus('open');
      conn.send(this.hello);
    });
    conn.on('data', (raw) => {
      this.lastData = Date.now();
      this.msgs.emit(raw as HostMsg);
    });
    conn.on('close', () => this.conn === conn && this.redial());
    conn.on('error', () => this.conn === conn && this.redial());
  }

  private redial() {
    if (this.closed) return;
    this.setStatus('reconnecting');
    setTimeout(() => this.dial(), 1200);
  }

  retryNow() {
    this.attempts = 0;
    this.setStatus('connecting');
    if (this.peer && !this.peer.destroyed && this.peer.open) this.dial();
    else void this.start();
  }

  get idleMs() {
    return Date.now() - this.lastData;
  }

  send(m: ClientMsg) {
    if (this.conn?.open) this.conn.send(m);
  }
  getPeer() {
    return this.peer && this.peer.open ? this.peer : null;
  }
  onMessage(fn: (m: HostMsg) => void) {
    return this.msgs.on(fn);
  }
  onStatus(fn: (s: ConnStatus) => void) {
    return this.statuses.on(fn);
  }
  close() {
    this.closed = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.conn?.close();
    this.peer?.destroy();
  }
}

/** Create a fresh online table hosted by this browser, with the host in seat 0. */
export function createOnlineRoom(code: string, hello: ClientMsg & { t: 'hello' }): string {
  const room = new Room(code, hello.clientId, true);
  room.connect(hello.clientId, () => {});
  room.handle(hello.clientId, hello);
  room.handle(hello.clientId, { t: 'sit', seat: 0 });
  saveSnapshot(room.snapshot());
  room.dispose();
  return code;
}
