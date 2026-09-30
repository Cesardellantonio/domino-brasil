import { Strategy } from './types';
import { easy, medium, hard } from './baselines';
import { agent1 } from './agent1';
import { agent2 } from './agent2';
import { agent3 } from './agent3';
import { agent4 } from './agent4';

export const STRATEGIES: Record<string, Strategy> = { easy, medium, hard, agent1, agent2, agent3, agent4 };
export type { Strategy };
