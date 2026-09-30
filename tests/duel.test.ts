import { it } from 'vitest';

import { mkdirSync, writeFileSync } from 'node:fs';
import { STRATEGIES } from '../src/bots/strategies';
import { duel, summarize } from '../src/bots/strategies/arena';

/**
 * Head-to-head between two strategies. Skipped unless A and B are set:
 *   A=agent1 B=hard SEEDS=40 BUDGET=20 npx vitest run tests/duel.test.ts
 */
const { A, B } = process.env;
const SEEDS = Number(process.env.SEEDS ?? 40);
const BUDGET = Number(process.env.BUDGET ?? 20);
const SEED0 = Number(process.env.SEED0 ?? 100_000);

it.skipIf(!A || !B)('duel', () => {
  const a = STRATEGIES[A!];
  const b = STRATEGIES[B!];
  if (!a || !b) throw new Error(`unknown strategy; known: ${Object.keys(STRATEGIES).join(', ')}`);
  const r = duel(a, b, SEEDS, SEED0, BUDGET);
  const out = { ...summarize(r), budgetMs: BUDGET, seed0: SEED0, raw: r };
  mkdirSync('results', { recursive: true });
  const file = process.env.OUT ?? `results/duel-${A}-vs-${B}.json`;
  writeFileSync(file, JSON.stringify(out, null, 1));
  process.stdout.write('DUEL_RESULT ' + JSON.stringify(summarize(r)) + '\n');
}, 3_600_000);
