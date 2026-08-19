/**
 * The alert strip's rule engine.
 *
 * Every rule is a pure function of figures the board has already loaded, so the
 * strip costs no extra requests and every threshold can be tested at, just
 * below, and just above its boundary without mounting anything.
 *
 * Severity means something specific here, and the meanings are what keep the
 * strip worth reading:
 *
 *  - `critical` — a participant is being turned away, or a queue is stuck, right now.
 *  - `warning`  — will become critical within hours if nobody acts.
 *  - `attention`— worth knowing before it matters. Never urgent.
 *  - `info`     — the board itself is degraded; a figure may be incomplete.
 *
 * A rule that cannot decide returns `null`. Rules never throw: the strip is the
 * one thing on the board that must render even when everything else failed.
 */

import type { BadgeTone } from '@/components/ui';
import { OCCUPANCY_STATUS } from '@/features/occupancy';
import type { ActivityPulse } from './auditSeries';
import type { EventSummary, StaffOpsSummary, WorkshopSummary } from './festMetrics';
import type { HostelRow, HostelSummary } from '@/features/hostels/hostelOccupancy';
import type { MessRow, MessSummary } from '@/features/mess/messOccupancy';

export type AlertSeverity = 'critical' | 'warning' | 'attention' | 'info';

export interface FestAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** One sentence: what is happening, and what it means. */
  detail: string;
  /** Where to go and fix it. The board itself never acts. */
  action?: { label: string; to: string };
}

export const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  attention: 'info',
  info: 'neutral',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  attention: 'Attention',
  info: 'Notice',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  attention: 2,
  info: 3,
};

/** The fill percentage at which a block or hall counts as under pressure. */
export const PRESSURE_THRESHOLD = 90;

/** How many unallotted accommodation requests constitute a backlog. */
export const BACKLOG_THRESHOLD = 25;

export interface AlertInput {
  hostels: { summary: HostelSummary | null; rows: HostelRow[]; pending: number | null };
  mess: { summary: MessSummary | null; rows: MessRow[]; scansLast20Min: number | null };
  events: EventSummary | null;
  workshops: WorkshopSummary | null;
  staff: StaffOpsSummary | null;
  pulse: ActivityPulse | null;
  /** Domains whose data is incomplete because a request failed. */
  failedDomains: string[];
}

/** Routes the alerts link to. Passed in so this module stays free of route imports. */
export interface AlertRoutes {
  hostels: string;
  mess: string;
  events: string;
  workshops: string;
  staff: string;
  auditLogs: string;
}

