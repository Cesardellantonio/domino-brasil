import { chooseMove } from '../bots';
import { Strategy } from './types';

// Placeholder: replaced by the agent that owns this file.
export const agent4: Strategy = {
  id: 'agent4',
  name: 'agent4 (placeholder)',
  description: 'Placeholder that plays like the medium baseline.',
  choose: (v, rng) => chooseMove(v, 'medium', rng),
};
