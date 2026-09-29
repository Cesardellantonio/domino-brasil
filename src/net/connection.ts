import { ClientMsg, HostMsg, RoomSnapshot } from './protocol';
import { Room } from './room';
import { BROKERS, MqttSocket, open, roomChannel, RoomChannel, seal, sha256hex } from './mqtt';

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'notFound' | 'error';

export interface Connection {
  readonly isHost: boolean;
  status: ConnStatus;
  send(m: ClientMsg): void;
  onMessage(fn: (m: HostMsg) => void): () => void;
  onStatus(fn: (s: ConnStatus) => void): () => void;
  close(): void;
}

/**
 * Transporte da mesa online.
 *
 * Os navegadores não se conectam diretamente (isso falha em muitas redes de celular e
 * roteadores). Em vez disso, todos falam com um "carteiro" MQTT público por WebSocket
 * seguro, que funciona em qualquer rede. Os tópicos são um hash do código da mesa e todo
 * o conteúdo vai cifrado com AES-GCM (chave derivada do código), então o servidor público
 * só vê bytes embaralhados.
 *
 *   convidado --(cifrado)--> <base>/h           caixa de entrada do anfitrião
 *   anfitrião --(cifrado)--> <base>/c/<inbox>   caixa de entrada de cada convidado
 *   anfitrião --(retido)---> <base>/p           presença: 1 = mesa aberta, 0 = fechada
 */

/** Envelope from guest to host. */
interface Up {
  from: string;
  inbox: string;
  m?: ClientMsg;
  hb?: 1;
  bye?: 1;
}

const HEARTBEAT_MS = 5000;
const GUEST_TIMEOUT_MS = 17_000;
const ON = new Uint8Array([49]); // "1"
const OFF = new Uint8Array([48]); // "0"

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

/** Serializes async work (encryption) so messages keep their order. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run(fn: () => Promise<void>) {
    this.tail = this.tail.then(fn, fn).catch(() => {});
  }
}

const rid = () => Math.random().toString(36).slice(2, 10);

// ------------------------------------------------------------------ snapshots

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

// ------------------------------------------------------------------ host

interface Guest {
  inbox: string;
  sock: MqttSocket;
  lastSeen: number;
  live: boolean;
  q: Queue;
}

/** The host plays in-process with its own Room; online hosts also serve guests through the relay. */
export class HostConnection implements Connection {
  readonly isHost = true;
  status: ConnStatus = 'open';
  room: Room;
  private msgs = new Emitter<HostMsg>();
  private statuses = new Emitter<ConnStatus>();
  private closed = false;
  private chan: RoomChannel | null = null;
  private socks = new Map<string, MqttSocket>();
  private guests = new Map<string, Guest>();
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(room: Room, private clientId: string) {
    this.room = room;
    room.onSnapshot = saveSnapshot;
    room.connect(clientId, (m) => queueMicrotask(() => this.msgs.emit(m)));
    if (room.online) {
      this.status = 'connecting';
      void this.start();
    }
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statuses.emit(s);
  }

  private async start() {
    this.chan = await roomChannel(this.room.code);
    if (this.closed) return;
    for (const url of BROKERS) void this.connectBroker(url, 0);
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const [id, g] of this.guests)
        if (g.live && now - g.lastSeen > GUEST_TIMEOUT_MS) {
          g.live = false;
          this.room.disconnect(id);
        }
    }, 2000);
  }

  private async connectBroker(url: string, attempt: number) {
    if (this.closed || !this.chan) return;
    const { base } = this.chan;
    const sock = new MqttSocket(url);
    try {
      await sock.connect('dmbr-h-' + rid(), { topic: base + '/p', payload: OFF, retain: true });
    } catch {
      setTimeout(() => this.connectBroker(url, attempt + 1), Math.min(1500 * 2 ** attempt, 15_000));
      this.refreshStatus();
      return;
    }
    if (this.closed) return sock.close();
    this.socks.set(url, sock);
    sock.onMessage = (topic, payload) => {
      if (topic === base + '/h') void this.receive(sock, payload);
    };
    sock.onClose = () => {
      this.socks.delete(url);
      this.refreshStatus();
      setTimeout(() => this.connectBroker(url, 0), 1500);
    };
    sock.subscribe([base + '/h']);
    sock.publish(base + '/p', ON, true);
    this.refreshStatus();
  }

  private refreshStatus() {
    if (this.closed) return;
    this.setStatus(this.socks.size > 0 ? 'open' : 'reconnecting');
  }

  private async receive(sock: MqttSocket, payload: Uint8Array) {
    const env = await open<Up>(this.chan!.key, payload);
    if (!env || typeof env.from !== 'string' || typeof env.inbox !== 'string' || env.from === this.clientId) return;
    const id = env.from;
    let g = this.guests.get(id);
    if (!g) {
      g = { inbox: env.inbox, sock, lastSeen: 0, live: false, q: new Queue() };
      this.guests.set(id, g);
    }
    g.inbox = env.inbox;
    g.sock = sock; // reply through the broker the guest is using
    g.lastSeen = Date.now();
    if (env.bye) {
      if (g.live) {
        g.live = false;
        this.room.disconnect(id);
      }
      return;
    }
    if (!g.live) {
      g.live = true;
      this.room.connect(id, (m) => this.deliver(id, m));
      if (!env.m) this.room.update(); // heartbeat after a gap: resend the table state
    }
    if (env.m) {
      if (env.m.t === 'hello' && env.m.clientId !== id) return;
      this.room.handle(id, env.m);
    }
  }

  private deliver(id: string, m: HostMsg) {
    const g = this.guests.get(id);
    if (!g || !this.chan) return;
    const { key, base } = this.chan;
    g.q.run(async () => {
      const data = await seal(key, m);
      const sock = g.sock.open ? g.sock : [...this.socks.values()][0];
      sock?.publish(base + '/c/' + g.inbox, data);
    });
  }

  send(m: ClientMsg) {
    queueMicrotask(() => this.room.handle(this.clientId, m));
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
    this.room.dispose();
    for (const s of this.socks.values()) {
      if (this.chan) s.publish(this.chan.base + '/p', OFF, true);
      s.close();
    }
    this.socks.clear();
  }
}

