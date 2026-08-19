import { useId, type ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The headline figures at the top of the control board.
 *
 * Richer than `StatCard`, which fronts the admin list screens: this one carries a
 * second line of *movement* — a signed delta against the comparable previous
 * window, or a fill bar against a capacity — because the top of a monitoring
 * board has to answer "and which way is it going?" without scrolling. That is
 * the whole reason the board's pulse row is not just five `StatCard`s.
 *
 * `accent` is a raw CSS colour rather than a tone keyword so a caller can pass a
 * fest domain hue straight from `DOMAIN_COLOR` and have the card, its icon tile,
 * and its corner glow agree. It tints only decoration; every figure and label
 * stays on `text-ink` / `text-muted` at full contrast, so the card never depends
 * on its accent being legible.
 */

export interface KpiDelta {
  /** Percent change. `null` when there is no comparable previous window. */
  percent: number | null;
  /** What it is measured against, e.g. "vs the previous hour". */
  label: string;
  /** When true, a rise is bad — queues, backlogs, failures. */
  inverted?: boolean;
}

export function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
  footnote,
  delta,
  progress,
  className,
}: {
  icon: LucideIcon;
  label: string;
  /** Pre-formatted. Pass "—" for anything that could not be read. */
  value: ReactNode;
  /** Any CSS colour, e.g. `DOMAIN_COLOR.hostels` or `var(--color-success)`. */
  accent: string;
  footnote?: ReactNode;
  /** Movement against the previous comparable window. */
  delta?: KpiDelta;
  /** A fill readout instead of a delta, e.g. seats taken of seats available. */
  progress?: { value: number; max: number; label: string; caption?: ReactNode };
  className?: string;
}) {
  const labelId = useId();

  return (
    // A named group, so the row is navigable card by card rather than as a run of
    // loose text: assistive tech reads "On campus now, 1,284, of 6,600 registered"
    // as one unit. `role="group"` rather than <section>, which would put five
    // entries in the landmark list.
    //
    // Two elements, not one, and this is the project's standing rule rather than a
    // preference: hover hit-testing uses an element's *transformed* box, so a card
    // that lifts itself slides out from under a cursor resting near its edge, loses
    // hover, drops back, and vibrates. The stable outer box owns `:hover`; the
    // inner one carries the lift through `group-hover`. `Card` is built the same
    // way, and `hoverStability.test.tsx` enforces it across the tree.
    <div role="group" aria-labelledby={labelId} className={cn('group relative', className)}>
      <div className="glass-panel relative isolate flex h-full flex-col gap-3 overflow-hidden rounded-3xl p-5 transition-transform duration-300 group-hover:-translate-y-0.5">
        {/* The reference's signature: a soft orb of the card's accent bleeding in
            from the corner, brightening on hover. Behind the content and inert. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 -z-10 h-28 w-28 rounded-full opacity-[0.14] blur-2xl transition-opacity duration-300 group-hover:opacity-25"
          style={{ background: accent }}
        />
        {/* A single highlight sweep on hover. Decorative, and it re-runs on each
            hover because the animation is attached to the group-hover state. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 -z-10 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-0 group-hover:animate-sheen group-hover:opacity-100"
        />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              id={labelId}
              className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted"
            >
              {label}
            </p>
            <p className="mt-1 text-3xl font-black leading-none tabular-nums text-ink">{value}</p>
          </div>
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: `color-mix(in srgb, ${accent} 12%, transparent)`,
              color: accent,
              // An inset shadow rather than a `ring-1` utility: the ring colour
              // has to be derived from the runtime accent, and a box-shadow takes
              // that without reaching for a Tailwind CSS variable by hand.
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 22%, transparent)`,
            }}
          >
            <Icon size={19} strokeWidth={2.1} />
          </span>
        </div>

        {/* One movement line per card, and the height is reserved either way so a
            row of cards stays aligned when only some of them have one. */}
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {progress ? (
            <ProgressFooter accent={accent} {...progress} />
          ) : delta ? (
            <DeltaFooter {...delta} />
          ) : null}
          {footnote && <span className="text-muted">{footnote}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * A signed percent change with a direction arrow.
 *
 * The arrow and the sign carry the direction; colour only reinforces it, so the
 * card survives greyscale. `inverted` flips which direction counts as good
 * without changing which way the arrow points — a growing backlog still points
 * up, it is just no longer green.
 */
function DeltaFooter({ percent, label, inverted = false }: KpiDelta) {
  if (percent === null) {
    return <span className="text-muted">{label}</span>;
  }

  const rounded = Math.round(percent);
  const flat = rounded === 0;
  const rising = rounded > 0;
  const good = flat ? null : inverted ? !rising : rising;
  const Arrow = flat ? Minus : rising ? TrendingUp : TrendingDown;

  return (
    <>
      <span
        className={cn(
          'inline-flex items-center gap-1 font-semibold tabular-nums',
          good === null ? 'text-muted' : good ? 'text-success' : 'text-danger',
        )}
      >
        <Arrow size={14} strokeWidth={2.5} aria-hidden />
        {flat ? 'No change' : `${rising ? '+' : ''}${rounded}%`}
      </span>
      <span className="text-muted">{label}</span>
    </>
  );
}

/** A capacity readout: the share as text, then the bar it describes. */
function ProgressFooter({
  value,
  max,
  label,
  caption,
  accent,
}: {
  value: number;
  max: number;
  label: string;
  caption?: ReactNode;
  accent: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <>
      <span className="font-semibold tabular-nums text-ink">{Math.round(percent)}%</span>
      <span className="text-muted">{caption ?? label}</span>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value.toLocaleString()} of ${max.toLocaleString()}`}
        className="ml-auto h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${percent}%`, background: accent }}
        />
      </div>
    </>
  );
}
