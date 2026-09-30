import { chooseMove } from '../bots';
import { Strategy } from './types';

// Placeholder: replaced by the agent that owns this file.
export const agent2: Strategy = {
  id: 'agent2',
  name: 'agent2 (placeholder)',
  description: 'Placeholder that plays like the medium baseline.',
  choose: (v, rng) => chooseMove(v, 'medium', rng),
};
