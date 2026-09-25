import { useState } from 'react';
import { ClientMsg, ClientState, Settings } from '../net/protocol';
import { Mode, playersFor, hasTeams, teamOf } from '../engine/rules';
import { BotLevel } from '../bots/bots';
import { useT } from '../lib/i18n';
import { Segmented, Toggle } from './common';
import { relPos } from './Game';
import { unlockAudio } from '../lib/sound';
import { TileSvg } from './Tile';
import { VoiceApi } from './useSession';
import { VoicePanel } from './VoicePanel';

interface Props {
  st: ClientState;
  send: (m: ClientMsg) => void;
  onLeave: () => void;
  voice: VoiceApi;
}

export function Lobby({ st, send, onLeave, voice }: Props) {
  const t = useT();
  const isHost = st.you.isHost;
  const s = st.settings;
  const r = s.rules;
  const n = playersFor(r.mode);
  const teams = hasTeams(r.mode);
  const mySeat = st.you.seat;
  const [copied, setCopied] = useState(false);
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const link = `${location.origin}${location.pathname}#/m/${st.code}`;
  const set = (patch: Partial<Settings>) => send({ t: 'settings', settings: { ...s, ...patch } });
  const setRules = (patch: Partial<Settings['rules']>) => set({ rules: { ...r, ...patch } });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const share = async () => {
    const text = `${t.inviteMsg} ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Dominó', text: t.inviteMsg, url: link });
        return;
      } catch {
        /* fall back to WhatsApp */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const persp = mySeat ?? 0;
  const posOf = (seat: number) => relPos(seat, persp, n);

  return (
    <div className="lobby">
      <header className="lobby-head">
        <button className="icon-btn ghost-btn" onClick={onLeave} aria-label={t.leave}>
          ←
        </button>
        <div>
          <div className="eyebrow">{st.online ? t.table : t.soloTable}</div>
          {st.online && <div className="room-code">{st.code}</div>}
        </div>
        <span />
      </header>

      {st.online && (
        <section className="panel invite">
          <div className="panel-title">{t.shareLink}</div>
          <div className="invite-row">
            <code className="link">{link.replace(/^https?:\/\//, '')}</code>
          </div>
          <div className="invite-row">
            <button className="btn" onClick={copy}>
              {copied ? '✓ ' + t.copied : '🔗 ' + t.copy}
            </button>
            <button className="btn whatsapp" onClick={share}>
              💬 {t.whatsapp}
            </button>
          </div>
          {isHost && <p className="muted small">💡 {t.hostTip}</p>}
        </section>
      )}

      {voice.available && <VoicePanel st={st} voice={voice} />}

      <section className="panel seats-panel">
        <div className={`mini-table n${n}`}>
          <div className="mini-felt">
            <TileSvg className="felt-tile" top={6} bottom={6} />
          </div>
          {[...Array(n).keys()].map((i) => {
            const seat = st.seats[i];
            const mine = i === mySeat;
            const slot = teamOf(r.mode, i);
            return (
              <div
                key={i}
                className={`lobby-seat pos-${posOf(i)} ${teams ? (slot === 0 ? 'team-a' : 'team-b') : ''} ${mine ? 'mine' : ''} ${swapFrom === i ? 'swapping' : ''}`}
                onClick={() => {
                  if (swapFrom !== null && swapFrom !== i) {
                    send({ t: 'swap', a: swapFrom, b: i });
                    setSwapFrom(null);
                  }
                }}
              >
                {seat.kind === 'empty' ? (
                  <>
                    <div className="avatar empty">＋</div>
                    <div className="ls-name muted">{t.empty}</div>
                    <div className="ls-actions">
                      {mySeat !== i && (
                        <button className="chip" onClick={() => send({ t: 'sit', seat: i })}>
                          {t.sitHere}
                        </button>
                      )}
                      {isHost && (
                        <button className="chip" onClick={() => send({ t: 'setSeat', seat: i, kind: 'bot', level: 'medium' })}>
                          {t.addBot}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="avatar">
                      {seat.avatar}
                      {seat.kind === 'bot' && <span className="avatar-tag">🤖</span>}
                      {seat.kind === 'human' && !seat.connected && <span className="avatar-tag">📴</span>}
                    </div>
                    <div className="ls-name">
                      {seat.name}
                      {mine && <span className="tag">{t.you}</span>}
                      {seat.isHost && <span className="tag gold">👑</span>}
                    </div>
                    <div className="ls-actions">
                      {seat.kind === 'bot' &&
                        (isHost ? (
                          <>
                            <Segmented<BotLevel>
                              value={seat.level}
                              onChange={(level) => send({ t: 'setSeat', seat: i, kind: 'bot', level })}
                              options={[
                                { value: 'easy', label: t.easy },
                                { value: 'medium', label: t.medium },
                                { value: 'hard', label: t.hard },
                              ]}
                            />
                            <button className="chip ghost" onClick={() => send({ t: 'setSeat', seat: i, kind: 'empty' })} aria-label="remover">
                              ✕
                            </button>
                          </>
                        ) : (
                          <span className="muted small">{t[seat.level]}</span>
                        ))}
                      {seat.kind === 'bot' && !mine && !isHost && (
                        <button className="chip" onClick={() => send({ t: 'sit', seat: i })}>
                          {t.sitHere}
                        </button>
                      )}
                      {seat.kind === 'bot' && isHost && mySeat !== i && (
                        <button className="chip" onClick={() => send({ t: 'sit', seat: i })}>
                          {t.sitHere}
                        </button>
                      )}
                    </div>
                  </>
                )}
                {isHost && n === 4 && (
                  <button
                    className={`swap-btn ${swapFrom === i ? 'on' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSwapFrom(swapFrom === i ? null : i);
                    }}
                    aria-label="trocar de lugar"
                    title="⇄"
                  >
                    ⇄
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {st.spectators.length > 0 && (
          <p className="muted small center">
            👀 {t.watching}: {st.spectators.join(', ')}
          </p>
        )}
      </section>

      <section className="panel rules-panel">
        <div className="panel-title">{t.rules}</div>
        <div className="field">
          <label>{t.mode}</label>
          <Segmented<Mode>
            disabled={!isHost}
            value={r.mode}
            onChange={(mode) => setRules({ mode })}
            options={[
              { value: 'duplas', label: t.modeDuplas },
              { value: 'ffa4', label: t.modeFfa4 },
              { value: 'three', label: t.modeThree },
              { value: '1v1', label: t.mode1v1 },
            ]}
          />
        </div>
        <div className="field">
          <label>{t.scoringMode}</label>
          <Segmented<Settings['rules']['scoring']>
            disabled={!isHost}
            value={r.scoring ?? 'batida'}
            onChange={(scoring) => setRules({ scoring, targetScore: scoring === 'pips' ? 100 : 6 })}
            options={[
              { value: 'pips', label: t.scoringPips },
              { value: 'batida', label: t.scoringBatida },
            ]}
          />
          <span className="hint-text">{r.scoring === 'pips' ? t.scoringPipsHelp : t.scoringBatidaHelp}</span>
        </div>
        <div className="field">
          <label>{r.scoring === 'pips' ? t.limit : t.target}</label>
          <Segmented<number>
            disabled={!isHost}
            value={r.targetScore}
            onChange={(targetScore) => setRules({ targetScore })}
            options={(r.scoring === 'pips' ? [50, 100, 150, 200] : [3, 6, 10, 15]).map((x) => ({ value: x, label: String(x) }))}
          />
        </div>
        <div className="field">
          <label>{t.botSpeed}</label>
          <Segmented<Settings['botSpeed']>
            disabled={!isHost}
            value={s.botSpeed}
            onChange={(botSpeed) => set({ botSpeed })}
            options={[
              { value: 'slow', label: t.slow },
              { value: 'normal', label: t.normal },
              { value: 'fast', label: t.fast },
            ]}
          />
        </div>
        <button className="link-btn" onClick={() => setAdvanced((a) => !a)}>
          {advanced ? '▾' : '▸'} {t.blocked}, {t.scoring.toLowerCase()}…
        </button>
        {advanced && (
          <>
            <div className="field">
              <label>{t.blocked}</label>
              <Segmented<Settings['rules']['blockedResolution']>
                disabled={!isHost || !teams}
                value={teams ? r.blockedResolution : 'lowestPlayer'}
                onChange={(blockedResolution) => setRules({ blockedResolution })}
                options={[
                  { value: 'pairTotal', label: t.blockedPair },
                  { value: 'lowestPlayer', label: t.blockedLowest },
                ]}
              />
            </div>
            <Toggle disabled={!isHost} on={r.tieDoublesNext} onChange={(tieDoublesNext) => setRules({ tieDoublesNext })} label={t.tieDouble} />
            <div className="field">
              <label>{t.nextStarter}</label>
              <Segmented
                disabled={!isHost}
                value={r.nextStarter}
                onChange={(nextStarter) => setRules({ nextStarter })}
                options={[
                  { value: 'winner', label: t.starterWinner },
                  { value: 'rotate', label: t.starterRotate },
                ]}
              />
            </div>
            {r.scoring !== 'pips' && <div className="field">
              <label>{t.scoring}</label>
              <div className="points-grid">
                {(['simples', 'carroca', 'laELo', 'cruzada', 'blocked'] as const).map((k) => (
                  <label key={k} className="points-cell">
                    <span>{k === 'simples' ? t.simples : k === 'blocked' ? t.trancou.replace('!', '').toLowerCase() : (t as any)[k].replace('!', '')}</span>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      disabled={!isHost}
                      value={r.points[k]}
                      onChange={(e) => setRules({ points: { ...r.points, [k]: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } })}
                    />
                  </label>
                ))}
              </div>
            </div>}
            <Toggle disabled={!isHost} on={s.hints} onChange={(hints) => set({ hints })} label={t.hintsAllowed} />
          </>
        )}
      </section>

      <footer className="lobby-foot">
        {isHost ? (
          <>
            <button
              className="btn primary big"
              onClick={() => {
                unlockAudio();
                send({ t: 'start' });
              }}
            >
              ▶ {t.start}
            </button>
            <span className="muted small">{t.emptyBecomeBots}</span>
          </>
        ) : (
          <div className="waiting">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            {t.waitingHost}
          </div>
        )}
      </footer>
    </div>
  );
}