// ------------------------------------------------------------------ guest

/** A guest reaches the host's browser through the relay. */
export class GuestConnection implements Connection {
  readonly isHost = false;
  status: ConnStatus = 'connecting';
  private msgs = new Emitter<HostMsg>();
  private statuses = new Emitter<ConnStatus>();
  private chan: RoomChannel | null = null;
  private inbox = '';
  private sock: MqttSocket | null = null;
  private closed = false;
  private hostUp = false;
  private hello: ClientMsg & { t: 'hello' };
  private hb: ReturnType<typeof setInterval> | null = null;
  private rq = new Queue();
  private sq = new Queue();
  private generation = 0;
  private onVisible = () => {
    if (document.visibilityState === 'visible' && !this.sock?.open) this.retryNow();
  };
  private onHide = () => this.post({ bye: 1 });

  constructor(private code: string, hello: ClientMsg & { t: 'hello' }) {
    this.hello = hello;
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('pagehide', this.onHide);
    void this.start();
  }

  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statuses.emit(s);
  }

  private async start() {
    this.chan = await roomChannel(this.code);
    this.inbox = (await sha256hex('dominobr-inbox:' + this.hello.clientId)).slice(0, 20);
    this.hb = setInterval(() => this.hostUp && this.post({ hb: 1 }), HEARTBEAT_MS);
    void this.findHost();
  }

  /** Try each broker until one shows the table as open. Keeps retrying while the page is open. */
  private async findHost() {
    const gen = ++this.generation;
    let round = 0;
    while (!this.closed && gen === this.generation) {
      for (const url of BROKERS) {
        if (this.closed || gen !== this.generation) return;
        if (await this.tryBroker(url, gen)) return;
      }
      round++;
      this.setStatus('notFound');
      await new Promise((r) => setTimeout(r, Math.min(3000 * round, 10_000)));
    }
  }

  private tryBroker(url: string, gen: number): Promise<boolean> {
    const { base, key } = this.chan!;
    return new Promise((resolve) => {
      const sock = new MqttSocket(url);
      let decided = false;
      const decide = (ok: boolean) => {
        if (decided) return;
        decided = true;
        clearTimeout(timer);
        if (!ok) sock.close();
        resolve(ok);
      };
      const timer = setTimeout(() => decide(false), 6000);
      sock.onMessage = (topic, payload) => {
        if (topic === base + '/p') {
          const up = payload[0] === ON[0];
          if (!decided) {
            if (!up) return decide(false);
            this.adopt(sock, gen);
            return decide(true);
          }
          if (this.sock !== sock) return;
          this.hostUp = up;
          if (up) {
            this.setStatus('open');
            this.post({ m: this.hello });
          } else this.setStatus('reconnecting');
        } else if (topic === base + '/c/' + this.inbox && this.sock === sock) {
          this.rq.run(async () => {
            const m = await open<HostMsg>(key, payload);
            if (m) this.msgs.emit(m);
          });
        }
      };
      sock.onClose = () => {
        if (!decided) return decide(false);
        if (this.sock === sock && !this.closed) {
          this.sock = null;
          this.hostUp = false;
          this.setStatus('reconnecting');
          setTimeout(() => this.findHost(), 1200);
        }
      };
      sock
        .connect('dmbr-g-' + rid())
        .then(() => {
          if (this.closed || gen !== this.generation) return decide(false);
          sock.subscribe([base + '/c/' + this.inbox, base + '/p']);
        })
        .catch(() => decide(false));
    });
  }

  private adopt(sock: MqttSocket, gen: number) {
    if (gen !== this.generation || this.closed) return sock.close();
    if (this.sock && this.sock !== sock) this.sock.close();
    this.sock = sock;
    this.hostUp = true;
    this.setStatus('open');
    this.post({ m: this.hello });
  }

  private post(extra: Omit<Up, 'from' | 'inbox'>) {
    const sock = this.sock;
    const chan = this.chan;
    if (!sock || !chan) return;
    const env: Up = { from: this.hello.clientId, inbox: this.inbox, ...extra };
    this.sq.run(async () => {
      const data = await seal(chan.key, env);
      sock.publish(chan.base + '/h', data);
    });
  }

  retryNow() {
    if (this.closed) return;
    this.setStatus('connecting');
    const old = this.sock;
    this.sock = null;
    old?.close();
    void this.findHost();
  }

  send(m: ClientMsg) {
    if (m.t === 'hello') this.hello = m;
    this.post({ m });
  }
  onMessage(fn: (m: HostMsg) => void) {
    return this.msgs.on(fn);
  }
  onStatus(fn: (s: ConnStatus) => void) {
    return this.statuses.on(fn);
  }
  close() {
    this.post({ bye: 1 });
    this.closed = true;
    this.generation++;
    if (this.hb) clearInterval(this.hb);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('pagehide', this.onHide);
    const s = this.sock;
    setTimeout(() => s?.close(), 300); // let the goodbye go out
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
