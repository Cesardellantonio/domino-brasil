import { useState } from 'react';
import { useT } from '../lib/i18n';
import { Lang, setPrefs, usePrefs } from '../lib/prefs';
import { clearHistory, loadHistory, rivals } from '../lib/history';
import { Segmented, Sheet, Toggle } from './common';
import { TileSvg } from './Tile';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const p = usePrefs();
  return (
    <Sheet title={t.settings} onClose={onClose}>
      <div className="field">
        <label>{t.language}</label>
        <Segmented<Lang>
          value={p.lang}
          onChange={(lang) => setPrefs({ lang })}
          options={[
            { value: 'pt', label: '🇧🇷 Português' },
            { value: 'en', label: '🇺🇸 English' },
          ]}
        />
      </div>
      <div className="field">
        <label>{t.theme}</label>
        <Segmented
          value={p.theme}
          onChange={(theme) => setPrefs({ theme })}
          options={[
            { value: 'felt', label: t.themeFelt },
            { value: 'wood', label: t.themeWood },
            { value: 'night', label: t.themeNight },
          ]}
        />
      </div>
      <Toggle on={p.sound} onChange={(sound) => setPrefs({ sound })} label={`🔊 ${t.sound}`} />
      <Toggle on={p.coloredPips} onChange={(coloredPips) => setPrefs({ coloredPips })} label={`🎨 ${t.coloredPips}`} />
      <Toggle on={p.memoryAid} onChange={(memoryAid) => setPrefs({ memoryAid })} label={`🧠 ${t.memoryAid}`} />
      <div className="preview-tiles">
        {[
          [1, 2],
          [3, 4],
          [5, 6],
        ].map(([a, b]) => (
          <TileSvg key={a} top={a} bottom={b} colored={p.coloredPips} />
        ))}
      </div>
    </Sheet>
  );
}

export function RulesSheet({ onClose }: { onClose: () => void }) {
  const p = usePrefs();
  return (
    <Sheet title={p.lang === 'pt' ? 'Como jogar' : 'How to play'} onClose={onClose} wide>
      {p.lang === 'pt' ? <RulesPt /> : <RulesEn />}
    </Sheet>
  );
}

function RulesPt() {
  return (
    <div className="rules-text">
      <h3>🀄 O básico</h3>
      <p>
        28 pedras (do 0-0 ao 6-6). Quatro jogadores em <b>duas duplas</b> — o parceiro senta à sua frente. Cada um recebe 7 pedras e não há monte. A vez passa
        para a direita (sentido anti-horário).
      </p>
      <h3>▶ Quem começa</h3>
      <p>
        Na primeira mão, quem tem a <b>carroça de sena (6-6)</b> começa jogando ela. Nas seguintes, começa quem bateu a mão anterior, com a pedra que quiser.
      </p>
      <h3>🔗 Jogando</h3>
      <p>
        Encaixe uma pedra numa das duas pontas da mesa com o mesmo número. Carroças (pedras duplas) ficam atravessadas. Se não tiver pedra que encaixe, você{' '}
        <b>passa</b> — e todo mundo fica sabendo que você não tem aqueles números. Se tiver, é obrigado a jogar.
      </p>
      <h3>🏁 Batida</h3>
      <table className="rules-table">
        <tbody>
          <tr>
            <td>Batida simples</td>
            <td>última pedra comum</td>
            <td>1 ponto</td>
          </tr>
          <tr>
            <td>Carroça</td>
            <td>bate com uma dupla</td>
            <td>2 pontos</td>
          </tr>
          <tr>
            <td>Lá-e-lô</td>
            <td>a última pedra servia nas duas pontas</td>
            <td>3 pontos</td>
          </tr>
          <tr>
            <td>Cruzada</td>
            <td>carroça que servia nas duas pontas</td>
            <td>4 pontos</td>
          </tr>
        </tbody>
      </table>
      <h3>🔒 Jogo trancado</h3>
      <p>
        Se ninguém consegue jogar, a mão tranca. Somam-se os pontos das pedras na mão de cada dupla: a menor soma leva 1 ponto. Empatou? Ninguém marca e a
        próxima mão vale dobro.
      </p>
      <h3>🏆 Partida</h3>
      <p>
        A primeira dupla a fazer <b>6 pontos</b> vence. Ganhar de 6 a 0 é <b>buchuda</b>! Tudo isso pode ser ajustado na mesa antes de começar.
      </p>
      <h3>🧠 Dicas de mesa</h3>
      <ul>
        <li>Livre-se cedo das carroças e das pedras pesadas.</li>
        <li>Preste atenção em quem passou: se o adversário não tem 4, deixe o 4 na ponta.</li>
        <li>Não tranque o seu parceiro — jogue nos números dele.</li>
        <li>O 💡 dá uma dica usando o bot Difícil.</li>
      </ul>
    </div>
  );
}

