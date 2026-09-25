import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room } from '../src/net/room';
import { ClientState, HostMsg } from '../src/net/protocol';

function client(room: Room, id: string, name: string) {
  const inbox: HostMsg[] = [];
  room.connect(id, (m) => inbox.push(m));
  room.handle(id, { t: 'hello', clientId: id, name, avatar: '🙂' });
  return {
    inbox,
    last: (): ClientState => [...inbox].reverse().find((m) => m.t === 'state')!.state as ClientState,
    send: (m: any) => room.handle(id, m),
  };
}

describe('Room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seats guests automatically as partner, enforces host permissions', () => {
    const room = new Room('ABCDE', 'host', true);
    const host = client(room, 'host', 'César');
    host.send({ t: 'sit', seat: 0 });
    const dad = client(room, 'dad', 'Pai');
    expect(dad.last().you.seat).toBe(2); // partner seat by default
    dad.send({ t: 'start' });
    expect(dad.inbox.some((m) => m.t === 'error')).toBe(true);
    expect(room.phase).toBe('lobby');
    dad.send({ t: 'sit', seat: 1 }); // dad chooses to play against me
    expect(dad.last().you.seat).toBe(1);
    host.send({ t: 'start' });
    expect(room.phase).toBe('playing');
    expect(room.seats[2].kind).toBe('bot');
    expect(room.seats[3].kind).toBe('bot');
  });

  it('never leaks other hands and plays a whole match with bots', () => {
    const room = new Room('SOLO', 'me', false);
    const me = client(room, 'me', 'Eu');
    me.send({ t: 'sit', seat: 0 });
    for (const s of [1, 2, 3]) me.send({ t: 'setSeat', seat: s, kind: 'bot', level: s === 2 ? 'hard' : 'medium' });
    me.send({ t: 'settings', settings: { ...room.settings, botSpeed: 'fast' } });
    me.send({ t: 'start' });
    let guard = 0;
    while (room.phase !== 'matchOver' && guard++ < 5000) {
      const st = me.last();
      const v = st.view!;
      if (st.phase === 'playing' && v.turn === 0) {
        // Only my own hand is visible.
        expect(JSON.stringify({ ...v, history: [], result: null }).includes('"hands"')).toBe(false);
        const play = v.legal.find((m) => m.t === 'play');
        if (play) me.send({ t: 'move', move: play, handNo: v.handNo });
      }
      if (st.phase === 'handOver') me.send({ t: 'ready' });
      vi.advanceTimersByTime(700);
    }
    expect(room.phase).toBe('matchOver');
    expect(Math.max(...room.match!.scores)).toBeGreaterThanOrEqual(6);
  });

  it('a disconnected human is covered by a bot after the grace period', () => {
    const room = new Room('ABCDE', 'host', true);
    const host = client(room, 'host', 'César');
    host.send({ t: 'sit', seat: 0 });
    client(room, 'dad', 'Pai');
    host.send({ t: 'start' });
    room.disconnect('dad');
    vi.advanceTimersByTime(45_000);
    expect(host.last().seats[2].covered).toBe(true);
    room.connect('dad', () => {});
    room.handle('dad', { t: 'hello', clientId: 'dad', name: 'Pai', avatar: '🙂' });
    expect(host.last().seats[2].covered).toBe(false);
  });
});
