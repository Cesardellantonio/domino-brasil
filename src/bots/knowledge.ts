import { ALL_TILES, hasNum } from '../engine/tiles';
import { PlayerView } from '../engine/view';
import { tilesOnTable } from '../engine/game';
import { Rng } from '../lib/rng';

/** What a seat can deduce about hidden tiles from public information. */
export interface Knowledge {
  me: number;
  n: number;
  /** Tiles not in my hand and not on the table. */
  unseen: number[];
  /** Bitmask per seat of numbers the seat is known NOT to hold (it passed on them). */
  voids: number[];
  counts: number[];
  boneyard: number;
}

export function buildKnowledge(v: PlayerView): Knowledge {
  const known = new Set<number>(v.myHand);
  for (const p of tilesOnTable(v as any)) known.add(p.id);
  const unseen = ALL_TILES.map((t) => t.id).filter((id) => !known.has(id));
  const voids = new Array(v.n).fill(0);
  for (const e of v.log) {
    if (e.t === 'pass' && e.ends) voids[e.seat] |= (1 << e.ends[0]) | (1 << e.ends[1]);
  }
  return { me: v.seat, n: v.n, unseen, voids, counts: v.counts.slice(), boneyard: v.boneyard };
}

export const inMask = (mask: number, n: number) => (mask & (1 << n)) !== 0;

const allowed = (k: Knowledge, seat: number, id: number) => {
  const t = ALL_TILES[id];
  return !inMask(k.voids[seat], t.a) && !inMask(k.voids[seat], t.b);
};

/**
 * Sample a full deal of the hidden tiles consistent with the counts and known voids.
 * Returns hands for every seat (mine included) and a boneyard.
 */
export function sampleDeal(k: Knowledge, myHand: number[], rng: Rng): { hands: number[][]; boneyard: number[] } {
  const others = [...Array(k.n).keys()].filter((s) => s !== k.me);
  for (let attempt = 0; attempt < 60; attempt++) {
    const res = trySample(k, others, rng, attempt < 50);
    if (res) {
      res.hands[k.me] = myHand.slice();
      return res;
    }
  }
  throw new Error('sampling failed'); // unreachable: the last attempts ignore constraints
}

function trySample(k: Knowledge, others: number[], rng: Rng, respect: boolean) {
  const cap: number[] = new Array(k.n).fill(0);
  for (const s of others) cap[s] = k.counts[s];
  let boneCap = k.boneyard;
  const hands: number[][] = Array.from({ length: k.n }, () => []);
  const boneyard: number[] = [];

  // Most-constrained tiles first, random tie-break.
  const tiles = k.unseen
    .map((id) => {
      let opts = 0;
      for (const s of others) if (!respect || allowed(k, s, id)) opts++;
      return { id, opts, r: rng() };
    })
    .sort((a, b) => a.opts - b.opts || a.r - b.r);

  for (const { id } of tiles) {
    let total = boneCap;
    for (const s of others) if (cap[s] > 0 && (!respect || allowed(k, s, id))) total += cap[s];
    if (total === 0) return null;
    let x = rng() * total;
    let placed = false;
    for (const s of others) {
      if (cap[s] > 0 && (!respect || allowed(k, s, id))) {
        x -= cap[s];
        if (x < 0) {
          hands[s].push(id);
          cap[s]--;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      boneyard.push(id);
      boneCap--;
    }
  }
  return { hands, boneyard };
}

/** Count of unseen tiles containing number n. */
export const unseenWith = (k: Knowledge, n: number) => k.unseen.reduce((c, id) => c + (hasNum(id, n) ? 1 : 0), 0);