function RulesEn() {
  return (
    <div className="rules-text">
      <h3>🀄 Basics</h3>
      <p>
        28 tiles (0-0 to 6-6). Four players in <b>two pairs</b> — your partner sits across from you. Everyone gets 7 tiles, no boneyard. Play passes to the right
        (counter-clockwise).
      </p>
      <h3>▶ Who starts</h3>
      <p>
        First hand: whoever holds the <b>double six</b> opens with it. After that, whoever went out last starts with any tile.
      </p>
      <h3>🔗 Playing</h3>
      <p>
        Match a tile to one of the two open ends. Doubles are laid crosswise. If you can’t play you <b>pass</b> — and everyone learns you lack those numbers. If you
        can play, you must.
      </p>
      <h3>🏁 Going out</h3>
      <table className="rules-table">
        <tbody>
          <tr>
            <td>Simple</td>
            <td>regular last tile</td>
            <td>1 pt</td>
          </tr>
          <tr>
            <td>Carroça</td>
            <td>go out with a double</td>
            <td>2 pts</td>
          </tr>
          <tr>
            <td>Lá-e-lô</td>
            <td>last tile fits both ends</td>
            <td>3 pts</td>
          </tr>
          <tr>
            <td>Cruzada</td>
            <td>a double that fits both ends</td>
            <td>4 pts</td>
          </tr>
        </tbody>
      </table>
      <h3>🔒 Blocked game</h3>
      <p>If nobody can play, add up the pips left in each pair’s hands: the lower pair scores 1. A tie scores nothing and doubles the next hand.</p>
      <h3>🏆 Match</h3>
      <p>
        First pair to <b>6 points</b> wins. Winning 6–0 is a <b>buchuda</b>! All of this can be changed at the table before starting.
      </p>
    </div>
  );
}

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [all, setAll] = useState(loadHistory());
  const wins = all.filter((m) => m.winnerSlot === m.mySlot).length;
  const bat = all.reduce((s, m) => s + (m.myBatidas || 0), 0);
  const rv = rivals(all);
  return (
    <Sheet title={t.history} onClose={onClose} wide>
      {all.length === 0 ? (
        <p className="muted center">{t.noHistory}</p>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat">
              <b>{all.length}</b>
              <span>{t.matches}</span>
            </div>
            <div className="stat">
              <b>{wins}</b>
              <span>{t.won}</span>
            </div>
            <div className="stat">
              <b>{Math.round((wins / all.length) * 100)}%</b>
              <span>{t.winRate}</span>
            </div>
            <div className="stat">
              <b>{bat}</b>
              <span>{t.batidas}</span>
            </div>
          </div>
          {rv.length > 0 && (
            <>
              <h3>{t.rivalry}</h3>
              <div className="rivals">
                {rv.map((r) => (
                  <div key={r.name} className="rival-card">
                    <span className="avatar xs">{r.avatar}</span>
                    <b>{r.name}</b>
                    <span className="rival-rec">
                      🤝 {t.together}: {r.togetherWon}/{r.togetherPlayed}
                    </span>
                    <span className="rival-rec">
                      ⚔️ {t.against}: {r.againstWon} × {r.againstPlayed - r.againstWon}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <h3>{t.recent}</h3>
          <div className="recent">
            {all.slice(0, 30).map((m) => {
              const won = m.winnerSlot === m.mySlot;
              return (
                <div key={m.id} className={`recent-row ${won ? 'won' : 'lost'}`}>
                  <span className="recent-res">{won ? t.victory : t.defeat}</span>
                  <span className="recent-players">
                    {m.players.map((p, i) => (
                      <span key={i} title={p.name} className={p.slot === m.mySlot ? 'ally' : ''}>
                        {p.avatar}
                      </span>
                    ))}
                  </span>
                  <span className="recent-score">{m.scores.join(' × ')}</span>
                  <span className="muted small">{new Date(m.at).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
          <button
            className="link-btn danger"
            onClick={() => {
              clearHistory();
              setAll([]);
            }}
          >
            {t.clearHistory}
          </button>
        </>
      )}
    </Sheet>
  );
}
