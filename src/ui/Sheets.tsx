import { useState } from 'react';
import { useT } from '../lib/i18n';
import { setPrefs, usePrefs } from '../lib/prefs';
import { clearHistory, loadHistory, rivals } from '../lib/history';
import { Segmented, Sheet, Toggle } from './common';
import { TileSvg } from './Tile';
import { syncAmbience } from '../lib/sound';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const p = usePrefs();
  return (
    <Sheet title={t.settings} onClose={onClose}>
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
      <Toggle
        on={p.sound}
        onChange={(sound) => {
          setPrefs({ sound });
          syncAmbience();
        }}
        label={`🔊 ${t.sound}`}
      />
      <Toggle
        on={p.ambience}
        onChange={(ambience) => {
          setPrefs({ ambience });
          syncAmbience();
        }}
        label={`🍺 ${t.ambience}`}
      />
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
  return (
    <Sheet title="Como jogar" onClose={onClose} wide>
      <RulesPt />
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
      <h3>🧮 Pontuação: soma dos pontos (padrão)</h3>
      <p>
        Quem <b>bate</b> (joga a última pedra) faz a dupla marcar a <b>soma dos pontos das pedras que sobraram na mão dos adversários</b>. Exemplo: os adversários
        ficaram com 6-4 e 3-2 → sua dupla marca 15 pontos. Vence a primeira dupla a chegar a <b>100 pontos</b> (dá para escolher 50, 150 ou 200).
      </p>
      <h3>🏁 Pontuação alternativa: por batida</h3>
      <p>Se preferir o jogo curto, escolha “Por batida” na mesa. Aí cada batida vale pontos fixos, e a partida vai a 6:</p>
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
        Se ninguém consegue jogar, a mão tranca. Somam-se os pontos das pedras na mão de cada dupla e vence quem tiver a <b>menor soma</b>. Na soma dos
        pontos, a dupla vencedora marca os pontos dos adversários (na pontuação por batida, vale 1). Empatou? Ninguém marca e a próxima mão vale dobro.
      </p>
      <h3>🏆 Partida</h3>
      <p>
        A primeira dupla a atingir a meta vence. Ganhar sem o adversário marcar nada é <b>buchuda</b>! Tudo isso pode ser ajustado na mesa antes de
        começar.
      </p>
      <h3>🧠 Dicas de mesa</h3>
      <ul>
        <li>Livre-se cedo das carroças e das pedras pesadas.</li>
        <li>Preste atenção em quem passou: se o adversário não tem 4, deixe o 4 na ponta.</li>
        <li>Não tranque o seu parceiro — jogue nos números dele.</li>
        <li>Na soma dos pontos, pedra pesada na mão no fim da mão vira ponto para o adversário.</li>
        <li>O 💡 dá uma dica usando o bot Difícil.</li>
        <li>Na mesa online, toque no 📞 para conversar por voz com todo mundo, como no boteco.</li>
      </ul>
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
