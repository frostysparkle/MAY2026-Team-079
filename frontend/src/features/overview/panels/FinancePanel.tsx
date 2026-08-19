import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { DataTable, RankedBars, Sparkline, SplitBar, StatusBadge } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import type {
  Event,
  EventParticipationResponse,
  HostelStatisticsResponse,
  MessStatisticsResponse,
  Workshop,
} from '@/api/types';
import {
  LEDGER_DISCLAIMER,
  PURPOSE_LABEL,
  STATUS_LABEL,
  METHOD_LABEL,
  buildDemoLedger,
  formatRupees,
  formatRupeesCompact,
  prizeLiabilityByType,
  summariseLedger,
  workshopSeatsFor,
  type DemoTransaction,
} from '@/features/finance/demoLedger';
import type { TierState } from '../useFestSnapshot';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDashPercent } from '../format';

/**
 * Money in and money committed.
 *
 * **The transactions here are demonstration data.** The backend records no
 * payments at all — no fee on a hall or block, no transaction collection, no
 * refund route — so the ledger is generated client-side from the fest's real
 * allocations by `features/finance/demoLedger`. Every surface below repeats that
 * in plain words, because a finance panel that is confidently wrong is worse
 * than one that admits what it does not track.
 *
 * The one genuinely real figure is prize liability: the sum of every event's
 * `prize_money[]`, which is money the fest has committed to pay out.
 */

const COLUMNS: DataTableColumn<DemoTransaction>[] = [
  {
    key: 'transaction_id',
    header: 'Transaction',
    cell: (row) => <span className="font-mono text-[11px] text-muted">{row.transaction_id}</span>,
    sortValue: (row) => row.transaction_id,
  },
  {
    key: 'participant_id',
    header: 'Participant',
    cell: (row) => <span className="text-xs">{row.participant_id}</span>,
    sortValue: (row) => row.participant_id,
  },
  {
    key: 'label',
    header: 'Purpose',
    cell: (row) => <span className="text-xs">{row.label}</span>,
    sortValue: (row) => row.label,
  },
  {
    key: 'amount',
    header: 'Amount',
    cell: (row) => <span className="tabular-nums">{formatRupees(row.amount)}</span>,
    sortValue: (row) => row.amount,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <StatusBadge
        tone={
          row.status === 'paid'
            ? 'success'
            : row.status === 'pending'
              ? 'warning'
              : row.status === 'refunded'
                ? 'info'
                : 'danger'
        }
      >
        {STATUS_LABEL[row.status]}
      </StatusBadge>
    ),
    sortValue: (row) => row.status,
  },
  {
    key: 'method',
    header: 'Method',
    cell: (row) => <span className="text-xs text-muted">{METHOD_LABEL[row.method]}</span>,
    sortValue: (row) => row.method,
  },
  {
    key: 'timestamp',
    header: 'When',
    cell: (row) => (
      <span className="whitespace-nowrap text-xs text-muted">
        {new Date(row.timestamp).toLocaleString()}
      </span>
    ),
    sortValue: (row) => row.timestamp,
  },
];

