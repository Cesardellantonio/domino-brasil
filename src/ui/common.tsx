import { ReactNode, useMemo } from 'react';
import { TileSvg } from './Tile';

export function Sheet({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay sheet-overlay" onPointerDown={onClose}>
      <div className={`card sheet ${wide ? 'wide' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn ghost-btn dark" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.2,
        dur: 2.4 + Math.random() * 2,
        rot: Math.random() * 720 - 360,
        color: ['#f5c542', '#ff6b5a', '#3ddc97', '#4fa3ff', '#ffffff', '#b57bff'][i % 6],
        w: 6 + Math.random() * 7,
        drift: Math.random() * 160 - 80,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <i
          key={i}
          style={
            {
              left: `${b.left}%`,
              background: b.color,
              width: b.w,
              height: b.w * 0.45,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.dur}s`,
              '--rot': `${b.rot}deg`,
              '--drift': `${b.drift}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function Logo({ small }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`}>
      <div className="logo-tiles" aria-hidden>
        <TileSvg className="logo-tile a" top={6} bottom={6} />
        <TileSvg className="logo-tile b" top={3} bottom={5} />
      </div>
      <div className="logo-text">
        <span className="logo-word">Dominó</span>
        <span className="logo-sub">de Dupla · Brasil</span>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented ${disabled ? 'disabled' : ''}`}>
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: ReactNode }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <span>{label}</span>
      <button role="switch" aria-checked={on} className={on ? 'on' : ''} disabled={disabled} onClick={() => onChange(!on)}>
        <i />
      </button>
    </label>
  );
}
