import type { MediaConnection, Peer as PeerT } from 'peerjs';

/**
 * Chamada de voz em malha: cada participante liga direto para os outros (WebRTC).
 * Para não haver ligação dupla, só quem tem o peerId "menor" inicia a chamada.
 */
export class Voice {
  stream: MediaStream | null = null;
  muted = false;
  /** peerIds (ou 'me') falando agora. */
  onSpeaking?: (speaking: Set<string>) => void;

  private calls = new Map<string, MediaConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private meters = new Map<string, { an: AnalyserNode; buf: Uint8Array<ArrayBuffer>; src: MediaStreamAudioSourceNode }>();
  private ctx: AudioContext | null = null;
  private attached: PeerT | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastSpeaking = '';
  private startedAt = new Map<string, number>();

  constructor(private getPeer: () => PeerT | null) {}

  get active() {
    return !!this.stream;
  }
  get myId() {
    return this.getPeer()?.id ?? null;
  }

  async join() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.setMuted(false);
    const C = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new C();
    void this.ctx.resume();
    this.meter('me', this.stream);
    this.attach();
    this.loop = setInterval(() => this.measure(), 140);
  }

  leave() {
    for (const c of this.calls.values()) c.close();
    this.calls.clear();
    for (const a of this.audios.values()) {
      a.pause();
      a.srcObject = null;
      a.remove();
    }
    this.audios.clear();
    for (const m of this.meters.values()) m.src.disconnect();
    this.meters.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    void this.ctx?.close();
    this.ctx = null;
    this.onSpeaking?.(new Set());
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m));
  }

  /** Called with every table update: connect to new members, drop those who left. */
  sync(peerIds: string[]) {
    if (!this.stream) return;
    this.attach();
    const peer = this.getPeer();
    const me = peer?.id;
    if (!peer || !me) return;
    const want = new Set(peerIds.filter((p) => p !== me));
    for (const pid of want) {
      const existing = this.calls.get(pid);
      const stale = existing && !this.audios.has(pid) && Date.now() - (this.startedAt.get(pid) ?? 0) > 9000;
      if ((!existing || stale) && me < pid) {
        existing?.close();
        this.wire(peer.call(pid, this.stream));
      }
    }
    for (const pid of [...this.calls.keys()]) if (!want.has(pid)) this.drop(pid);
  }

  private attach() {
    const peer = this.getPeer();
    if (!peer || peer === this.attached) return;
    this.attached = peer;
    peer.on('call', (call) => {
      if (!this.stream) {
        call.close();
        return;
      }
      call.answer(this.stream);
      this.wire(call);
    });
  }

  private wire(call: MediaConnection) {
    const pid = call.peer;
    const old = this.calls.get(pid);
    if (old && old !== call) old.close();
    this.calls.set(pid, call);
    this.startedAt.set(pid, Date.now());
    call.on('stream', (s) => this.play(pid, s));
    const end = () => {
      if (this.calls.get(pid) === call) this.drop(pid);
    };
    call.on('close', end);
    call.on('error', end);
  }

  private play(pid: string, s: MediaStream) {
    let a = this.audios.get(pid);
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true;
      (a as any).playsInline = true;
      a.style.display = 'none';
      document.body.appendChild(a);
      this.audios.set(pid, a);
    }
    a.srcObject = s;
    void a.play().catch(() => {});
    this.meter(pid, s);
  }

  private drop(pid: string) {
    this.calls.get(pid)?.close();
    this.calls.delete(pid);
    const a = this.audios.get(pid);
    if (a) {
      a.pause();
      a.srcObject = null;
      a.remove();
    }
    this.audios.delete(pid);
    this.meters.get(pid)?.src.disconnect();
    this.meters.delete(pid);
  }

  private meter(key: string, s: MediaStream) {
    if (!this.ctx || s.getAudioTracks().length === 0) return;
    this.meters.get(key)?.src.disconnect();
    const src = this.ctx.createMediaStreamSource(s);
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an); // analysis only, not routed to the speakers
    this.meters.set(key, { an, src, buf: new Uint8Array(new ArrayBuffer(an.fftSize)) });
  }

  private measure() {
    const speaking = new Set<string>();
    for (const [key, m] of this.meters) {
      if (key === 'me' && this.muted) continue;
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0;
      for (let i = 0; i < m.buf.length; i++) {
        const v = (m.buf[i] - 128) / 128;
        sum += v * v;
      }
      if (Math.sqrt(sum / m.buf.length) > 0.045) speaking.add(key);
    }
    const sig = [...speaking].sort().join(',');
    if (sig !== this.lastSpeaking) {
      this.lastSpeaking = sig;
      this.onSpeaking?.(speaking);
    }
  }
}
