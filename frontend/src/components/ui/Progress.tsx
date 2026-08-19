import { cn } from '@/lib/cn';

/**
 * Progress indicators for "how full is this?" readouts.
 *
 * Both take a value and a max rather than a pre-computed percentage, so the
 * accessible `progressbar` role can report the real numbers (`120 of 300`)
 * instead of a rounded percent that hides the underlying count. Rounding for
 * display happens here, once.
 */

type Tone = 'brand' | 'success' | 'warning' | 'danger';

const trackTone: Record<Tone, string> = {
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const strokeTone: Record<Tone, string> = {
  brand: 'stroke-brand',
  success: 'stroke-success',
  warning: 'stroke-warning',
  danger: 'stroke-danger',
};

/** Clamp to 0–100 so bad data can never paint outside the track. */
function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function ProgressBar({
  value,
  max,
  tone = 'brand',
  label,
  className,
}: {
  value: number;
  max: number;
  tone?: Tone;
  /** Accessible name, e.g. "Alakananda occupancy". */
  label: string;
  className?: string;
}) {
  const percent = percentOf(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${max}`}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', trackTone[tone])}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * Ring gauge with the rounded percentage in the middle. Sized in px because it
 * is drawn as an SVG circle whose geometry has to agree with the box.
 */
export function ProgressRing({
  value,
  max,
  tone = 'brand',
  label,
  size = 44,
  thickness = 4,
  className,
}: {
  value: number;
  max: number;
  tone?: Tone;
  label: string;
  size?: number;
  thickness?: number;
  className?: string;
}) {
  const percent = percentOf(value, max);
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
      aria-valuenow={value}
      aria-valuetext={`${Math.round(percent)} percent, ${value} of ${max}`}
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
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={cn('transition-[stroke-dashoffset] duration-500', strokeTone[tone])}
          />
        </g>
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-ink">
        {Math.round(percent)}%
      </span>
    </div>
  );
}
