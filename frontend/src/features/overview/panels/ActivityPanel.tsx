import { useMemo } from 'react';
import { StatusBadge } from '@/components/ui';
import { ROUTES } from '@/config/routes';
import { LogEntryList } from '@/features/logs/LogEntryList';
import { fromAuditLogs, sortLogsNewestFirst } from '@/features/logs/logModel';
import type { AuditFeeds, TierState } from '../useFestSnapshot';
import { activityPulse, rowsSince } from '../auditSeries';
import { OverviewPanel } from '../OverviewPanel';

/**
 * The board's "what just happened" ticker.
 *
 * Rendered with `LogEntryList` and the `logModel` vocabulary rather than a
 * bespoke list, so the ticker and the full Audit Logs screen never describe the
 * same event in two different ways — same labels, same tones, same relative
 * times. The board contributes the framing; the log module owns the wording.
 */
export function ActivityPanel({
  audit,
  tier,
  limit = 8,
}: {
  audit: AuditFeeds;
  tier: TierState;
  limit?: number;
}) {
  const entries = useMemo(
    () => sortLogsNewestFirst(fromAuditLogs(audit.recent)).slice(0, limit),
    [audit.recent, limit],
  );

  // `pulse`, not `recent`: both of these are questions about a span of time, and
  // `recent` is a count of rows. Reading them off the newest 60 made the spike
  // badge here disagree with the alert rail on the same screen.
  const pulse = useMemo(() => activityPulse(audit.pulse), [audit.pulse]);
  const lastFifteen = useMemo(() => rowsSince(audit.pulse, 15).length, [audit.pulse]);

  return (
    <OverviewPanel
      domain="hostels"
      // Cross-cutting: the trail covers every domain, so no single hue is right.
      hue="var(--color-muted)"
      title="Live activity"
      tier={tier}
      to={ROUTES.adminAuditLogs}
      toLabel="Full audit trail"
      badge={
        pulse.spiking ? (
          <StatusBadge tone="warning">
            {pulse.lastHour.toLocaleString()} in the last hour
          </StatusBadge>
        ) : (
          <StatusBadge tone="neutral">{lastFifteen.toLocaleString()} in 15 min</StatusBadge>
        )
      }
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing has been logged yet.</p>
      ) : (
        <LogEntryList entries={entries} linkTargets />
      )}
    </OverviewPanel>
  );
}
