/**
 * The support backlog, reduced to the few facts the alert engine can act on.
 *
 * `SupportPanel` already counts open queries and open faults, and that was the
 * whole of Story 9.1's support half — but a panel is something an admin has to
 * scroll to and read. `festAlerts` is what surfaces without being looked for, and
 * until this module existed neither domain reached it: fifty unanswered queries
 * showed in the panel and never raised a row on the Attention Rail, which is
 * exactly the failure a monitoring board is for.
 *
 * Kept as a pure summariser next to `festMetrics` rather than as logic inside the
 * alert rules, for the reason every other figure on this board is: the thresholds
 * have to be testable at, just below, and just above their boundary without
 * mounting a page or holding a clock.
 *
 * Everything here is fest-wide, because a Super Admin's own queue is unscoped.
 */

import type { QueryRecord, StaffIssue } from '@/api/types';
import { isOutstanding, isUnanswered, parseQueryTime } from '@/features/queries/queries';
import { parseIssueTime } from '@/features/issues/issues';

/**
 * How long a query may sit with no reply at all before it is a problem rather
 * than a queue.
 *
 * Twelve hours, not twenty-four: a fest runs six days, so a full day of silence
 * is a sixth of the event. Measured from when it was raised, because the figure
 * is about the *asker's* wait, not about staff activity.
 */
export const STALE_QUERY_HOURS = 12;

/**
 * How long a fault may go untouched before it counts as forgotten.
 *
 * Longer than a query's window on purpose: answering a question takes a minute
 * and fixing a shower takes a day, so a fault that somebody has acknowledged and
 * is working is not late. Measured from `updated_at`, which a status change or a
 * note both move — so a team that says "part ordered" resets the clock, which is
 * the behaviour that makes the rule worth obeying.
 */
export const STALE_FAULT_HOURS = 24;

/** How many open faults in one place make it a place rather than a fault. */
export const FAULT_CLUSTER_THRESHOLD = 3;

/** How much outstanding work counts as a backlog worth naming on the board. */
export const SUPPORT_BACKLOG_THRESHOLD = 15;

/**
 * Categories that describe a risk to a person rather than to their comfort.
 *
 * Only `safety` today. A set rather than an equality check because the backend's
 * category list is data, and the next one added to it (a gas smell, a lift
 * failure) should be a one-word change here rather than a new rule.
 */
const URGENT_CATEGORIES = new Set(['safety']);

/** One place with more open faults than it should have. */
export interface FaultCluster {
  facilityType: StaffIssue['facility_type'];
  facilityId: string;
  count: number;
}

export interface SupportSummary {
  /** Outstanding queries — open or claimed. `null` when `GET /queries` failed. */
  outstandingQueries: number | null;
  /** Outstanding *and* nobody has written back. The figure the panel exists for. */
  unansweredQueries: number | null;
  /** Unanswered for longer than `STALE_QUERY_HOURS`. */
  stalledQueries: number | null;
  /** Unresolved faults. `null` when `GET /issues` failed. */
  openFaults: number | null;
  /** Unresolved and untouched for longer than `STALE_FAULT_HOURS`. */
  stalledFaults: number | null;
  /** Unresolved faults in a category that describes a risk to somebody. */
  urgentFaults: FaultCluster[];
  /** Places carrying `FAULT_CLUSTER_THRESHOLD` or more open faults. Fullest first. */
  clusters: FaultCluster[];
  /** Everything still waiting on the fest team, or `null` if either read failed. */
  waiting: number | null;
}

const EMPTY: SupportSummary = {
  outstandingQueries: null,
  unansweredQueries: null,
  stalledQueries: null,
  openFaults: null,
  stalledFaults: null,
  urgentFaults: [],
  clusters: [],
  waiting: null,
};

function hoursSince(value: string | null | undefined, now: Date, parse: typeof parseQueryTime) {
  const at = parse(value);
  if (at === null) return null;
  return (now.getTime() - at.getTime()) / 3_600_000;
}

/**
 * Reduce the two queues to the summary above.
 *
 * `null` in, `null` out, per domain: a failed read is not an empty queue, and a
 * board that reported "0 unanswered" because the request 500ed would be wrong in
 * the one direction that matters. `waiting` is `null` if *either* side is
 * unreadable, because a partial total that looks complete is the failure mode
 * this board is built to avoid.
 */
export function summariseSupport(
  queries: readonly QueryRecord[] | null,
  issues: readonly StaffIssue[] | null,
  now: Date = new Date(),
): SupportSummary {
  if (queries === null && issues === null) return EMPTY;

  let outstandingQueries: number | null = null;
  let unansweredQueries: number | null = null;
  let stalledQueries: number | null = null;

  if (queries !== null) {
    outstandingQueries = 0;
    unansweredQueries = 0;
    stalledQueries = 0;
    for (const query of queries) {
      if (!isOutstanding(query)) continue;
      outstandingQueries += 1;
      if (!isUnanswered(query)) continue;
      unansweredQueries += 1;
      const age = hoursSince(query.created_at, now, parseQueryTime);
      if (age !== null && age >= STALE_QUERY_HOURS) stalledQueries += 1;
    }
  }

  let openFaults: number | null = null;
  let stalledFaults: number | null = null;
  const urgentFaults: FaultCluster[] = [];
  const byPlace = new Map<string, FaultCluster>();

  if (issues !== null) {
    openFaults = 0;
    stalledFaults = 0;
    for (const issue of issues) {
      if (issue.status === 'resolved') continue;
      openFaults += 1;

      // `updated_at` rather than `created_at`: a note or a status change both
      // move it, so acknowledging a fault stops it reading as forgotten.
      const idle = hoursSince(issue.updated_at, now, parseIssueTime);
      if (idle !== null && idle >= STALE_FAULT_HOURS) stalledFaults += 1;

      if (URGENT_CATEGORIES.has(issue.category)) {
        urgentFaults.push({
          facilityType: issue.facility_type,
          facilityId: issue.facility_id,
          count: 1,
        });
      }

      const key = `${issue.facility_type}:${issue.facility_id}`;
      const place = byPlace.get(key);
      if (place) place.count += 1;
      else
        byPlace.set(key, {
          facilityType: issue.facility_type,
          facilityId: issue.facility_id,
          count: 1,
        });
    }
  }

  const clusters = [...byPlace.values()]
    .filter((place) => place.count >= FAULT_CLUSTER_THRESHOLD)
    .sort((a, b) => b.count - a.count || a.facilityId.localeCompare(b.facilityId));

  return {
    outstandingQueries,
    unansweredQueries,
    stalledQueries,
    openFaults,
    stalledFaults,
    urgentFaults,
    clusters,
    waiting:
      outstandingQueries === null || openFaults === null ? null : outstandingQueries + openFaults,
  };
}

/** "Ganga Block, Hall C" — the places in a cluster list, for an alert's detail line. */
export function placeList(clusters: readonly FaultCluster[]): string {
  return clusters.map((place) => place.facilityId).join(', ');
}
