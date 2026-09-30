import { chooseMove } from '../bots';
import { Strategy } from './types';

export const easy: Strategy = {
  id: 'easy',
  name: 'Fácil (baseline)',
  description: 'Mostly random, half the time dumps the heaviest tile.',
  choose: (v, rng) => chooseMove(v, 'easy', rng),
};

export const medium: Strategy = {
  id: 'medium',
  name: 'Médio (baseline)',
  description: 'Hand-tuned heuristic: heavy tiles and doubles first, tracks passes, supports partner.',
  choose: (v, rng) => chooseMove(v, 'medium', rng),
};

export const hard: Strategy = {
  id: 'hard',
  name: 'Difícil (baseline, current game bot)',
  description: 'Determinized Monte Carlo: samples hidden hands consistent with passes, greedy playouts.',
  choose: (v, rng, budgetMs) => chooseMove(v, 'hard', rng, budgetMs),
};
