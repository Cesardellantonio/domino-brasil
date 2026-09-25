import { useEffect, useRef, useState } from 'react';
import { ClientMsg, ClientState } from '../net/protocol';
import { ConnStatus, Connection, GuestConnection, HostConnection, loadSnapshot } from '../net/connection';
import { Room } from '../net/room';
import { getPrefs } from '../lib/prefs';
import { Voice } from '../net/voice';

export interface EmoteEvent {
  id: number;
  seat: number;
  name: string;
  key: string;
}

export interface Session {
  state: ClientState | null;
  status: ConnStatus;
  send: (m: ClientMsg) => void;
  emotes: EmoteEvent[];
  error: string | null;
  retry: () => void;
  conn: Connection | null;
  voice: VoiceApi;
}

export interface VoiceApi {
  available: boolean;
  joined: boolean;
  muted: boolean;
  busy: boolean;
  error: string | null;
  /** clientIds falando agora */
  speaking: Set<string>;
  join: () => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
}

export const SOLO_CODE = 'SOLO';

/** Open (or resume) a room: solo, hosting online, or joining someone else's. */
export function useSession(code: string): Session {
  const [state, setState] = useState<ClientState | null>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [emotes, setEmotes] = useState<EmoteEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connRef = useRef<Connection | null>(null);
  const emoteId = useRef(0);
  const voiceRef = useRef<Voice | null>(null);
  const stateRef = useRef<ClientState | null>(null);
  const [vState, setVState] = useState({ joined: false, muted: false, busy: false, error: null as string | null });
  const [speakingPeers, setSpeakingPeers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const p = getPrefs();
    const hello = { t: 'hello' as const, clientId: p.clientId, name: p.name, avatar: p.avatar };
    const snap = loadSnapshot(code);
    let conn: Connection;
    if (code === SOLO_CODE || (snap && snap.hostId === p.clientId)) {
      const online = code !== SOLO_CODE;
      const room = new Room(code, p.clientId, online, snap && snap.hostId === p.clientId ? snap : undefined);
      conn = new HostConnection(room, p.clientId);
      room.handle(p.clientId, hello);
      if (!snap || snap.hostId !== p.clientId) {
        room.handle(p.clientId, { t: 'sit', seat: 0 });
        if (!online) {
          room.handle(p.clientId, { t: 'setSeat', seat: 1, kind: 'bot', level: 'medium' });
          room.handle(p.clientId, { t: 'setSeat', seat: 2, kind: 'bot', level: 'hard' });
          room.handle(p.clientId, { t: 'setSeat', seat: 3, kind: 'bot', level: 'medium' });
        }
      }
    } else {
      conn = new GuestConnection(code, hello);
    }
    connRef.current = conn;
    const voice = new Voice(() => conn.getPeer());
    voice.onSpeaking = setSpeakingPeers;
    voiceRef.current = voice;
    const announce = () => {
      const pid = voice.myId;
      if (voice.active && pid) conn.send({ t: 'voice', on: true, muted: voice.muted, peerId: pid });
    };
    setStatus(conn.status);
    const offMsg = conn.onMessage((m) => {
      if (m.t === 'state') {
        stateRef.current = m.state;
        setState(m.state);
        if (voice.active) {
          const mine = m.state.voice.find((v) => v.clientId === p.clientId);
          if (!mine || mine.peerId !== voice.myId) announce(); // reconnected with a new peer
          voice.sync(m.state.voice.map((v) => v.peerId));
        }
      }
      else if (m.t === 'emote') {
        const ev = { id: ++emoteId.current, seat: m.seat, name: m.name, key: m.key };
        setEmotes((xs) => [...xs.slice(-6), ev]);
        setTimeout(() => setEmotes((xs) => xs.filter((x) => x.id !== ev.id)), 3200);
      } else if (m.t === 'error') {
        setError(m.msg);
        setTimeout(() => setError(null), 2600);
      }
    });
    const offStatus = conn.onStatus((st) => {
      setStatus(st);
      if (st === 'open') announce();
    });
    return () => {
      offMsg();
      offStatus();
      voice.leave();
      conn.close();
      connRef.current = null;
    };
  }, [code]);

  return {
    state,
    status,
    emotes,
    error,
    conn: connRef.current,
    send: (m) => connRef.current?.send(m),
    retry: () => (connRef.current as GuestConnection | null)?.retryNow?.(),
    voice: {
      available: !!state?.online && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
      ...vState,
      speaking: new Set(
        [...speakingPeers]
          .map((pid) => (pid === 'me' ? getPrefs().clientId : state?.voice.find((v) => v.peerId === pid)?.clientId))
          .filter((x): x is string => !!x),
      ),
      join: async () => {
        const v = voiceRef.current;
        const conn = connRef.current;
        if (!v || !conn || v.active) return;
        if (!conn.getPeer()) {
          setVState((s) => ({ ...s, error: 'Conexão ainda não está pronta. Tente de novo em instantes.' }));
          return;
        }
        setVState((s) => ({ ...s, busy: true, error: null }));
        try {
          await v.join();
          conn.send({ t: 'voice', on: true, muted: false, peerId: v.myId! });
          setVState({ joined: true, muted: false, busy: false, error: null });
        } catch (e: any) {
          const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
          setVState({ joined: false, muted: false, busy: false, error: denied ? 'Permita o uso do microfone no navegador para entrar na chamada.' : 'Não foi possível acessar o microfone.' });
        }
      },
      leave: () => {
        voiceRef.current?.leave();
        connRef.current?.send({ t: 'voice', on: false, muted: false, peerId: '' });
        setVState({ joined: false, muted: false, busy: false, error: null });
      },
      toggleMute: () => {
        const v = voiceRef.current;
        if (!v?.active) return;
        v.setMuted(!v.muted);
        connRef.current?.send({ t: 'voice', on: true, muted: v.muted, peerId: v.myId ?? '' });
        setVState((s) => ({ ...s, muted: v.muted }));
      },
    },
  };
}