export function buildAlerts(input: AlertInput, routes: AlertRoutes): FestAlert[] {
  const alerts: FestAlert[] = [];

  /* ── critical ── */

  const hostelSummary = input.hostels.summary;
  if (
    hostelSummary?.available === 0 &&
    input.hostels.pending !== null &&
    input.hostels.pending > 0
  ) {
    alerts.push({
      id: 'hostel-campus-full',
      severity: 'critical',
      title: 'Campus is out of beds',
      detail: `Every bed is allotted and ${input.hostels.pending.toLocaleString()} ${input.hostels.pending === 1 ? 'request is' : 'requests are'} still waiting. Nobody else can be placed.`,
      action: { label: 'Open Hostels', to: routes.hostels },
    });
  }

  const overCapacityHalls = input.mess.rows.filter(
    (row) => row.allocated !== null && row.allocated > row.capacity,
  );
  if (overCapacityHalls.length > 0) {
    alerts.push({
      id: 'mess-over-capacity',
      severity: 'critical',
      title: `${overCapacityHalls.length} mess ${overCapacityHalls.length === 1 ? 'hall is' : 'halls are'} over capacity`,
      detail: `${overCapacityHalls.map((row) => row.name).join(', ')} — more diners allotted than seats. Expect queues at every sitting.`,
      action: { label: 'Open Mess', to: routes.mess },
    });
  }

  // A volunteer whose scanner is switched off gets a 403 at the turnstile and
  // the queue backs up with nobody upstream knowing. During a live event that is
  // an outage, not a configuration note — which is why it outranks everything
  // else the staff panel reports.
  const liveNow = input.events?.live ?? 0;
  const muted = input.staff?.mutedAssignments ?? 0;
  if (liveNow > 0 && muted > 0) {
    alerts.push({
      id: 'scanners-muted-during-live-event',
      severity: 'critical',
      title: `${muted} scanner ${muted === 1 ? 'assignment is' : 'assignments are'} switched off`,
      detail: `${liveNow} ${liveNow === 1 ? 'event is' : 'events are'} running and ${muted} assigned ${muted === 1 ? 'volunteer' : 'volunteers'} cannot scan. Anyone they turn away will be told they are unauthorised.`,
      action: { label: 'Open Staff', to: routes.staff },
    });
  }

  /* ── warning ── */

  if (input.hostels.pending !== null && input.hostels.pending >= BACKLOG_THRESHOLD) {
    alerts.push({
      id: 'accommodation-backlog',
      severity: 'warning',
      title: `${input.hostels.pending.toLocaleString()} accommodation requests unallotted`,
      detail: 'Requests have been made but allocation has not been run since.',
      action: { label: 'Open Hostels', to: routes.hostels },
    });
  }

  const pressured = [
    ...input.hostels.rows.filter(
      (row) => row.percent !== null && row.percent >= PRESSURE_THRESHOLD && row.percent < 100,
    ),
    ...input.mess.rows.filter(
      (row) => row.percent !== null && row.percent >= PRESSURE_THRESHOLD && row.percent < 100,
    ),
  ];
  if (pressured.length > 0) {
    alerts.push({
      id: 'capacity-pressure',
      severity: 'warning',
      title: `${pressured.length} ${pressured.length === 1 ? 'place is' : 'places are'} nearly full`,
      // The same wording the Hostels and Mess screens use for this band, so a
      // block never reads "Filling" there and something else here.
      detail: `${pressured.map((row) => row.name).join(', ')} — at or above ${PRESSURE_THRESHOLD}% (${OCCUPANCY_STATUS.filling.label}).`,
      action: { label: 'Open Hostels', to: routes.hostels },
    });
  }

  if (input.mess.scansLast20Min === 0) {
    alerts.push({
      id: 'mess-service-silent',
      severity: 'warning',
      title: 'No meal scans in 20 minutes',
      detail: 'Either no sitting is running, or a hall is serving without logging entries.',
      action: { label: 'Open Mess', to: routes.mess },
    });
  }

  if (input.workshops && input.workshops.poorTurnout.length > 0) {
    const count = input.workshops.poorTurnout.length;
    alerts.push({
      id: 'workshop-turnout',
      severity: 'warning',
      title: `${count} ${count === 1 ? 'workshop has' : 'workshops have'} under 50% turnout`,
      detail: `${input.workshops.poorTurnout.map((row) => row.name).join(', ')} — booked seats that nobody claimed.`,
      action: { label: 'Open Workshops', to: routes.workshops },
    });
  }

  /* ── attention ── */

  const emptyEvents = input.events?.withoutRegistrations ?? [];
  if (emptyEvents.length > 0) {
    alerts.push({
      id: 'events-without-registrations',
      severity: 'attention',
      title: `${emptyEvents.length} ${emptyEvents.length === 1 ? 'event has' : 'events have'} no registrations`,
      detail: `${emptyEvents.map((row) => row.name).join(', ')}.`,
      action: { label: 'Open Events', to: routes.events },
    });
  }

  const unassigned = input.staff?.unassigned ?? 0;
  if (unassigned > 0) {
    alerts.push({
      id: 'unassigned-staff',
      severity: 'attention',
      title: `${unassigned} staff ${unassigned === 1 ? 'account has' : 'accounts have'} no duty`,
      detail: 'These accounts can sign in but are not on any event, hall, block, or workshop team.',
      action: { label: 'Open Staff', to: routes.staff },
    });
  }

  if (input.pulse?.spiking) {
    alerts.push({
      id: 'activity-spike',
      severity: 'attention',
      title: 'Unusual activity in the last hour',
      detail: `${input.pulse.lastHour.toLocaleString()} logged actions against a typical ${input.pulse.baseline.toLocaleString()}. Worth a look at what is driving it.`,
      action: { label: 'Open Audit Logs', to: routes.auditLogs },
    });
  }

  /* ── info ── */

  // Last, and deliberately never suppressed: with ~80 requests behind the board,
  // some will fail, and an admin needs to know a figure is incomplete *before*
  // acting on it. Without this row a partial total is indistinguishable from a
  // real one.
  if (input.failedDomains.length > 0) {
    alerts.push({
      id: 'partial-data',
      severity: 'info',
      title: 'Some figures are incomplete',
      detail: `Could not load: ${input.failedDomains.join(', ')}. Totals that depend on them are shown as "—" rather than as a partial sum.`,
    });
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