export function FinancePanel({
  messStats,
  hostelStats,
  participation,
  workshops,
  events,
  messNames,
  hostelNames,
  tier,
}: {
  messStats: Record<string, MessStatisticsResponse>;
  hostelStats: Record<string, HostelStatisticsResponse>;
  participation: Record<string, EventParticipationResponse>;
  workshops: Workshop[] | null;
  events: Event[] | null;
  messNames: Record<string, string>;
  hostelNames: Record<string, string>;
  tier: TierState;
}) {
  const ledger = useMemo(
    () =>
      buildDemoLedger({
        messRosters: Object.entries(messStats).map(([id, stat]) => ({
          id,
          name: messNames[id] ?? id,
          participantIds: stat.allotted_participants.map((p) => p.participant_id),
        })),
        hostelRosters: Object.entries(hostelStats).map(([id, stat]) => ({
          id,
          name: hostelNames[id] ?? id,
          participantIds: stat.allotted_participants.map((p) => p.participant_id),
        })),
        eventRosters: Object.entries(participation).map(([id, stat]) => ({
          id,
          name: events?.find((e) => e.event_id === id)?.name ?? id,
          participantIds: stat.participants.map((p) => p.participant_id),
        })),
        workshopSeats: workshopSeatsFor(workshops ?? []),
      }),
    [messStats, hostelStats, participation, workshops, events, messNames, hostelNames],
  );

  const summary = useMemo(() => summariseLedger(ledger, events ?? []), [ledger, events]);
  const byType = useMemo(() => prizeLiabilityByType(events ?? []), [events]);

  const recent = useMemo(() => ledger.slice(0, 8), [ledger]);

  return (
    <OverviewPanel
      domain="people"
      // Not one of the six fest domains, so it takes the neutral rail rather
      // than wearing Participants' blue and reading as a seventh domain.
      hue="var(--color-muted)"
      title="Finance & Payments"
      subtitle="Registration payments for mess, hostel, events and workshops"
      tier={tier}
      badge={
        <StatusBadge tone="warning">
          <FlaskConical size={12} strokeWidth={2.5} className="mr-1" />
          Demo data
        </StatusBadge>
      }
    >
      {/* First thing in the panel, not a footnote. Anyone reading a revenue
          figure has to have already read this. */}
      <p className="rounded-xl bg-warning-bg px-3 py-2 text-[11px] leading-relaxed text-warning">
        {LEDGER_DISCLAIMER}
      </p>

      <FigureRow>
        <Figure
          label="Net revenue"
          value={formatRupeesCompact(summary.netRevenue)}
          note={`${summary.paidCount.toLocaleString()} settled`}
          tone="good"
        />
        <Figure
          label="Pending"
          value={formatRupeesCompact(summary.pending)}
          note={`${summary.pendingCount.toLocaleString()} awaiting`}
          tone={summary.pending > 0 ? 'warn' : 'muted'}
        />
        <Figure
          label="Refunded"
          value={formatRupeesCompact(summary.refunded)}
          note={`${summary.refundedCount.toLocaleString()} reversed`}
        />
        <Figure
          label="Collection rate"
          value={orDashPercent(summary.collectionRate)}
          note={`${summary.failedCount.toLocaleString()} failed`}
          tone={summary.collectionRate !== null && summary.collectionRate < 80 ? 'warn' : 'default'}
        />
      </FigureRow>

      <PanelBlock title="Where the transactions stand">
        <SplitBar
          label="Transactions by settlement status"
          segments={[
            {
              key: 'paid',
              label: 'Paid',
              value: summary.paidCount,
              color: 'var(--color-success)',
            },
            {
              key: 'pending',
              label: 'Pending',
              value: summary.pendingCount,
              color: 'var(--color-warning)',
            },
            {
              key: 'refunded',
              label: 'Refunded',
              value: summary.refundedCount,
              color: 'var(--color-info)',
            },
            {
              key: 'failed',
              label: 'Failed',
              value: summary.failedCount,
              color: 'var(--color-danger)',
            },
          ]}
        />
      </PanelBlock>

      <PanelBlock title="Collected by purpose">
        <RankedBars
          rows={summary.byPurpose.map((entry) => ({
            key: entry.purpose,
            label: PURPOSE_LABEL[entry.purpose],
            value: entry.collected,
            display: `${formatRupeesCompact(entry.collected)} · ${entry.count.toLocaleString()}`,
          }))}
          domain="people"
          label="Revenue collected by purpose"
          emptyText="No transactions generated — nothing has been allotted yet"
        />
      </PanelBlock>

      <PanelBlock title="Collected per day">
        <Sparkline
          points={summary.byDay.map((entry) => ({ label: entry.day, value: entry.collected }))}
          domain="people"
          label="Demo revenue collected per day"
          caption={
            summary.averageTicket === null
              ? undefined
              : `Average settled transaction ${formatRupees(summary.averageTicket)}`
          }
        />
      </PanelBlock>

      <PanelBlock title="Committed prize money">
        {byType.length === 0 ? (
          <p className="text-xs text-muted">No event carries prize money.</p>
        ) : (
          <>
            <RankedBars
              rows={byType.map((entry) => ({
                key: entry.type,
                label: entry.type,
                value: entry.amount,
                display: formatRupeesCompact(entry.amount),
              }))}
              domain="events"
              label="Committed prize money by event type"
            />
            <p className="text-[11px] text-muted">
              {formatRupees(summary.prizeLiability)} total — the only real money figure in the API,
              read from each event&rsquo;s prize list.
            </p>
          </>
        )}
      </PanelBlock>

      <PanelBlock title="Latest transactions">
        {recent.length === 0 ? (
          <p className="text-xs text-muted">
            No transactions yet — the ledger is built from real allocations, and nothing has been
            allotted.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <DataTable
              rows={recent}
              columns={COLUMNS}
              rowKey={(row) => row.transaction_id}
              caption="Most recent demo transactions"
            />
          </div>
        )}
      </PanelBlock>
    </OverviewPanel>
  );
}
