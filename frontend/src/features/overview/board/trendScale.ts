/**
 * The arithmetic behind `TrendChart`, kept separate from the component so the
 * scale, the tick choice, and the hit-testing can be reasoned about (and, if it
 * ever matters, tested) without a DOM.
 */

export interface TrendPoint {
  /** Axis label, e.g. "14:00" or "2026-08-18". */
  label: string;
  value: number;
}

export interface TrendSeries {
  key: string;
  label: string;
  /** Any CSS colour. Series are direct-labelled, so this is reinforcement only. */
  color: string;
  points: TrendPoint[];
}

/** The plot box inside the SVG, leaving room for the axis labels. */
export const PLOT_PADDING = { top: 14, right: 14, bottom: 26, left: 46 } as const;

/**
 * Round `value` up to the next "nice" number — 1, 2, 2.5 or 5 times a power of
 * ten.
 *
 * A y-axis topping out at 4,317 with gridlines at 1,079.25 is arithmetically
 * correct and unreadable. Snapping the ceiling to 5,000 costs a little vertical
 * space and buys tick labels an admin can hold in their head.
 */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Evenly spaced tick values from 0 to a nice ceiling above `max`.
 *
 * The axis is always anchored at zero. These are counts — meals served,
 * check-ins, registrations — and a truncated baseline exaggerates every
 * difference on the chart, which on a monitoring board means manufacturing
 * alarm out of noise.
 */
export function trendTicks(max: number, count = 4): number[] {
  const ceiling = niceCeiling(max);
  return Array.from({ length: count + 1 }, (_, i) => (ceiling / count) * i);
}

export interface TrendGeometry {
  width: number;
  height: number;
  plotWidth: number;
  plotHeight: number;
  ceiling: number;
  ticks: number[];
  /** Pixel x for a point index. */
  xAt: (index: number) => number;
  /** Pixel y for a value. */
  yAt: (value: number) => number;
  /** Which point index a pixel x falls nearest to. */
  indexAt: (x: number) => number;
}

/**
 * Build the pixel mapping for a chart of `length` points against `max`.
 *
 * A single-point series would divide by zero when spacing the x axis, so it is
 * pinned to the left edge instead; `TrendChart` refuses to draw fewer than two
 * points anyway, and this keeps the helper total.
 */
export function trendGeometry(
  length: number,
  max: number,
  width: number,
  height: number,
  tickCount = 4,
): TrendGeometry {
  const plotWidth = Math.max(1, width - PLOT_PADDING.left - PLOT_PADDING.right);
  const plotHeight = Math.max(1, height - PLOT_PADDING.top - PLOT_PADDING.bottom);
  const ticks = trendTicks(max, tickCount);
  const ceiling = ticks[ticks.length - 1] || 1;
  const step = length > 1 ? plotWidth / (length - 1) : 0;

  return {
    width,
    height,
    plotWidth,
    plotHeight,
    ceiling,
    ticks,
    xAt: (index) => PLOT_PADDING.left + index * step,
    yAt: (value) =>
      PLOT_PADDING.top +
      plotHeight -
      (Math.min(Math.max(value, 0), ceiling) / ceiling) * plotHeight,
    indexAt: (x) => {
      if (length <= 1 || step === 0) return 0;
      const raw = Math.round((x - PLOT_PADDING.left) / step);
      return Math.min(length - 1, Math.max(0, raw));
    },
  };
}

/** The approximate drawn length of a polyline, for the draw-in animation. */
export function polylineLength(coordinates: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += Math.hypot(
      coordinates[i].x - coordinates[i - 1].x,
      coordinates[i].y - coordinates[i - 1].y,
    );
  }
  return Math.ceil(total);
}

/**
 * Thin `labels` down to at most `budget` of them, keeping the first and last.
 *
 * Twenty-four hourly labels do not fit under a chart in a half-width panel, and
 * letting them overlap is worse than showing six. Returns the indices to label.
 */
export function labelIndices(length: number, budget: number): number[] {
  if (length <= budget) return Array.from({ length }, (_, i) => i);
  const stride = Math.ceil((length - 1) / (budget - 1));
  const indices: number[] = [];
  for (let i = 0; i < length - 1; i += stride) indices.push(i);
  indices.push(length - 1);
  return indices;
}

/** Percent change from `previous` to `current`, or `null` when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  // Growth from nothing has no meaningful percentage — "+∞%" and "+100%" are
  // both fabrications. The caller shows the absolute figure instead.
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Compare the last `window` buckets against the `window` before them.
 *
 * The board's KPI deltas are all of this shape: "today against yesterday",
 * "this hour against last". Returns `null` when there is not enough history to
 * make the comparison, which is the honest answer on the fest's first morning.
 */
export function windowDelta(points: TrendPoint[], window: number): number | null {
  if (points.length < window * 2) return null;
  const sum = (slice: TrendPoint[]) => slice.reduce((total, point) => total + point.value, 0);
  const recent = sum(points.slice(-window));
  const prior = sum(points.slice(-window * 2, -window));
  return percentChange(recent, prior);
}
