import { ClientState } from '../net/protocol';
import { useT } from '../lib/i18n';
import { VoiceApi } from './useSession';

/** Chamada de voz da mesa: entrar, silenciar, sair, e ver quem está falando. */
export function VoicePanel({ st, voice }: { st: ClientState; voice: VoiceApi }) {
  const t = useT();
  return (
    <section className="panel voice-panel">
      <div className="panel-title">📞 {t.voiceTitle}</div>
      <div className="voice-members">
        {st.voice.length === 0 && <span className="muted small">{t.voiceEmpty}</span>}
        {st.voice.map((m) => (
          <span key={m.clientId} className={`voice-member ${voice.speaking.has(m.clientId) ? 'talking' : ''} ${m.muted ? 'muted' : ''}`}>
            <span className="avatar xs">{m.avatar}</span>
            {m.name}
            {m.muted && ' 🔇'}
          </span>
        ))}
      </div>
      <div className="invite-row">
        {voice.joined ? (
          <>
            <button className={`btn ${voice.muted ? '' : 'live'}`} onClick={voice.toggleMute}>
              {voice.muted ? `🔇 ${t.unmute}` : `🎙️ ${t.mute}`}
            </button>
            <button className="btn" onClick={voice.leave}>
              📴 {t.leaveCall}
            </button>
          </>
        ) : (
          <button className="btn whatsapp" disabled={voice.busy} onClick={() => void voice.join()}>
            {voice.busy ? '…' : `📞 ${t.joinCall}`}
          </button>
        )}
      </div>
      <p className="muted small">🎧 {t.headphonesTip}</p>
    </section>
  );
}
