import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Placed } from '../engine/game';
import { extent, ghostFor, Laid, layoutBoard } from './layout';
import { TileFace } from './Tile';

export interface Ghost {
  side: 'L' | 'R';
  placed: Placed;
  hint?: boolean;
}

interface Props {
  root: Placed | null;
  left: Placed[];
  right: Placed[];
  ghosts: Ghost[];
  onGhost: (side: 'L' | 'R') => void;
  /** Tile id that should animate in, and the screen direction it comes from. */
  enter: { id: number; dx: number; dy: number } | null;
  lastId: number | null;
  colored: boolean;
  /** Space reserved around the edges for seat badges (px). */
  pad: { top: number; right: number; bottom: number; left: number };
}

const U = 100; // user units per tile unit
const jitter = (id: number) => (((id * 7919) % 13) - 6) * 0.22;

export const Board = memo(function Board({ root, left, right, ghosts, onGhost, enter, lastId, colored, pad }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const availW = Math.max(50, size.w - pad.left - pad.right);
  const availH = Math.max(50, size.h - pad.top - pad.bottom);
  const aspect = availW / availH;
  const maxX = Math.min(10.5, Math.max(3.6, aspect * 4.8));

  const layout = useMemo(() => layoutBoard(root, left, right, maxX), [root, left, right, maxX]);
  const ghostTiles = useMemo(
    () => ghosts.map((g) => ({ g, t: ghostFor(layout, g.side, g.placed, maxX) })),
    [ghosts, layout, maxX],
  );

  // Fit: fixed horizontal extent (stable zoom), vertical extent grows with the snake.
  // Start zoomed in on a short line; ease out smoothly as it grows (camera transition).
  const minHalf = Math.min(maxX + 0.6, 6.5);
  let minY = -1.2;
  let maxY = 1.2;
  let minX = -minHalf;
  let maxXb = minHalf;
  for (const t of [...layout.tiles, ...ghostTiles.map((x) => x.t)]) {
    const e = extent(t);
    minY = Math.min(minY, t.y - e.hh - 0.3);
    maxY = Math.max(maxY, t.y + e.hh + 0.3);
    minX = Math.min(minX, t.x - e.hw - 0.3);
    maxXb = Math.max(maxXb, t.x + e.hw + 0.3);
  }
  const bw = maxXb - minX;
  const bh = Math.max(maxY - minY, 5);
  const maxPx = Math.min(70, Math.max(40, availH / 5.5));
  const scalePx = Math.min(availW / bw, availH / bh, maxPx);
  const s = scalePx / U;
  const cx = (minX + maxXb) / 2;
  const cy = (minY + maxY) / 2;
  const tx = pad.left + availW / 2 - cx * scalePx;
  const ty = pad.top + availH / 2 - cy * scalePx;

  return (
    <div className="board" ref={ref}>
      {size.w > 0 && (
        <svg width={size.w} height={size.h} className="board-svg">
          <g className="board-cam" style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
            {layout.tiles.map((t) => (
              <BoardTile key={t.id} t={t} colored={colored} last={t.id === lastId} enter={enter && enter.id === t.id ? enter : null} scale={s} />
            ))}
            {ghostTiles.map(({ g, t }) => (
              <g
                key={g.side + t.id}
                className={'ghost' + (g.hint ? ' hint' : '')}
                transform={`translate(${t.x * U} ${t.y * U})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onGhost(g.side);
                }}
              >
                <g transform={`rotate(${t.rot})`}>
                  <rect x={-58} y={-108} width={116} height={216} rx={20} className="ghost-glow" />
                  <g opacity={0.72}>
                    <TileFace top={t.top} bottom={t.bottom} colored={colored} />
                  </g>
                </g>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
});

const BoardTile = memo(function BoardTile({
  t,
  colored,
  last,
  enter,
  scale,
}: {
  t: Laid;
  colored: boolean;
  last: boolean;
  enter: { dx: number; dy: number } | null;
  scale: number;
}) {
  const e = extent(t);
  const style = enter ? ({ '--fx': `${enter.dx / scale}px`, '--fy': `${enter.dy / scale}px` } as React.CSSProperties) : undefined;
  return (
    <g transform={`translate(${t.x * U} ${t.y * U})`}>
      <g className={enter ? 'tile-enter' : undefined} style={style}>
        <rect
          x={-e.hw * U + 5}
          y={-e.hh * U + 9}
          width={e.hw * 2 * U - 2}
          height={e.hh * 2 * U - 4}
          rx={16}
          fill="rgba(0,0,0,0.32)"
          className="tile-shadow"
        />
        <g transform={`rotate(${t.rot + jitter(t.id)})`}>
          <TileFace top={t.top} bottom={t.bottom} colored={colored} />
          {last && <rect x={-51} y={-101} width={102} height={202} rx={16} className="last-glow" />}
        </g>
      </g>
    </g>
  );
});
