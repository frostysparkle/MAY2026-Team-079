import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { useElementWidth } from './useElementWidth';
import {
  labelIndices,
  polylineLength,
  trendGeometry,
  PLOT_PADDING,
  type TrendSeries,
} from './trendScale';

/**
 * The board's full-size trend chart: one or more series over a shared x axis,
 * with a zero-anchored y axis, gridlines, a hover crosshair, and a line that
 * draws itself in on arrival.
 *
 * **Why this is hand-rolled.** The app ships no charting library, and the five
 * chart primitives in `components/ui/charts` are all deliberately axis-less —
 * fine for a sparkline inside a panel, not enough for the deck an admin reads
 * figures off. Adding Chart.js for one screen would cost more bundle than this
 * file costs to maintain, and the board only needs a linear scale over evenly
 * spaced buckets.
 *
 * **Why pixels, not a scaled viewBox.** Axis labels are drawn at real sizes
 * against a measured width, so 10px ticks stay 10px on a phone and on a 27"
 * monitor. Scaling a fixed viewBox to fit — the trick `Sparkline` uses, where
 * there is no text — would make them illegible at one end and comic at the other.
 *
 * **Reading the data without seeing it.** The hover tooltip is a convenience,
 * not the interface: the chart also renders a visually-hidden table of every
 * bucket, and the plot is focusable so arrow keys walk the crosshair through the
 * points. A chart whose values are only obtainable by mouse-over is a chart half
 * the team cannot use.
 */
