export interface Tile {
  id: number;
  a: number; // a <= b
  b: number;
}

export const ALL_TILES: Tile[] = (() => {
  const out: Tile[] = [];
  let id = 0;
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push({ id: id++, a, b });
  return out;
})();

export const TILE_COUNT = ALL_TILES.length; // 28

export const tile = (id: number): Tile => ALL_TILES[id];
export const isDouble = (id: number) => ALL_TILES[id].a === ALL_TILES[id].b;
export const pipsOf = (id: number) => ALL_TILES[id].a + ALL_TILES[id].b;
export const hasNum = (id: number, n: number) => ALL_TILES[id].a === n || ALL_TILES[id].b === n;
export const otherSide = (id: number, n: number) => (ALL_TILES[id].a === n ? ALL_TILES[id].b : ALL_TILES[id].a);

export function tileId(a: number, b: number): number {
  if (a > b) [a, b] = [b, a];
  return ALL_TILES.find((t) => t.a === a && t.b === b)!.id;
}

export const DOUBLE_SIX = tileId(6, 6);
