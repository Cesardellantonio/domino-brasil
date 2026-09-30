import { Move } from '../../engine/game';
import { PlayerView } from '../../engine/view';
import { chooseMove } from '../bots';
import { Rng } from '../../lib/rng';
import { Strategy } from './types';
import { matchWin } from './agent3-match';
import { A, B, DBL, H, PIPS, other, pipsM, rollout, seedX, setUtility } from './agent3-search';

// ------------------------------------------------------------------ tunables

export const P3 = {
  budgetFrac: 0.7,
  maxSamples: 4000,
  solveAt: 10,
  // inference
  inference: true,
  createdOpp: 1.25,
  createdPartner: 1.45,
  openOpp: 1.3,
  openPartner: 1.9,
  // signalling on free openings (partner reads it)
  signalBias: 0.004,
};

export const STATS = { decisions: 0, samples: 0, minSamples: 1e9, overBudget: 0, maxMs: 0, log: [] as number[][] };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ knowledge & inference

interface Info {
  me: number;
  unseen: number[]; // tile ids
  voids: number[]; // per seat: bitmask of numbers the seat lacks
  counts: number[];
  /** Per seat, per tile weight (likelihood multiplier) used by the sampler. */
  w: Float64Array[];
}

function buildInfo(v: PlayerView): Info {
  const me = v.seat;
  let known = 0;
  for (const id of v.myHand) known |= 1 << id;
  if (v.root) known |= 1 << v.root.id;
  for (const p of v.left) known |= 1 << p.id;
  for (const p of v.right) known |= 1 << p.id;
  const unseen: number[] = [];
  for (let id = 0; id < 28; id++) if (!(known & (1 << id))) unseen.push(id);
  const voids = [0, 0, 0, 0];
  const numW = [0, 1, 2, 3].map(() => [1, 1, 1, 1, 1, 1, 1]);
  const partner = (me + 2) & 3;
  for (let i = 0; i < v.log.length; i++) {
    const e = v.log[i];
    if (e.t === 'pass') {
      if (e.ends) voids[e.seat] |= (1 << e.ends[0]) | (1 << e.ends[1]);
      continue;
    }
    if (e.t !== 'play' || e.seat === me || !P3.inference) continue;
    const isP = e.seat === partner;
    if (!e.ends) {
      // Opening. On the first hand the 6-6 is forced: no information.
      if (v.handNo === 0 && e.id === 27) continue;
      const f = isP ? P3.openPartner : P3.openOpp;
      numW[e.seat][A[e.id]] *= f;
      if (!DBL[e.id]) numW[e.seat][B[e.id]] *= f;
      continue;
    }
    if (DBL[e.id]) continue;
    const end = e.side === 'L' ? e.ends[0] : e.ends[1];
    const created = other(e.id, end);
    numW[e.seat][created] *= isP ? P3.createdPartner : P3.createdOpp;
  }
  const w: Float64Array[] = [];
  for (let s = 0; s < 4; s++) {
    const ws = new Float64Array(28);
    for (let id = 0; id < 28; id++) ws[id] = DBL[id] ? numW[s][A[id]] : numW[s][A[id]] * numW[s][B[id]];
    w.push(ws);
  }
  return { me, unseen, voids, counts: v.counts.slice(), w };
}

const allowed = (inf: Info, s: number, id: number) => !(inf.voids[s] & ((1 << A[id]) | (1 << B[id])));

/** Sample hidden hands (as masks) into SH for the three other seats. */
const SH = [0, 0, 0, 0];
const order: number[] = [];
const keys: number[] = [];
function sampleDeal(inf: Info, myMask: number, rng: Rng): void {
  const others = [(inf.me + 1) & 3, (inf.me + 2) & 3, (inf.me + 3) & 3];
  const n = inf.unseen.length;
  for (let attempt = 0; attempt < 40; attempt++) {
    const respect = attempt < 30;
    const useW = attempt < 20;
    // order: most constrained first, random tie-break
    order.length = 0;
    keys.length = 0;
    for (let i = 0; i < n; i++) {
      const id = inf.unseen[i];
      let opts = 0;
      for (const s of others) if (!respect || allowed(inf, s, id)) opts++;
      order.push(i);
      keys[i] = opts + rng();
    }
    order.sort((x, y) => keys[x] - keys[y]);
    const cap = [0, 0, 0, 0];
    for (const s of others) cap[s] = inf.counts[s];
    SH[0] = SH[1] = SH[2] = SH[3] = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const id = inf.unseen[order[k]];
      let total = 0;
      for (const s of others) if (cap[s] > 0 && (!respect || allowed(inf, s, id))) total += cap[s] * (useW ? inf.w[s][id] : 1);
      if (total <= 0) {
        ok = false;
        break;
      }
      let x = rng() * total;
      let chosen = -1;
      for (const s of others) {
        if (cap[s] > 0 && (!respect || allowed(inf, s, id))) {
          chosen = s;
          x -= cap[s] * (useW ? inf.w[s][id] : 1);
          if (x < 0) break;
        }
      }
      SH[chosen] |= 1 << id;
      cap[chosen]--;
    }
    if (ok) {
      SH[inf.me] = myMask;
      return;
    }
  }
  // Unreachable in practice; deal without constraints.
  SH[0] = SH[1] = SH[2] = SH[3] = 0;
  const cap = inf.counts.slice();
  cap[inf.me] = 0;
  let si = 0;
  for (const id of inf.unseen) {
    while (cap[others[si]] === 0) si++;
    SH[others[si]] |= 1 << id;
    cap[others[si]]--;
  }
  SH[inf.me] = myMask;
}