export function TrendChart({
  series,
  label,
  height = 240,
  /** Formats values in the tooltip, the y axis, and the hidden table. */
  format = (value) => value.toLocaleString(),
  /** Shown when there is not enough data to describe a trend. */
  emptyText = 'Not enough data yet',
  className,
}: {
  /** Every series must share the same x labels; the first one defines the axis. */
  series: TrendSeries[];
  label: string;
  height?: number;
  format?: (value: number) => string;
  emptyText?: string;
  className?: string;
}) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const gradientId = useId();
  const tableId = useId();
  const [active, setActive] = useState<number | null>(null);

  const axis = series[0]?.points ?? [];
  const drawable = series.filter((s) => s.points.length >= 2);

  const geometry = useMemo(() => {
    const max = Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value)));
    return trendGeometry(axis.length, max, width, height);
  }, [series, axis.length, width, height]);

  const shapes = useMemo(
    () =>
      drawable.map((s) => {
        const coordinates = s.points.map((point, index) => ({
          x: geometry.xAt(index),
          y: geometry.yAt(point.value),
        }));
        const line = coordinates.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' L ');
        const floor = PLOT_PADDING.top + geometry.plotHeight;
        return {
          series: s,
          coordinates,
          line: `M ${line}`,
          // Closed back along the baseline, so the fill sits under the line
          // rather than under the whole plot box.
          area: `M ${line} L ${coordinates[coordinates.length - 1].x.toFixed(1)},${floor} L ${coordinates[0].x.toFixed(1)},${floor} Z`,
          length: polylineLength(coordinates),
        };
      }),
    [drawable, geometry],
  );

  const ticksToLabel = useMemo(
    // Roughly one label per 90px of plot, so a half-width panel gets fewer than
    // a full-width deck instead of the same labels overlapping.
    () => labelIndices(axis.length, Math.max(2, Math.floor(geometry.plotWidth / 90))),
    [axis.length, geometry.plotWidth],
  );

  if (drawable.length === 0) {
    return (
      <div
        ref={wrapRef}
        className={cn('flex items-center justify-center text-xs text-muted', className)}
        style={{ height }}
        role="img"
        aria-label={`${label}: ${emptyText}`}
      >
        {emptyText}
      </div>
    );
  }

  // A single series gets a filled area; several get lines only, because four
  // overlapping translucent fills read as a fifth colour nobody chose.
  const filled = shapes.length === 1;
  const activePoint = active === null ? null : axis[active];
  // Flip the tooltip to the left of the crosshair once the crosshair is past the
  // midpoint, so it never hangs off the panel's right edge.
  const tooltipRight = active !== null && geometry.xAt(active) > geometry.width / 2;

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)} style={{ height }}>
      <svg
        width={geometry.width}
        height={height}
        className="block touch-pan-y"
        role="img"
        aria-label={`${label}. ${series
          .map((s) => {
            const values = s.points.map((p) => p.value);
            const total = values.reduce((sum, value) => sum + value, 0);
            return `${s.label}: ${format(total)} total, peaking at ${format(Math.max(0, ...values))}`;
          })
          .join('. ')}. Full figures in the table below.`}
        aria-describedby={tableId}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shapes[0].series.color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={shapes[0].series.color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Gridlines and y ticks. Drawn first so every series sits over them. */}
        {geometry.ticks.map((tick) => {
          const y = geometry.yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={PLOT_PADDING.left}
                x2={geometry.width - PLOT_PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth={1}
                // The baseline is a real axis; the rest are reading aids.
                strokeDasharray={tick === 0 ? undefined : '3 4'}
              />
              <text
                x={PLOT_PADDING.left - 8}
                y={y + 3.5}
                textAnchor="end"
                className="fill-[var(--color-muted)] text-[10px] tabular-nums"
              >
                {format(tick)}
              </text>
            </g>
          );
        })}

        {/* X labels, thinned to whatever fits. */}
        {ticksToLabel.map((index) => (
          <text
            key={index}
            x={geometry.xAt(index)}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === axis.length - 1 ? 'end' : 'middle'}
            className="fill-[var(--color-muted)] text-[10px] tabular-nums"
          >
            {axis[index].label}
          </text>
        ))}

        {filled && <path d={shapes[0].area} fill={`url(#${gradientId})`} />}

        {shapes.map((shape) => (
          <path
            key={shape.series.key}
            d={shape.line}
            fill="none"
            stroke={shape.series.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-draw"
            style={{
              strokeDasharray: shape.length,
              // Consumed by the `draw` keyframe in index.css, which retracts the
              // dash offset from here to zero.
              ['--draw-length' as string]: `${shape.length}`,
            }}
          />
        ))}

        {/* Crosshair and the value dots that go with it. */}
        {active !== null && (
          <g pointerEvents="none">
            <line
              x1={geometry.xAt(active)}
              x2={geometry.xAt(active)}
              y1={PLOT_PADDING.top}
              y2={PLOT_PADDING.top + geometry.plotHeight}
              stroke="var(--color-input)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {shapes.map((shape) => {
              const point = shape.series.points[active];
              if (point === undefined) return null;
              return (
                <circle
                  key={shape.series.key}
                  cx={geometry.xAt(active)}
                  cy={geometry.yAt(point.value)}
                  r={4}
                  fill={shape.series.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              );
            })}
          </g>
        )}
      </svg>

      {/*
        The interaction surface. A button rather than a bare div so it is in the
        tab order and announces itself, with arrow keys walking the crosshair —
        the keyboard equivalent of dragging along the line. It carries no label of
        its own; the SVG above and the table below are what get read.
      */}
      <button
        type="button"
        aria-label={`${label}: move through the data points`}
        className="absolute inset-0 cursor-crosshair rounded-xl"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setActive(geometry.indexAt(event.clientX - bounds.left));
        }}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onFocus={() => setActive((current) => current ?? axis.length - 1)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          setActive((current) => {
            const from = current ?? axis.length - 1;
            const next = event.key === 'ArrowLeft' ? from - 1 : from + 1;
            return Math.min(axis.length - 1, Math.max(0, next));
          });
        }}
      />

      {active !== null && activePoint && (
        <div
          // `aria-hidden` because the focused button already announces the
          // active value through the table it points at; a live tooltip would
          // double every reading.
          aria-hidden
          className="pointer-events-none absolute top-2 z-10 min-w-32 rounded-xl bg-ink/92 px-3 py-2 text-white shadow-lift backdrop-blur-sm"
          style={
            tooltipRight
              ? { right: Math.max(8, geometry.width - geometry.xAt(active) + 12) }
              : { left: Math.max(8, geometry.xAt(active) + 12) }
          }
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            {activePoint.label}
          </p>
          <ul className="mt-1 flex list-none flex-col gap-0.5 p-0">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-xs">
                <span
                  className="block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="text-white/80">{s.label}</span>
                <b className="ml-auto font-semibold tabular-nums">
                  {format(s.points[active]?.value ?? 0)}
                </b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The real accessible payload: every bucket, as a table. */}
      <table id={tableId} className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Point</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axis.map((point, index) => (
            <tr key={`${point.label}-${index}`}>
              <th scope="row">{point.label}</th>
              {series.map((s) => (
                <td key={s.key}>{format(s.points[index]?.value ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
