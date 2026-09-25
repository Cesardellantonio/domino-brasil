import { memo } from 'react';

/** Pip positions in a half-tile, relative to the half's center, for a vertical tile. */
const P = 25;
const Q = 26;
const PIPS: [number, number][][] = [
  [],
  [[0, 0]],
  [[-P, -Q], [P, Q]],
  [[-P, -Q], [0, 0], [P, Q]],
  [[-P, -Q], [P, -Q], [-P, Q], [P, Q]],
  [[-P, -Q], [P, -Q], [0, 0], [-P, Q], [P, Q]],
  [[-P, -Q], [-P, 0], [-P, Q], [P, -Q], [P, 0], [P, Q]],
];

export const PIP_COLORS = ['#000', '#1f6fd6', '#15935a', '#d23a3a', '#8a41cf', '#e0861a', '#0b8a8a'];

/** Shared gradients: rendered once in the app root, referenced by every tile. */
export function TileDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="tileFace" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.55" stopColor="#f6f0e0" />
          <stop offset="1" stopColor="#e6dcc3" />
        </linearGradient>
        <linearGradient id="tileEdge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9cfb6" />
          <stop offset="1" stopColor="#a89c80" />
        </linearGradient>
        <radialGradient id="pip" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#4a4a4a" />
          <stop offset="0.6" stopColor="#141414" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <radialGradient id="pin" cx="0.35" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.5" stopColor="#caa64a" />
          <stop offset="1" stopColor="#7c5f1c" />
        </radialGradient>
        <linearGradient id="tileBack" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8e2436" />
          <stop offset="1" stopColor="#5a1321" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface FaceProps {
  top: number;
  bottom: number;
  colored?: boolean;
}

/** A vertical tile centered at 0,0 measuring 100 x 200 user units. */
export const TileFace = memo(function TileFace({ top, bottom, colored }: FaceProps) {
  return (
    <g>
      <rect x={-49} y={-99} width={98} height={198} rx={15} fill="url(#tileEdge)" />
      <rect x={-46} y={-96} width={92} height={188} rx={13} fill="url(#tileFace)" />
      <rect x={-40} y={-92} width={80} height={6} rx={3} fill="#fff" opacity={0.55} />
      <line x1={-32} x2={32} y1={-2} y2={-2} stroke="#b8ac90" strokeWidth={3.5} strokeLinecap="round" />
      <line x1={-32} x2={32} y1={1} y2={1} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" opacity={0.7} />
      <Half v={top} cy={-49} colored={colored} />
      <Half v={bottom} cy={47} colored={colored} />
      <circle cx={0} cy={-1} r={6.5} fill="url(#pin)" />
    </g>
  );
});

function Half({ v, cy, colored }: { v: number; cy: number; colored?: boolean }) {
  return (
    <>
      {PIPS[v].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={cy + y + 1.2} r={10} fill="#fff" opacity={0.8} />
          <circle cx={x} cy={cy + y} r={9.6} fill={colored ? PIP_COLORS[v] : 'url(#pip)'} />
          {colored && <circle cx={x - 3} cy={cy + y - 3} r={3} fill="#fff" opacity={0.35} />}
        </g>
      ))}
    </>
  );
}

export function TileBack() {
  return (
    <g>
      <rect x={-49} y={-99} width={98} height={198} rx={15} fill="#3d0c16" />
      <rect x={-45} y={-95} width={90} height={188} rx={12} fill="url(#tileBack)" />
      <rect x={-33} y={-83} width={66} height={164} rx={8} fill="none" stroke="#e7c36a" strokeWidth={3} opacity={0.55} />
      <circle r={13} fill="none" stroke="#e7c36a" strokeWidth={3} opacity={0.6} />
    </g>
  );
}

/** Standalone vertical tile (used in the hand and the result screens). */
export function TileSvg({ top, bottom, colored, className, back }: FaceProps & { className?: string; back?: boolean }) {
  return (
    <svg className={className} viewBox="-52 -102 104 208" aria-label={back ? 'tile' : `${top}-${bottom}`}>
      {back ? <TileBack /> : <TileFace top={top} bottom={bottom} colored={colored} />}
    </svg>
  );
}
