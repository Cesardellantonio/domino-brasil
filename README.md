# 🁫 Dominó de Dupla

Brazilian partnership dominoes (*dominó de dupla*) in the browser. Play with family online, against bots, or both, on a phone or a computer. There's nothing to install and no accounts.

**▶ Play:** https://cesardellantonio.github.io/domino-brasil/

## Features

- **Brazilian rules.** Double-six set, partners sit across, 6-6 opens the first hand, and *batida* scoring: simple 1, *carroça* 2, *lá-e-lô* 3, *cruzada* 4. Blocked games (*jogo trancado*) go to the lower pair total, ties double the next hand, and first to 6 wins, with *buchuda* on 6–0. Every rule is a table setting.
- **Modes.** Duplas (2×2), free-for-all with 4, 3 players, and 1 vs 1 (the modes with a boneyard use *compra*).
- **Online tables.** Create a table, send the link on WhatsApp, and your family joins in one tap. Any empty seat can be a bot, and you choose who partners with whom.
- **Bots at three levels.**
  - *Fácil* plays mostly at random.
  - *Médio* uses a club-player heuristic: dumps heavy tiles and doubles, tracks who passed on which numbers, feeds its partner, and knows when to block.
  - *Difícil* runs a determinized Monte Carlo search. It samples hundreds of possible hidden hands that fit everything seen so far and plays each move out.
  - Arena results: Médio beats Fácil 78% of the time and Difícil beats Médio 85%.
- **Hints.** 💡 asks the Difícil bot for its move.
- **Feel.** Synthesized tile clacks and a table-slamming *batida* (no audio files), screen shake, "BATEU!" / "LÁ-E-LÔ!" banners, speech-bubble emotes and bot banter, a tile reveal at the end of each hand, and confetti.
- **Memory aid.** Each player shows the numbers they've passed on. It can be turned off.
- **Resilience.** If a phone sleeps or a page reloads, the player rejoins in the same seat. After 40s away, a bot plays for them until they're back.
- **History.** Win/loss record, with partnership and rivalry stats per person.
- **Languages and install.** Portuguese and English, installable as an app (PWA), and three table themes.

## How online play works

The game has **no server of its own**. The browser that creates the table is the authoritative host. It shuffles with `crypto.getRandomValues`, validates every move, runs the bots, and sends each player **only their own tiles**. Other players connect to it directly over WebRTC data channels using [PeerJS](https://peerjs.com). PeerJS's free public broker only introduces the peers, and its TURN relays cover strict mobile networks.

➡️ **The host should keep their tab open** during the match. If the host reloads, the table state is restored from local storage and everyone reconnects.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine + room tests (and the bot arena, ~40s)
npm run arena      # bot strength tournament
npm run build
```

```
src/engine   pure rules: dealing, legal moves, scoring, player views (no hidden info)
src/bots     knowledge inference, deal sampling, heuristic + Monte Carlo bots
src/net      Room (authoritative host) + PeerJS host/guest transports
src/ui       React UI: board snake layout, table, lobby, sheets
```

Deploys to GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`).
