# Torneio de estratégias

Four AI agents each designed a strategy for dominó de dupla under the table rules (race to 100: the side that loses a hand adds the pips left in its own hands, and whoever reaches 100 loses). The strategies were then compared in a round robin against each other and against the game's existing bots.

**Format**
- 6 strategies, 15 pairings.
- Each pairing played 100 deals, and each deal was played twice with the teams swapped. The teams swap is what cancels the luck of the deal. That's 200 matches per pairing and 3,000 in total.
- The seeds (from 500,000 up) were never used by any agent during development.
- Every strategy got the same 20 ms of thinking time per move.
- There were no illegal moves.
- To rerun: `SEED0=500000 scripts/tournament.sh "medium hard agent1 agent2 agent3 agent4" 100 20 4 && node scripts/rank.mjs`

## Ranking

| # | Strategy | Elo | Win % (1,000 matches) | Penalty per match* | ms per move |
|---|---|---|---|---|---|
| 1 | **agent1 · O Contador**: inference and card counting | 1627 | 68.1% | −29.8 | 9.5 |
| 1 | **agent2 · Calculista**: fast search and exact endgame | 1626 | 67.9% | −32.5 | 9.9 |
| 3 | agent3 · Parceiro: partnership play | 1552 | 57.0% | −10.3 | 7.9 |
| 4 | agent4 · O Trancador: risk and blocking | 1497 | 48.6% | +1.3 | 7.0 |
| 5 | hard: the game's current Difícil bot | 1473 | 44.9% | +9.1 | 5.0 |
| 6 | medium: the game's current Médio bot | 1224 | 13.5% | +62.3 | 0.0 |

\*The average difference between the penalty points the strategy took and those its opponents took, per match. Negative is better.

## Head to head (row's win rate against the column, ±~7 pts)

|  | Contador | Calculista | Parceiro | Trancador | Difícil | Médio |
|---|---|---|---|---|---|---|
| **Contador** | – | 45% | 60% | 69% | 75% | 92% |
| **Calculista** | 55% | – | 61% | 68% | 65% | 92% |
| **Parceiro** | 40% | 39% | – | 58% | 63% | 86% |
| **Trancador** | 31% | 33% | 43% | – | 53% | 84% |
| **Difícil** | 26% | 36% | 37% | 47% | – | 80% |
| **Médio** | 8% | 9% | 15% | 16% | 21% | – |

## What made the difference

1. **Reading the plays, not only the passes.** Both leaders weight the possible hidden deals by how likely each player's actual plays would be under each deal. Contador's accuracy at guessing hidden tiles went from 43% to 49%. In both agents this was the single biggest gain.
2. **A better rollout policy beat more samples.** Tripling or quintupling the thinking time barely helped. The rollout policy that helped most prefers moves the next opponent can't answer and avoids making the partner pass.
3. **Solving the endgame exactly was a trap.** It assumes every player sees every hand. It helped only for small positions at the very end (Calculista), and it made things worse when used earlier (Trancador, Parceiro).
4. **Scoring by chance of winning the match versus by points:** small or no gain. Contador +5 points head to head; Calculista no difference.
5. **Partnership conventions** didn't show a measurable effect yet. The Parceiro agent's test where the bot could see its partner's hand shows a lot of room for better partner reading.
