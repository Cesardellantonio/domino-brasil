/**
 * Soft inference from the other seats' plays: each sampled deal is weighted by how likely the
 * observed plays were under a conditional-logit model of "reasonable" play (dump heavy tiles,
 * play doubles early, keep follow-ups and long suits). Passes are handled as hard constraints
 * by the sampler; this adds the information carried by the tiles people chose to play.
 */
import { PlayerView } from '../../engine/view';
import { NM, PIP, TA, TB, popc } from './agent2-core';

export interface PlayModel {
  pip: number;
  dbl: number;
  fol: number;
  suit: number;
}

/** Fitted on the Monte Carlo bots' decisions (they are only mildly predictable). */
export const SEARCH_MODEL: PlayModel = { pip: 0.1, dbl: 1.3, fol: 0.13, suit: 0.19 };
/** Fitted on the heuristic bot (very predictable). */
export const SHARP_MODEL: PlayModel = { pip: 1.0, dbl: 6.3, fol: 1.6, suit: 0.47 };

export function optionScore(m: PlayModel, hand: number, u: number, l: number, r: number): number {
  const rest = hand & ~(1 << u);
  let fol = 0;
  if (TA[u] === l || TB[u] === l) {
    const ne = TA[u] === l ? TB[u] : TA[u];
    fol = popc(rest & (NM[ne] | NM[r]));
  }
  if (TA[u] === r || TB[u] === r) {
    const ne = TA[u] === r ? TB[u] : TA[u];
    const f = popc(rest & (NM[ne] | NM[l]));
    if (f > fol) fol = f;
  }
  if (fol > 4) fol = 4;
  const suit = popc(rest & (NM[TA[u]] | NM[TB[u]]));
  return m.pip * PIP[u] + (TA[u] === TB[u] ? m.dbl : 0) + m.fol * fol + m.suit * suit;
}

/** log P(chose t | hand, ends) under model m. */
export function logChoice(m: PlayModel, hand: number, t: number, l: number, r: number): number {
  let opts = hand & (NM[l] | NM[r]);
  if ((opts & (opts - 1)) === 0) return 0; // forced
  const st = optionScore(m, hand, t, l, r);
  let z = 0;
  while (opts) {
    const u = 31 - Math.clz32(opts);
    opts ^= 1 << u;
    z += Math.exp(optionScore(m, hand, u, l, r) - st);
  }
  return -Math.log(z);
}

export interface SeatEvents {
  seat: number;
  tiles: number[];
  l: number[];
  r: number[];
  /** later[k] = mask of tiles this seat played at events k..end. */
  later: number[];
}

/** Collect the non-opening plays of every other seat in the current hand. */
export function collectEvents(v: PlayerView): SeatEvents[] {
  const out: SeatEvents[] = [];
  for (let d = 1; d < 4; d++) {
    const seat = (v.seat + d) & 3;
    const ev: SeatEvents = { seat, tiles: [], l: [], r: [], later: [] };
    for (const e of v.log) {
      if (e.t !== 'play' || e.seat !== seat || !e.ends) continue;
      ev.tiles.push(e.id);
      ev.l.push(e.ends[0]);
      ev.r.push(e.ends[1]);
    }
    let acc = 0;
    for (let k = ev.tiles.length - 1; k >= 0; k--) {
      acc |= 1 << ev.tiles[k];
      ev.later[k] = acc;
    }
    if (ev.tiles.length) out.push(ev);
  }
  return out;
}

/** Log-likelihood of all observed plays given the sampled current hands. */
export function logLik(evs: SeatEvents[], hands: Int32Array, models: PlayModel[]): number {
  let ll = 0;
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    const m = models[ev.seat];
    const cur = hands[ev.seat];
    for (let k = 0; k < ev.tiles.length; k++) ll += logChoice(m, cur | ev.later[k], ev.tiles[k], ev.l[k], ev.r[k]);
  }
  return ll;
}
