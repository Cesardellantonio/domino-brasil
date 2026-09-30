// Ranks strategies from results/tournament/*.json: total win rate + Bradley-Terry (Elo) fit.
import { readdirSync, readFileSync } from 'node:fs';
const dir = 'results/tournament';
const games = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')));
const ids = [...new Set(games.flatMap((g) => [g.raw.a, g.raw.b]))];
const stat = Object.fromEntries(ids.map((id) => [id, { w: 0, n: 0, pen: 0, ms: [] }]));
const W = {}; // W[a][b] = wins of a over b
for (const id of ids) W[id] = Object.fromEntries(ids.map((x) => [x, 0]));
for (const g of games) {
  const { a, b, matches, aWins, pointDiff } = g.raw;
  stat[a].w += aWins; stat[a].n += matches; stat[a].pen += pointDiff;
  stat[b].w += matches - aWins; stat[b].n += matches; stat[b].pen -= pointDiff;
  stat[a].ms.push(g.aMsPerMove); stat[b].ms.push(g.bMsPerMove);
  W[a][b] += aWins; W[b][a] += matches - aWins;
}
// Bradley-Terry via MM iterations
let p = Object.fromEntries(ids.map((id) => [id, 1]));
for (let it = 0; it < 500; it++) {
  const np = {};
  for (const i of ids) {
    const wins = ids.reduce((s, j) => s + W[i][j], 0);
    const den = ids.reduce((s, j) => (j === i ? s : s + (W[i][j] + W[j][i]) / (p[i] + p[j])), 0);
    np[i] = wins / den;
  }
  const g = Math.exp(ids.reduce((s, i) => s + Math.log(np[i]), 0) / ids.length);
  for (const i of ids) np[i] /= g;
  p = np;
}
const elo = (id) => Math.round(1500 + 400 * Math.log10(p[id]));
const rows = ids.map((id) => ({ id, elo: elo(id), winPct: +((100 * stat[id].w) / stat[id].n).toFixed(1), matches: stat[id].n, penaltyPerMatch: +(stat[id].pen / stat[id].n).toFixed(1), msPerMove: +(stat[id].ms.reduce((a, b) => a + b, 0) / stat[id].ms.length).toFixed(1) }))
  .sort((a, b) => b.elo - a.elo);
console.log('\nRANKING');
console.table(rows);
console.log('\nHEAD-TO-HEAD (row win % vs column)');
const hh = {};
for (const a of rows.map((r) => r.id)) {
  hh[a] = {};
  for (const b of rows.map((r) => r.id)) hh[a][b] = a === b ? '-' : W[a][b] + W[b][a] ? `${Math.round((100 * W[a][b]) / (W[a][b] + W[b][a]))}%` : '';
}
console.table(hh);
