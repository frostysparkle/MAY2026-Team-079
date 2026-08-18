import { useId } from 'react';
import { DOMAIN_COLOR, type Domain } from './domain';

/**
 * A trend line for a single series — check-ins over 24 hours, registrations per
 * day, revenue per day.
 *
 * Deliberately axis-less. A sparkline answers "which way is this going, and how
 * hard", and gridlines and tick labels at this size cost more than they add. The
 * numbers themselves belong in the caption the caller renders beside it.
 *
 * Drawn as `preserveAspectRatio="none"` inside a fixed viewBox so the shape
 * stretches to whatever width the panel gives it without the caller having to
 * measure anything — but the endpoint dot is drawn in a second, unstretched
 * layer, because a scaled circle becomes an ellipse.
 */

export interface SparkPoint {
  /** Axis label, e.g. an hour or a date. Used by the accessible summary only. */
  label: string;
  value: number;
}

const VIEW_W = 100;
const VIEW_H = 32;

export function Sparkline({
  points,
  domain = 'hostels',
  label,
  height = 48,
  caption,
}: {
  points: SparkPoint[];
  domain?: Domain;
  /** Accessible name, e.g. "Hostel check-ins over 24 hours". */
  label: string;
  height?: number;
  /** Optional line under the chart, e.g. "47 in the last hour". */
  caption?: string;
}) {
  const gradientId = useId();
  const color = DOMAIN_COLOR[domain];

  // One point cannot describe a trend, and zero points must not divide by zero.
  if (points.length < 2) {
    return (
      <div
        className="flex items-center text-xs text-muted"
        style={{ height }}
        role="img"
        aria-label={`${label}: not enough data to show a trend`}
      >
        Not enough data yet
      </div>
    );
  }

  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // A flat series would otherwise divide by zero and collapse to the top edge;
  // drawing it through the middle is the honest picture of "no change".
  const span = max - min || 1;

  const xAt = (i: number) => (i / (points.length - 1)) * VIEW_W;
  const yAt = (v: number) => VIEW_H - ((v - min) / span) * (VIEW_H - 4) - 2;

  const line = points.map((p, i) => `${xAt(i).toFixed(2)},${yAt(p.value).toFixed(2)}`).join(' L ');
  const area = `M ${line} L ${VIEW_W},${VIEW_H} L 0,${VIEW_H} Z`;

  const last = points[points.length - 1];
  const endLeft = `${(xAt(points.length - 1) / VIEW_W) * 100}%`;
  const endTop = `${(yAt(last.value) / VIEW_H) * 100}%`;

  return (
    <figure className="m-0">
      <div className="relative w-full" style={{ height }}>
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`${label}. From ${points[0].value} at ${points[0].label} to ${last.value} at ${last.label}. Range ${min} to ${max}.`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={`M ${line}`}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Outside the stretched SVG so it stays a circle at any panel width. */}
        <span
          aria-hidden
          className="pointer-events-none absolute block h-[7px] w-[7px] rounded-full ring-2 ring-surface"
          style={{
            background: color,
            left: endLeft,
            top: endTop,
            transform: 'translate(-50%, -50%)',
          }}
        />
      </div>
      {caption && (
        <figcaption className="mt-1 text-xs tabular-nums text-muted">{caption}</figcaption>
      )}
    </figure>
  );
}
