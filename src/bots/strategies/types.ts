import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { Rng } from '../../lib/rng';

/**
 * A domino strategy. It only sees what a human in that seat would see (`PlayerView`):
 * its own hand, the table, tile counts, the public log (plays and passes), scores and rules.
 *
 * - Must return one of `view.legal`.
 * - Must respect `budgetMs` (wall-clock thinking time per decision).
 * - Must be deterministic given `rng` (use it for all randomness, never Math.random).
 */
export interface Strategy {
  id: string;
  name: string;
  description: string;
  choose(view: PlayerView, rng: Rng, budgetMs: number): Move;
}
