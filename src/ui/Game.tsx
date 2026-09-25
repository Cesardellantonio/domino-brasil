import { useEffect, useMemo, useRef, useState } from 'react';
import { ClientMsg, ClientState, SeatPublic } from '../net/protocol';
import { isBuchuda, Move, Placed, tilesOnTable } from '../engine/game';
import { ALL_TILES, pipsOf, otherSide } from '../engine/tiles';
import { hasTeams, teamOf } from '../engine/rules';
import { PlayerView } from '../engine/view';
import { chooseMove } from '../bots/bots';
import { buildKnowledge } from '../bots/knowledge';
import { mulberry32, secureSeed } from '../lib/rng';
import { useT, emoteText, EMOTE_KEYS, EMOJI_KEYS } from '../lib/i18n';
import { usePrefs, setPrefs } from '../lib/prefs';
import { sfx, vibrate, unlockAudio, syncAmbience } from '../lib/sound';
import { countBatidas, recordMatch } from '../lib/history';
import { Board, Ghost } from './Board';
import { TileSvg } from './Tile';
import { EmoteEvent, VoiceApi } from './useSession';
import { Confetti } from './common';

type Pos = 'bottom' | 'right' | 'top' | 'left';

export function relPos(seat: number, me: number, n: number): Pos {
  const r = (seat - me + n) % n;
  if (n === 4) return (['bottom', 'right', 'top', 'left'] as Pos[])[r];
  if (n === 3) return (['bottom', 'right', 'left'] as Pos[])[r];
  return (['bottom', 'top'] as Pos[])[r];
}

const ENTER_FROM: Record<Pos, [number, number]> = { bottom: [0, 320], top: [0, -320], left: [-340, 0], right: [340, 0] };

interface Props {
  st: ClientState;
  send: (m: ClientMsg) => void;
  emotes: EmoteEvent[];
  onMenu: () => void;
  voice: VoiceApi;
}

