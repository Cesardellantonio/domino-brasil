import { useState } from 'react';
import { useT } from '../lib/i18n';
import { AVATARS, setPrefs, usePrefs } from '../lib/prefs';
import { Logo } from './common';
import { loadSnapshot, createOnlineRoom, clearSnapshot } from '../net/connection';
import { newRoomCode } from '../net/room';
import { SOLO_CODE } from './useSession';
import { unlockAudio } from '../lib/sound';

interface Props {
  go: (hash: string) => void;
  openSheet: (s: 'rules' | 'settings' | 'history') => void;
}

export function Home({ go, openSheet }: Props) {
  const t = useT();
  const prefs = usePrefs();
  const [code, setCode] = useState('');
  const [needName, setNeedName] = useState(false);
  const [pickAvatar, setPickAvatar] = useState(false);

  const solo = loadSnapshot(SOLO_CODE);
  const soloInProgress = solo && (solo.phase === 'playing' || solo.phase === 'handOver');
  const hosted = recentHosted(prefs.clientId);

  const requireName = () => {
    if (prefs.name.trim()) return true;
    setNeedName(true);
    (document.getElementById('name-input') as HTMLInputElement | null)?.focus();
    return false;
  };

  const playSolo = (fresh: boolean) => {
    if (!requireName()) return;
    unlockAudio();
    if (fresh) clearSnapshot(SOLO_CODE);
    go('#/solo');
  };
  const createOnline = () => {
    if (!requireName()) return;
    unlockAudio();
    const c = createOnlineRoom(newRoomCode(), { t: 'hello', clientId: prefs.clientId, name: prefs.name.trim(), avatar: prefs.avatar });
    go(`#/m/${c}`);
  };
  const join = () => {
    if (!requireName()) return;
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 4) return;
    unlockAudio();
    go(`#/m/${c}`);
  };

  return (
    <div className="home">
      <div className="home-inner">
        <Logo />
        <p className="tagline">{t.tagline}</p>

        <div className={`panel who ${needName && !prefs.name.trim() ? 'shake-x' : ''}`}>
          <button className="avatar big-avatar" onClick={() => setPickAvatar((p) => !p)} aria-label={t.avatar}>
            {prefs.avatar}
          </button>
          <div className="who-field">
            <label htmlFor="name-input">{t.yourName}</label>
            <input
              id="name-input"
              value={prefs.name}
              maxLength={18}
              placeholder={t.namePh}
              autoComplete="nickname"
              onChange={(e) => {
                setPrefs({ name: e.target.value });
                setNeedName(false);
              }}
            />
            {needName && !prefs.name.trim() && <span className="err">{t.needName}</span>}
          </div>
          {pickAvatar && (
            <div className="avatar-grid">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  className={a === prefs.avatar ? 'on' : ''}
                  onClick={() => {
                    setPrefs({ avatar: a });
                    setPickAvatar(false);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="actions">
          {soloInProgress && (
            <button className="action resume" onClick={() => playSolo(false)}>
              <span className="action-icon">⏯</span>
              <span>
                <b>{t.resume}</b>
                <small>{t.soloTable}</small>
              </span>
            </button>
          )}
          {hosted.map((h) => (
            <button key={h} className="action resume" onClick={() => go(`#/m/${h}`)}>
              <span className="action-icon">🏠</span>
              <span>
                <b>{t.backToTable}</b>
                <small>{h}</small>
              </span>
            </button>
          ))}
          <button className="action primary" onClick={() => playSolo(true)}>
            <span className="action-icon">🤖</span>
            <span>
              <b>{t.playBots}</b>
              <small>{t.playBotsSub}</small>
            </span>
          </button>
          <button className="action" onClick={createOnline}>
            <span className="action-icon">🌎</span>
            <span>
              <b>{t.createOnline}</b>
              <small>{t.createOnlineSub}</small>
            </span>
          </button>
          <div className="action join">
            <span className="action-icon">🎟️</span>
            <span className="join-body">
              <b>{t.joinTable}</b>
              <span className="join-row">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && join()}
                  placeholder={t.codePh}
                  maxLength={6}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button className="btn primary" onClick={join} disabled={code.trim().length < 4}>
                  {t.join}
                </button>
              </span>
            </span>
          </div>
        </div>

        <nav className="home-links">
          <button onClick={() => openSheet('rules')}>📖 {t.rules}</button>
          <button onClick={() => openSheet('history')}>🏆 {t.history}</button>
          <button onClick={() => openSheet('settings')}>⚙️ {t.settings}</button>
        </nav>
      </div>
    </div>
  );
}

function recentHosted(clientId: string): string[] {
  const out: { code: string; at: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith('domino.room.') || k.endsWith(SOLO_CODE)) continue;
      const s = loadSnapshot(k.slice('domino.room.'.length));
      if (s && s.hostId === clientId && s.phase !== 'lobby' && Date.now() - s.savedAt < 1000 * 60 * 60 * 12) out.push({ code: s.code, at: s.savedAt });
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 2).map((x) => x.code);
}
