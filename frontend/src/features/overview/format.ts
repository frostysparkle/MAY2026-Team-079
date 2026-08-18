/**
 * Display helpers shared by every panel.
 *
 * Separate from `OverviewPanel.tsx` so that file exports only components — a
 * module mixing the two breaks fast refresh for every component in it.
 */

/**
 * "—" for anything unreadable.
 *
 * The board's most important formatting rule. Per-entity statistics are
 * Super-Admin-only and fail individually, so a figure that could not be read
 * must never render as `0`: "nobody is allocated" and "we could not find out"
 * are different answers, and only one of them should make an admin act.
 */
export function orDash(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

/** A percentage, or "—". One decimal, matching `occupancy.formatPercent`. */
export function orDashPercent(percent: number | null | undefined): string {
  return percent === null || percent === undefined ? '—' : `${Math.round(percent * 10) / 10}%`;
}

/** Relative age, e.g. "14s ago". */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