export function Game({ st, send, emotes, onMenu, voice }: Props) {
  const t = useT();
  const prefs = usePrefs();
  const v = st.view!;
  const n = v.n;
  const mySeat = st.you.seat;
  const persp = mySeat ?? 0;
  const mode = v.rules.mode;
  const teams = hasTeams(mode);
  const mySlot = teamOf(mode, persp);

  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<Move | null>(null);
  const [enter, setEnter] = useState<{ id: number; dx: number; dy: number } | null>(null);
  const [bubbles, setBubbles] = useState<Record<number, number>>({});
  const [banner, setBanner] = useState<{ text: string; kind: string; key: number } | null>(null);
  const [shake, setShake] = useState(false);
  const [dealKey, setDealKey] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const prev = useRef({ matchNo: st.matchNo, handNo: v.handNo, logLen: v.log.length, result: !!v.result, mounted: false });

  const myTurn = mySeat !== null && v.turn === mySeat && !v.result && st.phase === 'playing';
  const plays = useMemo(() => (myTurn ? v.legal.filter((m): m is Move & { t: 'play' } => m.t === 'play') : []), [myTurn, v.legal]);
  const playableIds = useMemo(() => new Set(plays.map((m) => m.id)), [plays]);

  // ---------------------------------------------------------------- react to game events
  useEffect(() => {
    const p = prev.current;
    const newHand = p.matchNo !== st.matchNo || p.handNo !== v.handNo;
    if (newHand) {
      setDealKey((k) => k + 1);
      setSelected(null);
      setHint(null);
      setShowResult(false);
      setEnter(null);
      sfx.shuffle();
    } else if (v.log.length > p.logLen) {
      const e = v.log[v.log.length - 1];
      if (e.t === 'play') {
        const pos = relPos(e.seat, persp, n);
        const [dx, dy] = ENTER_FROM[pos];
        setEnter({ id: e.id, dx, dy });
        if (!v.result) setTimeout(() => sfx.clack(), 230);
      } else if (e.t === 'pass') {
        setBubbles((b) => ({ ...b, [e.seat]: Date.now() }));
        setTimeout(() => setBubbles((b) => ({ ...b, [e.seat]: 0 })), 1900);
        sfx.pass();
      } else if (e.t === 'draw') {
        sfx.pick();
      }
      setSelected(null);
      setHint(null);
    }
    if (v.result && !p.result && !newHand) {
      const r = v.result;
      const text =
        r.kind === 'tie' ? t.empate : r.kind === 'blocked' ? t.trancou : r.kind === 'simples' ? t.bateu : (t as any)[r.kind];
      setTimeout(() => {
        setBanner({ text, kind: r.kind, key: Date.now() });
        if (r.kind === 'blocked' || r.kind === 'tie') sfx.pass();
        else {
          sfx.slam();
          vibrate([40, 30, 80]);
          setShake(true);
          setTimeout(() => setShake(false), 450);
        }
      }, 230);
      setTimeout(() => setBanner(null), 2300);
      setTimeout(() => setShowResult(true), 2000);
    }
    if (v.result && p.mounted === false) setShowResult(true);
    if (myTurn && (newHand || v.log.length !== p.logLen || !p.mounted) && plays.length) {
      setTimeout(() => {
        sfx.turn();
        vibrate(25);
      }, 350);
    }
    setPending(false);
    prev.current = { matchNo: st.matchNo, handNo: v.handNo, logLen: v.log.length, result: !!v.result, mounted: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.matchNo, v.handNo, v.log.length, !!v.result]);

  useEffect(() => {
    syncAmbience(true);
    return () => syncAmbience(false);
  }, []);

  // Match over: fanfare + record.
  const recorded = useRef(0);
  useEffect(() => {
    if (st.phase !== 'matchOver' || v.winner === null || recorded.current === st.matchNo) return;
    recorded.current = st.matchNo;
    const won = mySeat !== null && v.winner === mySlot;
    setTimeout(() => (won ? sfx.fanfare(true) : mySeat !== null ? sfx.sad() : sfx.fanfare()), 2300);
    if (mySeat !== null)
      recordMatch({
        id: `${st.code}:${st.matchNo}:${v.history.length}:${v.scores.join('-')}`,
        at: Date.now(),
        mode,
        players: st.seats.slice(0, n).map((s, i) => ({ name: s.name, avatar: s.avatar, bot: s.kind === 'bot', slot: teamOf(mode, i) })),
        mySlot,
        myName: prefs.name,
        winnerSlot: v.winner,
        scores: v.scores,
        myBatidas: countBatidas(v.history, mySeat),
      });
  }, [st.phase, st.matchNo]);

  // ---------------------------------------------------------------- actions
  const doMove = (m: Move) => {
    if (pending) return;
    unlockAudio();
    setPending(true);
    setSelected(null);
    setHint(null);
    send({ t: 'move', move: m, handNo: v.handNo });
    setTimeout(() => setPending(false), 2500);
  };

  const onTile = (id: number) => {
    unlockAudio();
    if (!myTurn || !playableIds.has(id)) {
      sfx.pick();
      setSelected((s) => (s === id ? null : id));
      return;
    }
    const opts = plays.filter((m) => m.id === id);
    const sameEnds = v.ends && v.ends[0] === v.ends[1];
    if (opts.length === 1 || sameEnds) return doMove(opts[0]);
    if (selected === id) {
      setSelected(null);
      return;
    }
    sfx.pick();
    setSelected(id);
  };

  const askHint = () => {
    if (!myTurn || !plays.length) return;
    const m = chooseMove(v, 'hard', mulberry32(secureSeed()), 350);
    setHint(m);
    if (m.t === 'play') setSelected(m.id);
  };

  // Ghost targets on the board for the selected tile.
  const ghosts: Ghost[] = useMemo(() => {
    if (!myTurn || selected === null || !playableIds.has(selected)) return [];
    return plays
      .filter((m) => m.id === selected)
      .map((m) => {
        const placed: Placed = v.ends
          ? (() => {
              const end = m.side === 'L' ? v.ends[0] : v.ends[1];
              return { id: m.id, inner: end, outer: otherSide(m.id, end), seat: mySeat! };
            })()
          : { id: m.id, inner: ALL_TILES[m.id].a, outer: ALL_TILES[m.id].b, seat: mySeat! };
        return { side: m.side, placed, hint: hint?.t === 'play' && hint.id === m.id && hint.side === m.side };
      });
  }, [myTurn, selected, plays, v.ends, hint]);

  const lastPlay = [...v.log].reverse().find((e) => e.t === 'play');
  const lastId = lastPlay && lastPlay.t === 'play' ? lastPlay.id : null;

  // ---------------------------------------------------------------- seats
  const voids = useMemo(() => (prefs.memoryAid ? buildKnowledge({ ...v, seat: persp }).voids : []), [v.log.length, prefs.memoryAid]);
  const others = [...Array(n).keys()].filter((s) => s !== persp);
  const pad = useMemo(() => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
    const side = n === 2 ? 8 : narrow ? 94 : 150;
    return { top: narrow ? 70 : 100, bottom: 8, left: side, right: side };
  }, [n]);

  const slotName = (slot: number) => {
    if (teams) {
      if (mySeat === null) return slot === 0 ? t.teamA : t.teamB;
      return slot === mySlot ? t.us : t.them;
    }
    return st.seats[slot]?.name ?? '';
  };

  const turnSeat = st.seats[v.turn];
  const status = (() => {
    if (st.phase !== 'playing' || v.result) return '';
    if (myTurn) {
      if (!v.ends && v.mustPlay !== null && v.handNo === 0) return t.mustStart;
      if (!plays.length) return v.boneyard > 0 ? t.drawing : t.youPassed;
      return selected !== null && ghosts.length > 1 ? t.chooseEnd : t.yourTurn;
    }
    return `${t.turnOf} ${turnSeat?.name ?? ''}`;
  })();

  const theme = `theme-${prefs.theme}`;
  const [chatText, setChatText] = useState('');
  const sendChat = () => {
    const text = chatText.trim();
    if (!text) return;
    send({ t: 'emote', key: text.slice(0, 80) });
    setChatText('');
    setEmoteOpen(false);
  };
  const voiceOf = (seat: number) => st.voice.find((x) => x.seat === seat);
  const myPips = v.myHand.reduce((a, id) => a + pipsOf(id), 0);

  return (
    <div className={`game ${theme} ${shake ? 'shake' : ''}`} onPointerDown={() => emoteOpen && setEmoteOpen(false)}>
      <TopBar st={st} v={v} slotName={slotName} mySlot={mySlot} onMenu={onMenu} />

      <div className="table" onPointerDown={() => selected !== null && setSelected(null)}>
        <div className="felt-texture" />
        <Board
          root={v.root}
          left={v.left}
          right={v.right}
          ghosts={ghosts}
          onGhost={(side) => {
            const m = plays.find((p) => p.id === selected && p.side === side);
            if (m) doMove(m);
          }}
          enter={enter}
          lastId={lastId}
          colored={prefs.coloredPips}
          pad={pad}
        />
        {!v.root && st.phase === 'playing' && (
          <div className="table-center-note">
            {v.mustPlay !== null && v.handNo === 0 ? (
              <>
                <TileSvg className="mini-tile" top={ALL_TILES[v.mustPlay].a} bottom={ALL_TILES[v.mustPlay].b} colored={prefs.coloredPips} />
                <span>
                  {t.startWith} {ALL_TILES[v.mustPlay].a}-{ALL_TILES[v.mustPlay].b}
                </span>
              </>
            ) : (
              <span>
                {t.turnOf} {turnSeat?.name}
              </span>
            )}
          </div>
        )}
        {others.map((s) => (
          <SeatBadge
            key={s}
            seat={s}
            pos={relPos(s, persp, n)}
            info={st.seats[s]}
            count={v.counts[s]}
            turn={v.turn === s && !v.result && st.phase === 'playing'}
            ally={teams && teamOf(mode, s) === mySlot && mySeat !== null}
            teams={teams}
            passed={!!bubbles[s]}
            voids={voids[s] ?? 0}
            emote={emotes.filter((e) => e.seat === s).slice(-1)[0]}
            t={t}
            inCall={!!voiceOf(s)}
            muted={!!voiceOf(s)?.muted}
            talking={!!st.seats[s]?.clientId && voice.speaking.has(st.seats[s].clientId!)}
          />
        ))}
        {v.boneyard > 0 && (
          <div className="boneyard" title={t.boneyard}>
            <TileSvg className="mini-back" top={0} bottom={0} back />
            <span>{v.boneyard}</span>
          </div>
        )}
        {banner && (
          <div key={banner.key} className={`banner banner-${banner.kind}`}>
            {banner.text}
          </div>
        )}
      </div>

      <div className={`me-area ${myTurn ? 'my-turn' : ''}`}>
        <div className="me-bar">
          {mySeat !== null ? (
            <div className={`me-id ${teams ? 'ally' : ''} ${voice.speaking.has(st.you.clientId) ? 'talking' : ''}`}>
              <span className="avatar sm">{st.seats[mySeat]?.avatar}</span>
              <span className="my-count">
                <b>{v.myHand.length}</b> {v.myHand.length === 1 ? t.tile : t.tiles}
                <small>
                  {myPips} {t.pts}
                </small>
              </span>
              {emotes.filter((e) => e.seat === mySeat).slice(-1).map((e) => (
                <span key={e.id} className="bubble me-bubble">
                  {emoteText(e.key)}
                </span>
              ))}
              {bubbles[mySeat] ? <span className="bubble pass me-bubble">{t.passed}</span> : null}
            </div>
          ) : (
            <div className="me-id">👀 {t.watching}</div>
          )}
          <div className={`status ${myTurn ? 'go' : ''}`}>
            <span>{status}</span>
            {v.ends && st.phase === 'playing' && !v.result && (
              <span className="ends">
                <EndChip n={v.ends[0]} />
                <EndChip n={v.ends[1]} />
              </span>
            )}
          </div>
          <div className="me-actions">
            {voice.available && (
              <button
                className={`icon-btn mic ${voice.joined ? (voice.muted ? 'muted' : 'live') : ''} ${voice.speaking.has(st.you.clientId) ? 'talking' : ''}`}
                disabled={voice.busy}
                onClick={() => (voice.joined ? voice.toggleMute() : void voice.join())}
                title={voice.joined ? (voice.muted ? t.unmute : t.mute) : t.joinCall}
                aria-label={voice.joined ? (voice.muted ? t.unmute : t.mute) : t.joinCall}
              >
                {voice.busy ? '…' : voice.joined ? (voice.muted ? '🔇' : '🎙️') : '📞'}
              </button>
            )}
            {st.settings.hints && mySeat !== null && (
              <button className="icon-btn" disabled={!myTurn || !plays.length} onClick={askHint} title={t.hint} aria-label={t.hint}>
                💡
              </button>
            )}
            {mySeat !== null && (
              <div className="emote-wrap" onPointerDown={(e) => e.stopPropagation()}>
                <button className="icon-btn" onClick={() => setEmoteOpen((o) => !o)} aria-label={t.chat}>
                  💬
                </button>
                {emoteOpen && (
                  <div className="emote-pop">
                    <form
                      className="chat-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        sendChat();
                      }}
                    >
                      <input value={chatText} maxLength={80} placeholder={t.chatPh} onChange={(e) => setChatText(e.target.value)} />
                      <button type="submit" className="btn primary" disabled={!chatText.trim()}>
                        ➤
                      </button>
                    </form>
                    <div className="emote-phrases">
                      {EMOTE_KEYS.map((k) => (
                        <button
                          key={k}
                          onClick={() => {
                            send({ t: 'emote', key: k });
                            setEmoteOpen(false);
                          }}
                        >
                          {emoteText(k)}
                        </button>
                      ))}
                    </div>
                    <div className="emote-emojis">
                      {EMOJI_KEYS.map((k) => (
                        <button
                          key={k}
                          onClick={() => {
                            send({ t: 'emote', key: k });
                            setEmoteOpen(false);
                          }}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {mySeat !== null && (
          <div className="hand" key={dealKey}>
            {v.myHand.map((id, i) => {
              const playable = playableIds.has(id);
              const cls = ['hand-tile', myTurn ? (playable ? 'playable' : 'dim') : '', selected === id ? 'selected' : '', hint?.t === 'play' && hint.id === id ? 'hinted' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <button key={id} className={cls} style={{ '--i': i } as React.CSSProperties} onClick={() => onTile(id)} aria-label={`${ALL_TILES[id].a}-${ALL_TILES[id].b}`}>
                  <TileSvg top={ALL_TILES[id].a} bottom={ALL_TILES[id].b} colored={prefs.coloredPips} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showResult && (st.phase === 'handOver' || st.phase === 'matchOver') && v.result && (
        <ResultCard st={st} v={v} send={send} slotName={slotName} mySlot={mySlot} />
      )}
      {showResult && st.phase === 'matchOver' && v.winner === mySlot && mySeat !== null && <Confetti />}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function EndChip({ n }: { n: number }) {
  return (
    <span className="end-chip">
      <svg viewBox="-50 -50 100 100">
        <rect x={-46} y={-46} width={92} height={92} rx={14} fill="url(#tileFace)" stroke="#a89c80" strokeWidth={4} />
        {PIPS_SQ[n].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={10} fill="#161616" />
        ))}
      </svg>
    </span>
  );
}
const S = 24;
const PIPS_SQ: [number, number][][] = [
  [],
  [[0, 0]],
  [[-S, -S], [S, S]],
  [[-S, -S], [0, 0], [S, S]],
  [[-S, -S], [S, -S], [-S, S], [S, S]],
  [[-S, -S], [S, -S], [0, 0], [-S, S], [S, S]],
  [[-S, -S], [-S, 0], [-S, S], [S, -S], [S, 0], [S, S]],
];

function ScoreBar({ score, target }: { score: number; target: number }) {
  return (
    <span className="score-bar" aria-label={`${score}/${target}`}>
      <i style={{ width: `${Math.min(1, score / target) * 44}px` }} />
      <small>/{target}</small>
    </span>
  );
}

function ScorePips({ score, target }: { score: number; target: number }) {
  if (target > 12) return <b className="score-num">{score}</b>;
  return (
    <span className="score-pips" aria-label={`${score}/${target}`}>
      {Array.from({ length: target }, (_, i) => (
        <i key={i} className={i < score ? 'on' : ''} />
      ))}
    </span>
  );
}

function TopBar({ st, v, slotName, mySlot, onMenu }: { st: ClientState; v: PlayerView; slotName: (s: number) => string; mySlot: number; onMenu: () => void }) {
  const t = useT();
  const prefs = usePrefs();
  const target = v.rules.targetScore;
  const teams = hasTeams(v.rules.mode);
  return (
    <div className="topbar">
      <button className="icon-btn ghost-btn" onClick={onMenu} aria-label={t.menu}>
        ☰
      </button>
      <div className="scores">
        {teams ? (
          [mySlot, 1 - mySlot].map((slot) => (
            <div key={slot} className={`score ${slot === mySlot && st.you.seat !== null ? 'ally' : 'rival'}`}>
              <span className="score-name">{slotName(slot)}</span>
              <span className="score-val">{v.scores[slot]}</span>
              {v.rules.scoring === 'pips' ? <ScoreBar score={v.scores[slot]} target={target} /> : <ScorePips score={v.scores[slot]} target={target} />}
            </div>
          ))
        ) : (
          v.scores.map((sc, slot) => (
            <div key={slot} className={`score ${slot === mySlot && st.you.seat !== null ? 'ally' : 'rival'}`}>
              <span className="score-name">
                {st.seats[slot]?.avatar} {st.seats[slot]?.name}
              </span>
              <span className="score-val">{sc}</span>
            </div>
          ))
        )}
      </div>
      <div className="hand-info">
        <span>
          {t.hand} {v.handNo + 1}
        </span>
        {v.multiplier > 1 && <span className="mult">×{v.multiplier}</span>}
        {st.voice.length > 0 && (
          <span className="call-pill" title={st.voice.map((x) => x.name).join(', ')}>
            📞 {st.voice.length}
          </span>
        )}
        <button
          className="icon-btn ghost-btn sm"
          onClick={() => {
            setPrefs({ sound: !prefs.sound });
            syncAmbience();
          }}
          aria-label={t.sound}
        >
          {prefs.sound ? '🔊' : '🔇'}
        </button>
      </div>
    </div>
  );
}

function SeatBadge(props: {
  seat: number;
  pos: Pos;
  info: SeatPublic;
  count: number;
  turn: boolean;
  ally: boolean;
  teams: boolean;
  passed: boolean;
  voids: number;
  emote?: EmoteEvent;
  t: ReturnType<typeof useT>;
  inCall: boolean;
  muted: boolean;
  talking: boolean;
}) {
  const { pos, info, count, turn, ally, teams, passed, voids, emote, t, inCall, muted, talking } = props;
  const voidNums = [0, 1, 2, 3, 4, 5, 6].filter((x) => voids & (1 << x));
  const away = info.kind === 'human' && !info.connected;
  return (
    <div className={`seat seat-${pos} ${turn ? 'turn' : ''} ${teams ? (ally ? 'ally' : 'rival') : 'rival'} ${talking ? 'talking' : ''}`}>
      <div className="seat-top-row">
        <div className="avatar">
          {info.avatar || '🙂'}
          {info.kind === 'bot' && <span className="avatar-tag">🤖</span>}
          {away && <span className="avatar-tag">📴</span>}
          {inCall && <span className="avatar-tag call">{muted ? '🔇' : talking ? '🗣️' : '🎧'}</span>}
        </div>
        <div className="seat-info">
          <div className="seat-name">{info.name}</div>
          {info.covered && <div className="seat-flag">🤖 {t.botPlaying}</div>}
          {!info.covered && away && <div className="seat-flag">{t.away}</div>}
        </div>
      </div>
      <div className="seat-tiles" aria-label={`${count} ${t.tiles}`} title={`${count} ${count === 1 ? t.tile : t.tiles}`}>
        <span className="fan">
          {Array.from({ length: Math.min(count, 12) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className={`count-badge ${count <= 2 ? 'low' : ''}`}>
          <b>{count}</b>
          <small>{count === 1 ? t.tile : t.tiles}</small>
        </span>
      </div>
      {voidNums.length > 0 && (
        <div className="voids" title={t.lacks}>
          {t.lacks} {voidNums.map((x) => <span key={x}>{x}</span>)}
        </div>
      )}
      {passed && <div className="bubble pass">{t.passed}</div>}
      {emote && !passed && (
        <div key={emote.id} className="bubble">
          {emoteText(emote.key)}
        </div>
      )}
    </div>
  );
}

function ResultCard({ st, v, send, slotName, mySlot }: { st: ClientState; v: PlayerView; send: (m: ClientMsg) => void; slotName: (s: number) => string; mySlot: number }) {
  const t = useT();
  const prefs = usePrefs();
  const r = v.result!;
  const n = v.n;
  const mySeat = st.you.seat;
  const matchOver = st.phase === 'matchOver';
  const teams = hasTeams(v.rules.mode);
  const [left, setLeft] = useState<number | null>(null);
  const deadline = useRef<number | null>(st.autoNextIn !== null ? Date.now() + st.autoNextIn : null);
  useEffect(() => {
    if (deadline.current === null) return;
    const id = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline.current! - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, []);

  const winner = r.winnerSeat >= 0 ? st.seats[r.winnerSeat] : null;
  const won = mySeat !== null && r.winnerSlot === mySlot;
  const iAmReady = mySeat !== null && st.ready[mySeat];
  const onTable = tilesOnTable(v as any).length;
  const buchuda = matchOver && isBuchuda(v);
  const pipsMode = v.rules.scoring === 'pips';
  const added = r.added ?? [];

  const title = matchOver
    ? mySeat === null
      ? `${slotName(v.winner!)} ${teams ? t.winsPl : t.wins}`
      : v.winner === mySlot
        ? teams
          ? t.youWon
          : t.youWonSolo
        : t.youLost
    : r.kind === 'tie'
      ? t.empate
      : `${winner?.avatar ?? ''} ${winner?.name ?? ''} ${t.withKind[r.kind]}`;

  return (
    <div className="overlay">
      <div className={`card result-card ${matchOver ? 'match-over' : ''} ${won ? 'won' : ''}`}>
        {buchuda && <div className="buchuda">{t.buchuda}</div>}
        <h2>{title}</h2>
        {matchOver && (
          <p className="sub">
            {t.finalScore}: {teams ? `${slotName(mySlot)} ${v.scores[mySlot]} × ${v.scores[1 - mySlot]} ${slotName(1 - mySlot)}` : v.scores.join(' × ')}
          </p>
        )}
        {!matchOver && r.kind !== 'tie' && !pipsMode && (
          <p className="sub points-line">
            <b>+{r.points}</b> {r.points === 1 ? t.point : t.points} {t.forTeam} <b>{slotName(r.winnerSlot)}</b>
            {r.kind === 'blocked' && ' · ' + t.trancou}
          </p>
        )}
        {!matchOver && r.kind !== 'tie' && pipsMode && (
          <p className="sub points-line penalty">
            {r.kind === 'blocked' && <span className="sub-note">{t.trancou}</span>}
            {added.map((pts, slot) =>
              pts > 0 ? (
                <span key={slot} className="penalty-line">
                  <span className="pen-who">{slotName(slot)}</span>: <b className="pen">+{pts}</b> {pts === 1 ? t.point : t.points}
                </span>
              ) : null,
            )}
          </p>
        )}
        {!matchOver && pipsMode && (
          <div className="race">
            {(teams ? [mySlot, 1 - mySlot] : v.scores.map((_, i) => i)).map((slot) => (
              <div key={slot} className={`race-row ${teams ? (slot === mySlot && mySeat !== null ? 'ally' : 'rival') : ''}`}>
                <span className="race-name">{slotName(slot)}</span>
                <span className="race-track">
                  <i style={{ width: `${Math.min(100, (v.scores[slot] / v.rules.targetScore) * 100)}%` }} />
                </span>
                <span className="race-val">
                  {v.scores[slot]}
                  <small>/{v.rules.targetScore}</small>
                </span>
              </div>
            ))}
            <p className="muted small center">{t.raceRule.replace('{n}', String(v.rules.targetScore))}</p>
          </div>
        )}
        {r.kind === 'tie' && (
          <p className="sub">
            {t.tieMsg} {v.rules.tieDoublesNext && <b>{t.nextDouble}</b>}
          </p>
        )}
        <div className="reveal">
          {[...Array(n).keys()].map((s) => (
            <div key={s} className={`reveal-row ${r.winnerSeat === s ? 'winner' : ''} ${teams ? (teamOf(v.rules.mode, s) === mySlot ? 'ally' : 'rival') : ''}`}>
              <span className="reveal-who">
                <span className="avatar xs">{st.seats[s]?.avatar}</span>
                <span className="reveal-name">{st.seats[s]?.name}</span>
              </span>
              <span className="reveal-tiles">
                {r.hands[s]?.length ? (
                  r.hands[s].map((id, i) => (
                    <span key={id} className="reveal-tile" style={{ '--i': i + s * 2 } as React.CSSProperties}>
                      <TileSvg top={ALL_TILES[id].a} bottom={ALL_TILES[id].b} colored={prefs.coloredPips} />
                    </span>
                  ))
                ) : (
                  <span className="went-out">🏁</span>
                )}
              </span>
              <span className={`reveal-pips ${pipsMode && teamOf(v.rules.mode, s) !== r.winnerSlot && r.kind !== 'tie' ? 'pen' : ''}`}>
                {pipsMode && teamOf(v.rules.mode, s) !== r.winnerSlot && r.kind !== 'tie' ? '+' : ''}
                {r.hands[s]?.reduce((a, id) => a + pipsOf(id), 0) ?? 0}
              </span>
            </div>
          ))}
        </div>
        <div className="result-foot">
          <span className="muted">
            {onTable} {t.tiles}
          </span>
          {!matchOver && mySeat !== null && (
            <button className="btn primary" disabled={iAmReady} onClick={() => send({ t: 'ready' })}>
              {iAmReady ? '✓' : t.continue} {left !== null ? `(${left})` : ''}
            </button>
          )}
          {!matchOver && mySeat === null && left !== null && <span className="muted">{left}s</span>}
          {matchOver && (mySeat !== null || st.you.isHost) && (
            <button className="btn primary" onClick={() => send({ t: 'rematch' })}>
              🔁 {t.rematch}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

