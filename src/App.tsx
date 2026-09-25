import { useEffect, useState } from 'react';
import { Home } from './ui/Home';
import { Lobby } from './ui/Lobby';
import { Game } from './ui/Game';
import { TileDefs } from './ui/Tile';
import { HistorySheet, RulesSheet, SettingsSheet } from './ui/Sheets';
import { Logo, Sheet } from './ui/common';
import { SOLO_CODE, useSession } from './ui/useSession';
import { useT } from './lib/i18n';
import { AVATARS, setPrefs, usePrefs } from './lib/prefs';
import { unlockAudio } from './lib/sound';

type SheetKind = 'rules' | 'settings' | 'history' | 'menu' | null;

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const prefs = usePrefs();
  const go = (h: string) => {
    location.hash = h;
  };

  let screen;
  const m = hash.match(/^#\/m\/([A-Za-z0-9]{4,8})/);
  if (hash.startsWith('#/solo')) screen = <SessionScreen key="solo" code={SOLO_CODE} go={go} openSheet={setSheet} />;
  else if (m) screen = prefs.name.trim() ? <SessionScreen key={m[1]} code={m[1].toUpperCase()} go={go} openSheet={setSheet} /> : <NameGate code={m[1].toUpperCase()} />;
  else screen = <Home go={go} openSheet={setSheet} />;

  return (
    <div className={`app theme-${prefs.theme}`}>
      <TileDefs />
      {screen}
      {sheet === 'rules' && <RulesSheet onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet onClose={() => setSheet(null)} />}
      {sheet === 'history' && <HistorySheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function SessionScreen({ code, go, openSheet }: { code: string; go: (h: string) => void; openSheet: (s: SheetKind) => void }) {
  const t = useT();
  const s = useSession(code);
  const [menu, setMenu] = useState(false);
  const st = s.state;
  const leave = () => go('#/');

  // Keep the screen awake during a game where supported.
  useEffect(() => {
    let lock: any = null;
    const req = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* ignore */
      }
    };
    void req();
    const vis = () => document.visibilityState === 'visible' && void req();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lock?.release?.();
    };
  }, []);

  if (!st) {
    return (
      <div className="connecting-screen">
        <Logo small />
        {s.status === 'notFound' ? (
          <>
            <p>{t.notFound}</p>
            <div className="row">
              <button className="btn primary" onClick={s.retry}>
                {t.tryAgain}
              </button>
              <button className="btn" onClick={leave}>
                {t.home}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="spinner" />
            <p>
              {s.status === 'reconnecting' ? t.reconnecting : t.connecting} <b>{code !== SOLO_CODE ? code : ''}</b>
            </p>
            <button className="link-btn" onClick={leave}>
              {t.home}
            </button>
          </>
        )}
      </div>
    );
  }

  const inGame = st.phase !== 'lobby' && st.view;
  return (
    <>
      {inGame ? <Game st={st} send={s.send} emotes={s.emotes} onMenu={() => setMenu(true)} /> : <Lobby st={st} send={s.send} onLeave={leave} />}
      {s.status !== 'open' && (
        <div className="conn-toast">
          {s.status === 'notFound' ? t.hostOffline : t.reconnecting}
          {s.status === 'notFound' && (
            <button className="chip" onClick={s.retry}>
              {t.tryAgain}
            </button>
          )}
        </div>
      )}
      {s.error && <div className="error-toast">{s.error}</div>}
      {menu && (
        <Sheet title={t.menu} onClose={() => setMenu(false)}>
          <div className="menu-list">
            <button
              onClick={() => {
                setMenu(false);
                openSheet('rules');
              }}
            >
              📖 {t.rules}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                openSheet('settings');
              }}
            >
              ⚙️ {t.settings}
            </button>
            {st.you.isHost && (
              <button
                onClick={() => {
                  setMenu(false);
                  s.send({ t: 'toLobby' });
                }}
              >
                🪑 {t.backToLobby}
              </button>
            )}
            <button className="danger" onClick={leave}>
              🚪 {t.leaveTable}
            </button>
          </div>
          {st.online && (
            <p className="muted small center">
              {t.table} <b>{st.code}</b>
            </p>
          )}
        </Sheet>
      )}
    </>
  );
}

function NameGate({ code }: { code: string }) {
  const t = useT();
  const prefs = usePrefs();
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    unlockAudio();
    setPrefs({ name: name.trim() });
  };
  return (
    <div className="home">
      <div className="home-inner">
        <Logo />
        <p className="tagline">
          {t.joinTable} <b className="room-code inline">{code}</b>
        </p>
        <div className="panel who">
          <div className="who-field">
            <label htmlFor="gate-name">{t.yourName}</label>
            <input id="gate-name" autoFocus value={name} maxLength={18} placeholder={t.namePh} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </div>
          <div className="avatar-grid always">
            {AVATARS.map((a) => (
              <button key={a} className={a === prefs.avatar ? 'on' : ''} onClick={() => setPrefs({ avatar: a })}>
                {a}
              </button>
            ))}
          </div>
          <button className="btn primary big" disabled={!name.trim()} onClick={submit}>
            {t.join} →
          </button>
        </div>
      </div>
    </div>
  );
}
