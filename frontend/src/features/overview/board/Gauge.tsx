import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A ring gauge with a caption under its figure.
 *
 * `ProgressRing` in `components/ui` covers the inline case — a 44px ring beside a
 * table row, with a rounded percentage in the middle. This one exists for the
 * capacity board's drill-in, where the ring is the largest thing on the panel and
 * has to carry a figure at headline size plus a word saying what it measures.
 * Bolting both jobs onto one component would mean a `size` prop that silently
 * changes the internal type scale.
 *
 * `value === null` draws an empty track and a dash rather than a zero-length arc,
 * which is the difference between "we could not read this" and "it is empty".
 */
export function Gauge({
  value,
  max,
  label,
  figure,
  caption,
  color,
  size = 104,
  thickness = 8,
  className,
}: {
  /** `null` when the figure could not be read. */
  value: number | null;
  max: number;
  /** Accessible name, e.g. "Alakananda occupancy". */
  label: string;
  /** Large text in the middle. Pre-formatted, e.g. "94%" or "—". */
  figure: ReactNode;
  /** Small caps line under the figure, e.g. "Full". */
  caption: string;
  /** Any CSS colour for the arc. */
  color: string;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const percent = value === null || max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // The arc is drawn by hiding part of a full circle rather than by animating a
  // path, so it stays crisp at any size.
  const offset = circumference * (1 - percent / 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      aria-valuetext={
        value === null
          ? 'Could not be read'
          : `${Math.round(percent)} percent, ${value.toLocaleString()} of ${max.toLocaleString()}`
      }
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        {/* Rotated so the arc starts at 12 o'clock instead of 3 o'clock. */}
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            className="stroke-surface-2"
          />
          {value !== null && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-700"
            />
          )}
        </g>
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black leading-none tabular-nums text-ink">{figure}</span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
          {caption}
        </span>
      </span>
    </div>
  );
}
