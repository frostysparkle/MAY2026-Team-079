import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RankedBars, StatusBadge } from '@/components/ui';
import { staffSupportPath } from '@/config/routes';
import type { QueryRecord, StaffIssue } from '@/api/types';
import type { TierState } from '../useFestSnapshot';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import {
  categoryLabel as queryCategoryLabel,
  countQueries,
  outstandingByCategory,
} from '@/features/queries/queries';
import { countIssues, categoryLabel as issueCategoryLabel } from '@/features/issues/issues';

/**
 * Open queries and reported faults — the two panels Story 9.1 was missing.
 *
 * The story asked the operational dashboard to show *open queries* and *hostel
 * issues*, and it could not: neither domain existed. Both were built this sprint
 * — `/queries` for Epic 6 and `/issues` for Story 5.4 — so this panel is what
 * closes 9.1 rather than a new capability of its own.
 *
 * One panel rather than two, because they answer one question. An admin scanning
 * the board wants to know whether anybody is waiting on the fest team; whether
 * they are waiting for an answer or for a plumber is the next click, not the
 * headline. The panel is deliberately blunt about the distinction anyway: a
 * question and a burst pipe get separate figures and separate breakdowns, because
 * fifty questions is a busy fest and fifty faults is a bad one.
 *
 * The figure this panel exists for is **unanswered** — outstanding *and* nobody
 * has replied. A status alone can say `assigned` for something claimed and then
 * forgotten, which is the failure a board should catch and a status column cannot.
 *
 * Read-only, like every other panel: it counts, then hands off to the Support
 * desk that owns the work — whose two tabs are the two consoles this panel used to
 * point at separately, merged for the same reason this panel was never split.
 */
export function SupportPanel({
  queries,
  issues,
  tier,
}: {
  /** `null` when `GET /queries` failed — the panel says so rather than reading 0. */
  queries: QueryRecord[] | null;
  /** `null` when `GET /issues` failed. */
  issues: StaffIssue[] | null;
  tier: TierState;
}) {
  const queryCounts = useMemo(() => countQueries(queries ?? []), [queries]);
  const issueCounts = useMemo(() => countIssues(issues ?? []), [issues]);

  const queryAreas = useMemo(() => {
    const byCategory = outstandingByCategory(queries ?? []);
    const max = Math.max(1, ...Object.values(byCategory));
    return Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({
        key: category,
        label: queryCategoryLabel(category),
        value: count,
        max,
        display: count.toLocaleString(),
      }));
  }, [queries]);

  const faultAreas = useMemo(() => {
    const byCategory: Record<string, { label: string; count: number }> = {};
    for (const issue of issues ?? []) {
      if (issue.status === 'resolved') continue;
      const key = `${issue.facility_type}:${issue.category}`;
      byCategory[key] ??= {
        label: `${issueCategoryLabel(issue.facility_type, issue.category)} · ${issue.facility_id}`,
        count: 0,
      };
      byCategory[key].count += 1;
    }
    const max = Math.max(1, ...Object.values(byCategory).map((entry) => entry.count));
    return Object.entries(byCategory)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([key, entry]) => ({
        key,
        label: entry.label,
        value: entry.count,
        max,
        display: entry.count.toLocaleString(),
        color: entry.count >= 3 ? 'var(--color-danger)' : undefined,
      }));
  }, [issues]);

  const unreadable = [
    queries === null ? 'queries' : null,
    issues === null ? 'reported faults' : null,
  ].filter((value): value is string => value !== null);

  const waiting = queryCounts.outstanding + issueCounts.outstanding;
  const unanswered = queryCounts.unanswered;

  return (
    <OverviewPanel
      domain="people"
      title="Support"
      subtitle={
        unreadable.length > 0
          ? `Could not read ${unreadable.join(' or ')}`
          : `${queryCounts.total} queries · ${issueCounts.total} reported faults`
      }
      tier={tier}
      to={staffSupportPath('questions')}
      toLabel="Open the support desk"
      badge={
        unreadable.length > 0 ? (
          <StatusBadge tone="neutral">Partial</StatusBadge>
        ) : waiting === 0 ? (
          <StatusBadge tone="success">Nothing waiting</StatusBadge>
        ) : (
          <StatusBadge tone={unanswered > 0 ? 'warning' : 'info'}>{waiting} waiting</StatusBadge>
        )
      }
    >
      <FigureRow>
        <Figure
          label="Open queries"
          value={queries === null ? '—' : queryCounts.outstanding.toLocaleString()}
          note={`${queryCounts.resolved.toLocaleString()} answered`}
          tone={queryCounts.outstanding > 0 ? 'warn' : 'good'}
        />
        <Figure
          label="No reply yet"
          value={queries === null ? '—' : unanswered.toLocaleString()}
          note="nobody has written back"
          tone={unanswered > 0 ? 'bad' : 'good'}
        />
        <Figure
          label="Open faults"
          value={issues === null ? '—' : issueCounts.outstanding.toLocaleString()}
          note={`${issueCounts.in_progress.toLocaleString()} being worked on`}
          // Tone has to track the same figure that's displayed (`outstanding` =
          // open + in_progress), or a fault that's actively being worked on
          // (open: 0, in_progress: 1) shows "1" painted "good" — the number and
          // its own color disagreeing. The query figure right above already
          // gets this right (`queryCounts.outstanding`); this one previously
          // checked `issueCounts.open` alone.
          tone={issueCounts.outstanding > 0 ? 'warn' : 'good'}
        />
        <Figure
          label="Faults fixed"
          value={issues === null ? '—' : issueCounts.resolved.toLocaleString()}
          note="closed by a duty team"
          tone="muted"
        />
      </FigureRow>

      <PanelBlock title="Open queries by area">
        <RankedBars
          rows={queryAreas}
          domain="people"
          label="Open queries by area"
          emptyText={queries === null ? 'Queries could not be read' : 'No open queries'}
        />
      </PanelBlock>

      <PanelBlock title="Open faults by place">
        <RankedBars
          rows={faultAreas}
          domain="hostels"
          label="Open reported faults by place"
          emptyText={issues === null ? 'Reported faults could not be read' : 'Nothing reported'}
        />
      </PanelBlock>

      <p className="text-[11px] text-muted">
        Faults are answered on the{' '}
        <Link to={staffSupportPath('faults')} className="font-medium text-brand hover:underline">
          faults tab
        </Link>
        . Both figures are the whole fest, because a Super Admin&rsquo;s own queue is unscoped — a
        volunteer opening either console sees only their own blocks, halls, events and workshops.
      </p>
    </OverviewPanel>
  );
}
