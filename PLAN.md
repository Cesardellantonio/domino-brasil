# Dominó Brasil: Implementation Plan

> **Implementation note (v1 shipped):** instead of a Node server on Fly.io, v1 uses a
> *host-in-the-browser* architecture. The table creator's browser runs the authoritative
> `Room` and guests connect peer-to-peer over WebRTC (PeerJS). This lets the whole game run
> as a static site on GitHub Pages with no accounts or server to maintain. The `Room` class
> is transport-agnostic, so a dedicated WebSocket server can be added later without
> touching rules, bots or UI. History and stats are stored per device (localStorage).

An online Brazilian domino game (*dominó de dupla*) for 1–4 players: people and bots,
in teams or head-to-head, playable from a phone or laptop. The main goal is a game
that feels like sitting at the table with Dad: the slap of the tile, the "passou!",
the trash talk, and the scoreboard that nobody forgets.

---

## 1. Goals and non-goals

**Goals**
- Faithful Brazilian rules: double-six set, partners sit across from each other, *batida* scoring, blocked games (*jogo trancado*), and configurable house rules.
- Any mix of up to 4 seats, each one a human or a bot. For example:
  - You + Dad vs 2 bots (partners against the machine)
  - You + bot vs Dad + bot (against each other)
  - You alone vs 3 bots (practice)
  - 4 humans
  - 1v1 or 3-player free-for-all with a boneyard
- Play online through a shared link or room code. No accounts needed.
- Works well on a phone in portrait and landscape, with large tiles and a simple UI (Dad-friendly).
- Bots that play credibly, with difficulty levels and good partner behavior.
- Fun extras: sounds, animations, emotes, stats and a rivalry history.

**Non-goals (v1)**
- Matchmaking with strangers, rankings, payments, native app stores.
- Built-in voice chat (use a phone/WhatsApp call alongside; maybe later, see §11).

---

## 2. Rules spec (the "source of truth" for the engine)

> ⚠️ Rules vary by region and family. Everything marked **[house rule]** is a
> room setting. **Before coding the engine, confirm with Dad how *he* plays.**

### 2.1 Standard 4-player team game (default)
- **Set:** 28 tiles, double-six (0-0 … 6-6).
- **Teams:** 2 pairs; partners sit opposite each other (seats 0 & 2 vs 1 & 3).
- **Deal:** 7 tiles each; all 28 are dealt, so there is no boneyard.
- **Turn order:** counter-clockwise, to the right **[house rule: direction]**.
- **First hand:** the holder of **6-6 (*carroça de sena*)** starts and must play it.
- **Later hands:** the player who won the previous hand starts with any tile
  **[house rule: or rotate the starter; or the winning pair picks who starts]**.
- **Play:** match a tile to either open end. The line has exactly **two ends**
  (no spinner in the Brazilian team game). Doubles are laid crosswise.
- **Pass:** a player with no playable tile passes. Passing is forced; if you have a
  playable tile you must play **[house rule: allow voluntary pass? normally no]**.
- **Hand ends by:**
  1. **Batida:** a player plays their last tile. Their pair scores:
     | Last tile | Name | Points |
     |---|---|---|
     | Normal tile, one end | *batida simples* | 1 |
     | Double (*carroça*) | *batida de carroça* | 2 |
     | Non-double that fits **both** ends | *lá-e-lô* | 3 |
     | Double that fits both ends | *cruzada* | 4 |
     **[house rule: point values]**
  2. **Blocked (*trancado/fechado*):** nobody can play. Count the pips left in hand.
     **[house rule: compare per pair total vs lowest individual hand]**. The lower
     count wins 1 point **[house rule: value]**. On a tie, nobody scores and the
     next hand is worth double **[house rule]**.
- **Match:** first pair to **6 points** wins **[house rule: 6 / 10 / custom]**.
  Optional: a shutout (6–0) counts as a *buchuda* and is announced with extra
  ceremony **[house rule]**.
- **Optional bonuses [house rules, off by default]:** points for making the
  opponents pass (*passe*). Confirm the exact local version with Dad before
  implementing.

### 2.2 Other modes
| Mode | Seats | Deal | Boneyard | Notes |
|---|---|---|---|---|
| Duplas (default) | 4 | 7 | none | Rules above |
| 1v1 | 2 | 7 | 14 tiles; draw until playable (*compra*) | Blocked: lower hand wins |
| 3 players | 3 | 7 (or 9) | 7 (or 1) | Everyone for themselves |
| 4 free-for-all | 4 | 7 | none | Individual scoring |
| **Later:** *Dominó de pontos* (score multiples of 5 on the ends) | 2–4 | 7 | varies | Separate rules module |

---

## 3. Architecture

