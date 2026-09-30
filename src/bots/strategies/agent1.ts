import { chooseMove } from '../bots';
import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { Rng } from '../../lib/rng';
import { Strategy } from './types';
import { DEFAULT_SEARCH, SearchParams, searchMove, uniquePlays } from './agent1-search';

/** True when the view uses the rules this strategy was built for (4-player pairs, pip race, no boneyard). */
function supported(v: PlayerView): boolean {
  const r = v.rules;
  return v.n === 4 && r.mode === 'duplas' && r.scoring === 'pips' && r.blockedResolution === 'pairTotal' && v.boneyard === 0 && r.targetScore === 100;
}

export function makeAgent1(SP: SearchParams = DEFAULT_SEARCH, id = 'agent1'): Strategy {
  return {
    id,
    name: 'O Contador',
    description:
      'Card counter: tracks every unseen tile and the voids revealed by passes, weighs possible deals by how plausible ' +
      'each seat\'s past choices were (MCMC over deals), then runs fast Monte Carlo rollouts scored by match equity in the race to 100.',
    choose(v: PlayerView, rng: Rng, budgetMs: number): Move {
      if (v.legal.length === 1) return v.legal[0];
      if (!supported(v)) return chooseMove(v, 'hard', rng, budgetMs);
      const plays = uniquePlays(v);
      if (plays.length === 0) return v.legal[0];
      if (plays.length === 1) return plays[0];
      return searchMove(v, plays, rng, budgetMs, SP);
    },
  };
}

export const agent1: Strategy = makeAgent1();
