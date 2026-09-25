import { useEffect, useRef, useState } from 'react';
import { ClientMsg, ClientState } from '../net/protocol';
import { ConnStatus, Connection, GuestConnection, HostConnection, loadSnapshot } from '../net/connection';
import { Room } from '../net/room';
import { getPrefs } from '../lib/prefs';

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
    setStatus(conn.status);
    const offMsg = conn.onMessage((m) => {
      if (m.t === 'state') setState(m.state);
      else if (m.t === 'emote') {
        const ev = { id: ++emoteId.current, seat: m.seat, name: m.name, key: m.key };
        setEmotes((xs) => [...xs.slice(-6), ev]);
        setTimeout(() => setEmotes((xs) => xs.filter((x) => x.id !== ev.id)), 3200);
      } else if (m.t === 'error') {
        setError(m.msg);
        setTimeout(() => setError(null), 2600);
      }
    });
    const offStatus = conn.onStatus(setStatus);
    return () => {
      offMsg();
      offStatus();
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
  };
}