// ------------------------------------------------------------------ decision

type Play = Move & { t: 'play' };

function dedupe(v: PlayerView): Move[] {
  const seen = new Set<number>();
  return v.legal.filter((m) => {
    if (m.t !== 'play' || !v.ends || v.ends[0] !== v.ends[1]) return true;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

function standard(v: PlayerView) {
  return v.n === 4 && v.rules.mode === 'duplas' && v.rules.scoring === 'pips' && v.rules.targetScore === 100 && v.boneyard === 0 && v.rules.blockedResolution === 'pairTotal';
}

const leafWin = (me: number) => {
  return uWinG[Math.min(169, pipsM(H[(me + 1) & 3] | H[(me + 3) & 3]))];
};
let uWinG = new Float64Array(170);

export function choose(v: PlayerView, rng: Rng, budgetMs: number): Move {
  const moves = dedupe(v);
  if (moves.length === 1) return moves[0];
  if (!standard(v)) return chooseMove(v, 'hard', rng, budgetMs);
  const plays = moves.filter((m): m is Play => m.t === 'play');
  if (plays.length !== moves.length) return moves[0];

  const start = now();
  const me = v.seat;
  const myTeam = me & 1;
  const inf = buildInfo(v);
  let myMask = 0;
  for (const id of v.myHand) myMask |= 1 << id;

  // utility lookup tables for this decision
  const us = v.scores[myTeam];
  const them = v.scores[1 - myTeam];
  const mult = v.multiplier;
  const uWin = new Float64Array(170);
  const uLose = new Float64Array(170);
  for (let p = 0; p < 170; p++) {
    uWin[p] = matchWin(us, them + p * mult, 1);
    uLose[p] = matchWin(us + p * mult, them, 0);
  }
  const uTie = 0.5 * (matchWin(us, them, 0) + matchWin(us, them, 1));
  uWinG = uWin;

  setUtility(myTeam, uWin, uLose, uTie);

  const nm = plays.length;
  const totals = new Float64Array(nm);
  // precompute candidate transitions
  const cl: number[] = [];
  const cr: number[] = [];
  for (const m of plays) {
    if (!v.ends) {
      cl.push(A[m.id]);
      cr.push(B[m.id]);
    } else if (m.side === 'L') {
      cl.push(other(m.id, v.ends[0]));
      cr.push(v.ends[1]);
    } else {
      cl.push(v.ends[0]);
      cr.push(other(m.id, v.ends[1]));
    }
  }
  const budget = Math.max(2, budgetMs * P3.budgetFrac);
  let samples = 0;
  seedX(Math.floor(rng() * 4294967295) | 1);
  while (samples < P3.maxSamples) {
    if (samples >= 8 && now() - start > budget) break;
    sampleDeal(inf, myMask, rng);
    for (let i = 0; i < nm; i++) {
      H[0] = SH[0];
      H[1] = SH[1];
      H[2] = SH[2];
      H[3] = SH[3];
      const id = plays[i].id;
      H[me] &= ~(1 << id);
      totals[i] += H[me] === 0 ? leafWin(me) : rollout(cl[i], cr[i], (me + 1) & 3, 0, P3.solveAt);
    }
    samples++;
  }
  const el = now() - start;
  STATS.decisions++;
  STATS.samples += samples;
  if (samples < STATS.minSamples) STATS.minSamples = samples;
  if (el > budgetMs) {
    STATS.overBudget++;
    if (STATS.log.length < 30) STATS.log.push([Math.round(el), samples, nm, v.myHand.length, v.counts.reduce((a, b) => a + b, 0)]);
  }
  if (el > STATS.maxMs) STATS.maxMs = el;
  let best = 0;
  let bestSc = -Infinity;
  for (let i = 0; i < nm; i++) {
    let sc = totals[i] / samples;
    // tiny tie-break: dump pips
    sc += PIPS[plays[i].id] * 1e-5;
    if (sc > bestSc) {
      bestSc = sc;
      best = i;
    }
  }
  return plays[best];
}

export const agent3: Strategy = {
  id: 'agent3',
  name: 'Parceiro',
  description:
    'Partnership Monte Carlo: samples hidden hands weighted by what each seat revealed (opening lead, numbers it keeps creating, passes; ' +
    'the partner follows the same conventions so its signals are read more strongly), plays out each candidate with a cooperative ' +
    'greedy policy (make the next opponent pass, keep the partner alive, lock only when the pair is lighter), and scores outcomes by ' +
    'the match-win probability of the race to 100.',
  choose,
};
