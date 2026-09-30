# Dominó de Dupla (domino-brasil)

Brazilian partnership dominoes in the browser: rules engine, bots (easy/medium/hard Monte Carlo), online
tables with no server of our own, voice chat. Vite + React + TypeScript, deployed to GitHub Pages
(https://cesardellantonio.github.io/domino-brasil/) by `.github/workflows/deploy.yml` on every push to `main`.

**The UI and README are in Brazilian Portuguese (pt-BR); keep player-facing text in pt-BR** (`src/lib/i18n.ts`).
The players include the owner's family on phones: large tiles, simple flows, portrait and landscape.

| Path | What |
|---|---|
| `src/engine/` | Pure rules: tiles, dealing, legal moves, scoring, per-player views |
| `src/bots/` | Deduction, hand sampling, heuristic and Monte Carlo bots, strategies |
| `src/net/` | `Room` (authoritative host in the creator's browser), MQTT transport (HiveMQ, EMQX fallback, AES-GCM end-to-end), PeerJS voice |
| `src/ui/` | React screens: Home, Lobby, Game, Board (snake layout), Tile, VoicePanel |
| `src/lib/` | History, i18n, prefs, seeded rng, synthesized sound |
| `tests/` | vitest: engine, room, duel, arena (bot tournament, slow) |
| `scripts/` | Headless-Chrome checks: `shots.mjs` (visual smoke), `online.mjs`, `voice.mjs`, `match.mjs` |
| `PLAN.md`, `docs/` | Design plan and bot-strategy notes |

## Run and check

```sh
npm install
npm run dev                  # http://localhost:5173
npx vitest run tests/engine.test.ts tests/room.test.ts   # fast; what CI runs
npm test                     # everything incl. bot arena (~1 min)
npm run build                # tsc --noEmit + vite build
node scripts/shots.mjs http://localhost:5173/ <scratchpad>/shots 390x844   # phone-size visual smoke test
```

For other flows use `node ~/.claude/skills/playtest/playtest.mjs http://localhost:5173/ ...`. Check a phone
size (390x844) and a desktop size; look at the screenshots.

## Conventions

- Rules stay pure in `src/engine` with tests; the host `Room` is transport-agnostic.
- Only the host sees all tiles; each client gets only its own hand. Never leak other hands to a client.
- Sounds are synthesized (no audio files). No accounts, no server: keep it a static site.
- TURN config comes from `VITE_TURN_*` env vars at build time; never commit credentials.