```
┌─────────────── Browser (PWA) ───────────────┐        ┌──────────── Server ─────────────┐
│ React UI  ──  Table renderer (SVG + motion) │  WS    │ Room manager (in-memory + snap) │
│ Local store (Zustand)  ◄──── state/events ──┼───────►│ Authoritative game engine       │
│ Sound, haptics, i18n (pt-BR / en)           │        │ Bot runner (same engine)        │
└──────────────────────────────────────────────┘        │ Persistence: SQLite (matches,  │
                                                        │   stats, replays)               │
          packages/engine  ◄── shared TypeScript ──►    └─────────────────────────────────┘
```

**Key principles**
1. **One pure engine, shared by client and server.** `applyMove(state, move) → state`
   is deterministic, has no I/O, and is covered by thorough tests. Rules, bots,
   replays and the UI all use it.
2. **Server-authoritative.** The server shuffles (with a crypto RNG), holds all hands,
   validates every move, and sends each player **only their own hand** (plus
   everyone's tile counts). No cheating by opening DevTools.
3. **Event-sourced hands.** A hand is `seed + list of moves`. That gives replays,
   reconnection, "undo last hand" and bug reports for free.
4. **Bots are just seats.** A bot sees exactly what a human in that seat would see
   (its own hand plus public history). It never peeks at other hands.

### 3.1 Tech stack (recommended)
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One engine for client, server and bots |
| Monorepo | pnpm workspaces: `engine`, `server`, `web`, `bots` | Simple and fast |
| Frontend | Vite + React + Zustand + Framer Motion | Quick to build, great animations |
| Rendering | SVG tiles (pips drawn in SVG) | Crisp at any size, easy to animate, no assets needed |
| Realtime | Plain WebSocket (`ws`) with typed messages (zod) | Small, no framework lock-in |
| Server | Node 22 + Fastify (HTTP) + `ws` | One process serves both |
| Storage | SQLite (better-sqlite3) | Stats, match history, replays; a single file |
| Hosting | **Fly.io** (1 small machine plus a volume for SQLite) | WebSockets just work; about $0–5/mo |
| Alt. hosting | Cloudflare Workers + Durable Objects (one DO per room) | Great fit for rooms; more to learn |
| Tests | Vitest + fast-check (property tests) + Playwright (E2E) | |

### 3.2 Repository layout
```
domino-brasil/
  packages/
    engine/        # pure rules: tiles, deal, legal moves, scoring, variants
      src/tiles.ts  src/state.ts  src/moves.ts  src/scoring.ts  src/rules/*.ts
    bots/          # bot strategies (use the engine only)
    server/        # rooms, sockets, persistence, bot runner
    web/           # React app
  e2e/             # Playwright multi-browser tests
  PLAN.md
```

---

## 4. Engine design

### 4.1 Core types
```ts
type Pip = 0|1|2|3|4|5|6;
type Tile = { a: Pip; b: Pip; id: number };          // a <= b; id 0..27
type Seat = 0|1|2|3;
type End = 'left' | 'right';

interface RulesConfig {
  mode: 'duplas' | '1v1' | 'three' | 'ffa4';
  direction: 'ccw' | 'cw';
  targetScore: number;                               // 6
  batidaPoints: { simples: number; carroca: number; laELo: number; cruzada: number };
  blockedResolution: 'pairTotal' | 'lowestPlayer';
  blockedTie: 'noPointsDoubleNext' | 'noPoints';
  firstHandStarter: 'doubleSix' | 'highestDouble';
  nextHandStarter: 'winner' | 'rotate';
  passBonus: null | { points: number };
  handSize: number;
}

interface HandState {
  rules: RulesConfig;
  hands: Tile[][];            // server-only
  boneyard: Tile[];           // server-only
  line: PlacedTile[];         // in order left→right, with orientation
  ends: { left: Pip; right: Pip } | null;
  turn: Seat;
  passes: Seat[];             // consecutive passes, for block detection
  log: Move[];
  status: 'playing' | 'won' | 'blocked';
}

type Move =
  | { t: 'play'; seat: Seat; tile: number; end: End }
  | { t: 'draw'; seat: Seat }
  | { t: 'pass'; seat: Seat };
```

### 4.2 Engine API
- `newMatch(rules, seed)`, `dealHand(match, seed)`
- `legalMoves(state, seat): Move[]`
- `applyMove(state, move): HandState` (throws on an illegal move)
- `scoreHand(state): { winnerTeam, points, kind }`
- `viewFor(state, seat): PlayerView` (strips hidden info; the *only* thing sent to clients)
- `replay(seed, moves): HandState`

### 4.3 Test plan for the engine
- Unit tests for every scoring case (simples, carroça, lá-e-lô, cruzada, blocked, tie).
- Property tests: random legal play always terminates; tiles are conserved (28 at all
  times); `viewFor` never leaks another seat's tiles; replay(seed, log) == live state.
- Simulation: 100k bot-vs-bot hands for sanity stats (e.g. how often games block).

---

## 5. Multiplayer and rooms

### 5.1 Flow
1. You open the site → **"Criar mesa"** → pick mode and house rules → get a link like
   `domino.example.com/m/PATO42` plus a QR code.
2. Send it to Dad on WhatsApp. He taps it, types his name (remembered next time), and
   picks a seat.
3. Empty seats show **"+ Bot (Fácil/Médio/Difícil)"**. The host can swap seats and
   choose teams by dragging names around the table.
4. The host presses **Começar**.

### 5.2 Protocol (typed, versioned)
Client → server: `join`, `takeSeat`, `setBot`, `startMatch`, `move`, `emote`, `chat`,
`rematch`, `ping`.
Server → client: `roomState` (seats, settings), `handStart` (your tiles),
`moveApplied` (public move + new ends + counts), `handEnd` (all hands revealed +
score), `matchEnd`, `emote`, `error`.

### 5.3 Robustness (matters a lot for a relaxed game with Dad)
- **Reconnect:** a player token in localStorage. If Dad's phone locks, he rejoins
  into the same seat with his full view restored.
- **Disconnect grace:** 60s, after which a bot temporarily plays for him (with an
  "🤖 jogando por Pai" badge) until he returns.
- **Turn timer:** off by default for friends; optional 30/60s.
- **Rooms persist:** snapshots to SQLite so a server restart does not lose the match.
- **Idle rooms** expire after 24h.

---

## 6. Bots

All bots take `(PlayerView, rules) → Move`. They add a human-like delay of 0.6–1.8s,
randomized, and longer for harder decisions.

### Level 1: Fácil (beginner)
Random legal move, with a slight bias toward getting rid of heavy tiles.

### Level 2: Médio (solid club player), heuristic scoring per legal move
- Play heavy tiles early (reduces blocked-game risk).
- Get rid of doubles early (they are hard to place later).
- Keep variety: don't play away the last tile of a number you hold several of.
- **Track passes:** if an opponent passed on 4s, try to keep a 4 open. If your
  partner passed on 4s, avoid leaving a 4.
- Keep ends on numbers you control (you hold many of that number).
- Take *lá-e-lô* and *cruzada* chances when available.
- **Block awareness:** count remaining tiles of each number; close the game when your
  pair's pip count is lower.

### Level 3: Difícil (strong), determinized Monte Carlo
- Build the constraint set of what each hidden hand *could* contain: known tiles out,
  numbers each player has passed on, and hand sizes.
- Sample N consistent deals (e.g. 200–500), simulate each candidate move to the end
  with the Médio policy for all seats, and pick the move with the best expected
  score for the pair.
- Time-boxed at about 300ms per move on the server. This is feasible because the game tree is small.

### Partner behavior (makes teams with a bot feel good)
- A bot partner **supports its partner's numbers**: it infers what you hold from
  what you played and passed, and keeps those numbers open.
- It avoids *batida* conflicts: when its partner is about to win, it does not block
  its partner.

### Tuning and fairness
- A bot tournament runner (`pnpm bots:arena`) plays 10k matches per matchup and
  reports win rates. Target: Médio beats Fácil about 75%, and Difícil beats Médio
  about 60%.
- Optional **"Dica"** (hint) button for humans that uses the Médio bot. Great for
  learning and teasing ("até o bot sabia essa, pai").

---

## 7. UI / UX

### 7.1 Table layout
- **Top-down green felt table**, with you always at the bottom, your partner at the top, and
  opponents left and right (rotated per viewer).
- **Your hand:** large tiles in a fan at the bottom. Playable tiles are raised
  slightly and unplayable ones are dimmed (toggle this for "hard mode").
- **Playing:** tap a tile. If it fits only one end, it plays immediately. If it fits both,
  both ends glow and you tap the one you want. Dragging also works.
- **Line layout:** a snake that turns at the table edges, with doubles crosswise. The camera
  auto-fits and zooms smoothly as the line grows. This layout algorithm is its own
  task (see M3).
- **Opponent hands:** face-down tile backs showing the count.
- **Info bar:** score (*Nós 3 × 2 Eles*), open ends, and whose turn it is (a glowing seat).
- **Pass indicator:** a "Passou" bubble above the seat plus a memory strip showing which
  numbers each player has passed on (on by default for beginners).

### 7.2 The "feel" (what makes it fun)
- **Sound:** a clack for each tile placed. A **batida** gets the big slam on the table with a
  screen shake. The *lá-e-lô* and *cruzada* get special stingers. Shuffle sounds at deal.
- **Announcements:** a big animated banner for "BATEU!", "LÁ-E-LÔ!", "CRUZADA!",
  "TRANCOU!", and "BUCHUDA!" with confetti.
- **Emotes and quick phrases** (tap to send, each shown as a bubble with a sound):
  "Passou! 😂", "Tá difícil, hein?", "Segura essa!", "Boa, parceiro!",
  "Vou bater…", "🐓", "☕", "🤦". Custom phrases per room.
- **End-of-hand reveal:** everyone's remaining tiles flip over one by one with the pip count
  added up (dramatic for blocked games).
- **Haptics** on mobile at your turn and at batida.
- Themes: classic green felt, wooden bar table, and a *boteco* night theme.
- **pt-BR first**, with English as a toggle.

### 7.3 Accessibility and Dad-friendliness
- Tiles at least 56px tall on phones and a high-contrast pip option.
- A "your turn" cue that uses both sound and color.
- No sign-up. The name is remembered. There is one big button to play again (*Revanche*).
- Add to home screen (PWA) so it works like an app.

---

## 8. Making it social and replayable

- **Rivalry record:** a persistent head-to-head and partnership history per pair of
  names, such as "Você & Pai: 23 vitórias juntos" and "Você vs Pai: 14 × 17".
- **Match history and replays:** step through any past hand. Useful for arguing
  about who made the wrong play.
- **Stats:** batidas, lá-e-lôs, cruzadas, blocked-games won, and longest win streak.
- **Achievements (light):** first cruzada, winning a buchuda, winning with a bot
  partner on Difícil, 10 matches with Dad.
- **Weekly "Clássico":** an optional reminder (e.g. Sunday evening) with the running
  season score.
- **Spectator seat** for family members to watch.

---

## 9. Security and fairness
- A crypto-secure shuffle on the server. The seed is revealed after the hand ends
  (optional "provably fair" view).
- The client never receives hidden tiles. Every move is validated server-side.
- Rate-limit room creation. Room codes are 6 characters from an unambiguous alphabet.
- Names and chat are length-limited and escaped.

---

## 10. Milestones

Each milestone ends with something playable.

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| **M0** | Rules confirmed | This doc's house rules checked with Dad; `RulesConfig` defaults set | ½ day |
| **M1** | Engine | `packages/engine` complete for duplas + 1v1, 95%+ test coverage, property tests | 2–3 days |
| **M2** | Bots v1 | Fácil + Médio bots, arena runner, sanity stats | 2 days |
| **M3** | Local table UI | Play solo vs 3 bots in the browser (no server yet): hand, tap-to-play, snake layout, scoring screens | 4–5 days |
| **M4** | Online rooms | Server, room codes, seats, bots in empty seats, reconnect, deploy to Fly.io. **You and Dad play the first real match** 🎉 | 3–4 days |
| **M5** | Feel pass | Sounds, animations, banners, emotes, haptics, themes | 3 days |
| **M6** | Persistence & social | SQLite, match history, rivalry record, stats, replays | 2–3 days |
| **M7** | Difícil bot | Monte Carlo bot, partner inference, hint button | 2–3 days |
| **M8** | Polish | PWA, pt-BR/en, accessibility, E2E tests with 4 browsers, load test | 2 days |
| **Later** | Extras | 3-player & FFA modes, *dominó de pontos*, spectators, voice chat (WebRTC), tournaments | — |

**Minimum fun version = M0–M4** (about 2 weeks of part-time work): a real online game
with Dad and bots. Everything after that makes it better.

---

## 11. Risks and open questions
- **House rules differ.** Mitigated by making them configurable, but the defaults
  should match Dad's rules. → *Ask Dad* (see the questions below).
- **Snake layout on small phones** is the trickiest UI problem. Prototype it early in
  M3, with auto-zoom and turning at the edges.
- **Free hosting sleeps.** Fly.io machines can auto-stop, which makes the first
  connection slow. Keep one machine always on (cheap).
- **Voice.** For v1 use a WhatsApp call alongside. Built-in WebRTC voice is a
  possible later milestone.

### Questions to confirm with Dad (M0)
1. Which way does play go: to the right (counter-clockwise) or to the left?
2. Who starts after the first hand: the winner, or the next player in turn?
3. Batida values: 1 / 2 / 3 / 4 for simples / carroça / lá-e-lô / cruzada?
4. Blocked game: compare pair totals or the lowest single hand? What happens on a tie?
5. Is the match to 6 points? Is a 6–0 special?
6. Any points for making the other pair pass (*passe*)? Any other local rules?
7. Can a player pass on purpose while holding a playable tile? (Usually no.)
