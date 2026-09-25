import { Placed } from '../engine/game';
import { isDouble } from '../engine/tiles';

/**
 * Snake layout for the line of play. Units: a tile is 2 x 1. The root sits at the
 * origin; the right arm runs right then snakes downward, the left arm runs left then
 * snakes upward, so the arms never collide. Doubles are laid crosswise.
 */

export interface Laid {
  id: number;
  x: number; // center, in tile units
  y: number;
  rot: number; // rotation of the canonical vertical tile, degrees
  top: number; // value shown on the canonical top half
  bottom: number;
  seat: number;
}

type V = { x: number; y: number };
const GAP = 0.06;

interface Arm {
  p: V; // open connection point (center line, at the tile edge)
  dir: V;
  run: 'h' | 'v';
  hdir: V; // last horizontal direction
  vdir: V; // direction this arm snakes vertically
  vTravel: number;
  lastHalfW: number; // perpendicular half-width of the last tile
}

const rotFor = (d: V) => (d.x === 1 ? -90 : d.x === -1 ? 90 : d.y === 1 ? 0 : 180);

function place(arm: Arm, pl: Placed, maxX: number): Laid {
  const dbl = isDouble(pl.id);
  const len = dbl ? 1 : 2;
  let { p, dir } = arm;

  let turnTo: V | null = null;
  if (arm.run === 'h') {
    const far = p.x + dir.x * (GAP + len);
    if (Math.abs(far) > maxX) turnTo = arm.vdir;
  } else if (arm.vTravel >= 2) {
    turnTo = { x: -arm.hdir.x, y: 0 };
  }

  if (turnTo) {
    // New tile's end touches the side of the previous tile's outer half.
    p = {
      x: p.x - dir.x * 0.5 + turnTo.x * (arm.lastHalfW + GAP),
      y: p.y - dir.y * 0.5 + turnTo.y * (arm.lastHalfW + GAP),
    };
    dir = turnTo;
    if (dir.y === 0) {
      arm.run = 'h';
      arm.hdir = dir;
    } else {
      arm.run = 'v';
      arm.vTravel = 0;
    }
  } else {
    p = { x: p.x + dir.x * GAP, y: p.y + dir.y * GAP };
  }

  const c = { x: p.x + (dir.x * len) / 2, y: p.y + (dir.y * len) / 2 };
  arm.p = { x: p.x + dir.x * len, y: p.y + dir.y * len };
  arm.dir = dir;
  arm.lastHalfW = dbl ? 1 : 0.5;
  if (arm.run === 'v') arm.vTravel += len;

  if (dbl) return { id: pl.id, x: c.x, y: c.y, rot: dir.y === 0 ? 0 : 90, top: pl.inner, bottom: pl.inner, seat: pl.seat };
  return { id: pl.id, x: c.x, y: c.y, rot: rotFor(dir), top: pl.inner, bottom: pl.outer, seat: pl.seat };
}

export interface BoardLayout {
  tiles: Laid[];
  arms: { L: Arm; R: Arm } | null;
}

export function layoutBoard(root: Placed | null, left: Placed[], right: Placed[], maxX: number): BoardLayout {
  if (!root) return { tiles: [], arms: null };
  const dbl = isDouble(root.id);
  const half = dbl ? 0.5 : 1;
  const tiles: Laid[] = [
    dbl
      ? { id: root.id, x: 0, y: 0, rot: 0, top: root.inner, bottom: root.inner, seat: root.seat }
      : { id: root.id, x: 0, y: 0, rot: -90, top: root.inner, bottom: root.outer, seat: root.seat },
  ];
  const lw = dbl ? 1 : 0.5;
  const R: Arm = { p: { x: half, y: 0 }, dir: { x: 1, y: 0 }, run: 'h', hdir: { x: 1, y: 0 }, vdir: { x: 0, y: 1 }, vTravel: 0, lastHalfW: lw };
  const L: Arm = { p: { x: -half, y: 0 }, dir: { x: -1, y: 0 }, run: 'h', hdir: { x: -1, y: 0 }, vdir: { x: 0, y: -1 }, vTravel: 0, lastHalfW: lw };
  for (const pl of right) tiles.push(place(R, pl, maxX));
  for (const pl of left) tiles.push(place(L, pl, maxX));
  return { tiles, arms: { L, R } };
}

/** Where a tile would land if played on a side (for the glowing target). */
export function ghostFor(layout: BoardLayout, side: 'L' | 'R', pl: Placed, maxX: number): Laid {
  if (!layout.arms) {
    const dbl = isDouble(pl.id);
    return { id: pl.id, x: 0, y: 0, rot: dbl ? 0 : -90, top: pl.inner, bottom: pl.outer, seat: pl.seat };
  }
  const arm = layout.arms[side];
  const copy: Arm = { ...arm, p: { ...arm.p }, dir: { ...arm.dir }, hdir: { ...arm.hdir }, vdir: { ...arm.vdir } };
  return place(copy, pl, maxX);
}

/** Axis-aligned extent of a laid tile (half sizes). */
export function extent(t: Laid): { hw: number; hh: number } {
  const vertical = t.rot === 0 || t.rot === 180;
  return vertical ? { hw: 0.5, hh: 1 } : { hw: 1, hh: 0.5 };
}
