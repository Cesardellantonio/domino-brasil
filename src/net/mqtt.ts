/**
 * Cliente MQTT 3.1.1 mínimo sobre WebSocket (só QoS 0), sem dependências.
 * Usado como "carteiro" entre os navegadores: funciona em qualquer rede, porque é
 * só uma conexão HTTPS/WebSocket comum, sem depender de conexão direta entre aparelhos.
 */

const te = new TextEncoder();
const td = new TextDecoder();

function str(s: string): number[] {
  const b = te.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    out.push(d);
  } while (n > 0);
  return out;
}

function packet(type: number, body: Uint8Array | number[]): Uint8Array {
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  const head = [type, ...varint(b.length)];
  const out = new Uint8Array(head.length + b.length);
  out.set(head, 0);
  out.set(b, head.length);
  return out;
}

export interface Will {
  topic: string;
  payload: Uint8Array;
  retain: boolean;
}

export class MqttSocket {
  onMessage?: (topic: string, payload: Uint8Array) => void;
  onClose?: () => void;
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private pid = 1;
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(readonly url: string) {}

  get open() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && !this.closed;
  }

  connect(clientId: string, will?: Will, timeoutMs = 7000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail('timeout'), timeoutMs);
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch {
        clearTimeout(timer);
        return fail('ws');
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        let flags = 0x02; // clean session
        const payload = [...str(clientId)];
        if (will) {
          flags |= 0x04 | (will.retain ? 0x20 : 0);
          payload.push(...str(will.topic), will.payload.length >> 8, will.payload.length & 255, ...will.payload);
        }
        ws.send(packet(0x10, [...str("MQTT"), 4, flags, 0, 30, ...payload]) as Uint8Array<ArrayBuffer>);
      };
      ws.onmessage = (e) => {
        const chunk = new Uint8Array(e.data as ArrayBuffer);
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
        this.drain((type, body) => {
          if (type === 2) {
            clearTimeout(timer);
            if (body[1] !== 0) return fail('refused ' + body[1]);
            settled = true;
            this.ping = setInterval(() => this.send(new Uint8Array([0xc0, 0])), 20_000);
            resolve();
          }
        });
      };
      ws.onerror = () => fail('error');
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) fail('closed');
        else this.handleClose();
      };
    });
  }

  private drain(onControl: (type: number, body: Uint8Array) => void) {
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1;
      let len = 0;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4;
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 3) {
        // PUBLISH (QoS 0): topic + payload
        const tl = (body[0] << 8) | body[1];
        const topic = td.decode(body.slice(2, 2 + tl));
        this.onMessage?.(topic, body.slice(2 + tl));
      } else onControl(type, body);
    }
  }

  subscribe(topics: string[]) {
    const id = this.pid++ & 0xffff || 1;
    const body: number[] = [id >> 8, id & 255];
    for (const t of topics) body.push(...str(t), 0);
    this.send(packet(0x82, body));
  }

  publish(topic: string, payload: Uint8Array, retain = false) {
    const t = str(topic);
    const body = new Uint8Array(t.length + payload.length);
    body.set(t, 0);
    body.set(payload, t.length);
    this.send(packet(0x30 | (retain ? 1 : 0), body));
  }

  private send(p: Uint8Array) {
    if (this.open) this.ws!.send(p as Uint8Array<ArrayBuffer>);
  }

  private handleClose() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (!this.closed) {
      this.closed = true;
      this.onClose?.();
    }
  }

  close() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const ws = this.ws;
    this.closed = true;
    if (ws && ws.readyState <= 1) {
      try {
        ws.send(new Uint8Array([0xe0, 0])); // DISCONNECT (no will)
      } catch {
        /* ignore */
      }
      ws.close();
    }
  }
}

// ------------------------------------------------------------------ criptografia da mesa

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256hex(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', te.encode(s)));
}

/** Tópicos e chave derivados do código da mesa: o servidor público só vê bytes cifrados. */
export interface RoomChannel {
  base: string;
  key: CryptoKey;
}

export async function roomChannel(code: string): Promise<RoomChannel> {
  const c = code.toUpperCase();
  const base = 'dmbr1/' + (await sha256hex('dominobr-topic:' + c)).slice(0, 28);
  const material = await crypto.subtle.importKey('raw', te.encode('dominobr-room:' + c), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te.encode('dominobr-key-v1'), iterations: 120_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { base, key };
}

export async function seal(key: CryptoKey, obj: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function open<T>(key: CryptoKey, data: Uint8Array): Promise<T | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
    return JSON.parse(td.decode(pt)) as T;
  } catch {
    return null; // not ours / tampered
  }
}

/** Brokers públicos, em ordem de preferência. O anfitrião escuta em todos. */
export const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
