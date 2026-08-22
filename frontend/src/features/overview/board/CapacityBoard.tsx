import { useMemo, useState } from 'react';
import { ArrowLeft, Building2, ScanLine, ShieldAlert } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { OCCUPANCY_STATUS } from '@/features/occupancy';
import { cn } from '@/lib/cn';
import { orDash } from '../format';
import type { TierState } from '../useFestSnapshot';
import { BoardPanel } from './BoardPanel';
import { Gauge } from './Gauge';
import { capacityTotals, PRESSURE_PERCENT, type CapacityRow } from './boardSeries';

/**
 * Where on campus is running out of room — every hostel block and mess hall in
 * one ranked table, and a drill-in for any one of them.
 *
 * Blocks and halls are listed together on purpose. They are different
 * inventories, but the question this panel answers does not care which one an
 * answer comes from, and splitting them into two tables would mean an admin
 * comparing across a page break to find the fullest place on campus. The `kind`
 * column keeps them distinguishable.
 *
 * The drill-in is a *view*, not an editor. Selecting a row swaps the table for
 * three gauges and a hand-off link; nothing here can allocate, and the panel
 * ends by pointing at the section that can. That is the same constraint the whole
 * board is built on — a ninth place to allocate a bed is a ninth place to do it
 * by accident mid-fest.
 */
export function CapacityBoard({
  rows,
  tier,
  className,
}: {
  /** Fullest first. Rows whose statistics failed sort last. */
  rows: CapacityRow[];
  tier: TierState;
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totals = useMemo(() => capacityTotals(rows), [rows]);
  const selected = useMemo(
    () => rows.find((row) => `${row.kind}-${row.id}` === selectedId) ?? null,
    [rows, selectedId],
  );

  return (
    <BoardPanel
      title={selected ? `${selected.name} · capacity` : 'Capacity board'}
      subtitle={
        selected
          ? `${selected.kind} · ${selected.detail}`
          : `${rows.length} places · ${totals.capacity.toLocaleString()} total places`
      }
      lead={
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-700"
        >
          <Building2 size={17} strokeWidth={2.25} />
        </span>
      }
      controls={
        selected ? (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="tap inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          >
            <ArrowLeft size={13} strokeWidth={2.5} aria-hidden />
            All places
          </button>
        ) : totals.underPressure > 0 ? (
          <StatusBadge tone="warning">
            {totals.underPressure} at {PRESSURE_PERCENT}%+
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">Room everywhere</StatusBadge>
        )
      }
      tier={tier}
      to={selected?.to}
      toLabel={selected ? `Open ${selected.kind}s` : undefined}
      footer={selected ? undefined : <CampusFooter totals={totals} rowCount={rows.length} />}
      fill
      className={className}
    >
      {selected ? (
        /* The drill-in scrolls for the same reason the table does: the panel's
           height is fixed by the grid row, and a narrow card wraps the gauge row
           onto two lines, which with an unstaffed warning underneath is taller
           than the body. Auto margins on the child still centre it when it fits. */
        <div className="no-scrollbar -mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
          <CapacityDetail row={selected} />
        </div>
      ) : rows.length === 0 ? (
        <p className="my-auto text-center text-xs text-muted">
          No hostel blocks or mess halls could be read.
        </p>
      ) : (
        <CapacityTable rows={rows} onSelect={setSelectedId} />
      )}
    </BoardPanel>
  );
}

/** The ranked list. Scrolls internally so the panel keeps its grid height. */
function CapacityTable({
  rows,
  onSelect,
}: {
  rows: CapacityRow[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Hostel blocks and mess halls by how full they are, fullest first. Select a row for detail.
        </caption>
        <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-sm">
          <tr className="border-b border-line">
            <th
              scope="col"
              className="py-2 text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              Place
            </th>
            <th
              scope="col"
              className="py-2 text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              Occupancy
            </th>
            <th
              scope="col"
              className="py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.kind}-${row.id}`;
            const percent = row.percent;
            const status = row.status;

            return (
              <tr key={key} className="border-b border-line/60 last:border-0">
                <td className="py-2 pr-3 align-middle">
                  {/*
                    The whole row is one control. A button rather than a link
                    because it swaps this panel's own view rather than navigating,
                    and its accessible name is the place's name plus its figure,
                    so a keyboard user hears what they are opening.
                  */}
                  <button
                    type="button"
                    onClick={() => onSelect(key)}
                    className="tap group flex w-full items-center gap-2 rounded-lg text-left"
                  >
                    <span
                      aria-hidden
                      className="block h-6 w-1 shrink-0 rounded-full"
                      style={{ background: row.color }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink group-hover:text-brand">
                        {row.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {row.kind} · {row.detail}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="py-2 pr-3 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-surface-2 sm:w-20">
                      {percent !== null && (
                        <div
                          className="h-full rounded-full transition-[width] duration-700"
                          style={{
                            width: `${Math.min(100, percent)}%`,
                            background:
                              status === 'full'
                                ? 'var(--color-danger)'
                                : status === 'filling'
                                  ? 'var(--color-warning)'
                                  : row.color,
                          }}
                        />
                      )}
                    </div>
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted">
                      {orDash(row.allocated)}/{row.capacity.toLocaleString()}
                    </span>
                  </div>
                </td>
                <td className="py-2 text-right align-middle">
                  {status === null ? (
                    <span className="text-[11px] text-muted">—</span>
                  ) : (
                    <StatusBadge tone={OCCUPANCY_STATUS[status].tone}>
                      {Math.round(percent ?? 0)}%
                    </StatusBadge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One place, as gauges. Mirrors the reference board's hub drill-in. */
function CapacityDetail({ row }: { row: CapacityRow }) {
  const status = row.status;
  const arc =
    status === 'full'
      ? 'var(--color-danger)'
      : status === 'filling'
        ? 'var(--color-warning)'
        : row.color;

  return (
    <div className="my-auto flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <Gauge
            value={row.allocated}
            max={row.capacity}
            label={`${row.name} occupancy`}
            figure={row.percent === null ? '—' : `${Math.round(row.percent)}%`}
            caption="Allotted"
            color={arc}
          />
          <div className="min-w-0">
            {status !== null && (
              <StatusBadge tone={OCCUPANCY_STATUS[status].tone} className="mb-1.5">
                {OCCUPANCY_STATUS[status].label}
              </StatusBadge>
            )}
            <p className="flex items-baseline gap-1.5">
              <span className="text-3xl font-black leading-none tabular-nums text-ink">
                {orDash(row.allocated)}
              </span>
              <span className="text-sm font-medium text-muted">
                of {row.capacity.toLocaleString()}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {row.available === null
                ? 'Occupancy could not be read'
                : `${row.available.toLocaleString()} ${row.kind === 'Hostel' ? 'beds' : 'seats'} still free`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Hostels report live occupancy; mess statistics do not, so the gauge
              is simply absent for a hall rather than drawn as an empty ring that
              would imply nobody is in it. */}
          {row.kind === 'Hostel' && (
            <Gauge
              value={row.inside}
              max={Math.max(row.allocated ?? 0, 1)}
              label={`${row.name}, allotted participants currently inside`}
              figure={row.inside === null ? '—' : row.inside.toLocaleString()}
              caption="Inside"
              color="var(--color-success)"
              size={80}
              thickness={6}
            />
          )}
          <Gauge
            value={row.scanning ? 1 : 0}
            max={1}
            label={`${row.name} scanning status`}
            figure={<ScanLine size={22} strokeWidth={2.25} aria-hidden />}
            caption={row.scanning ? 'Scanning' : 'Muted'}
            color={row.scanning ? 'var(--color-success)' : 'var(--color-danger)'}
            size={80}
            thickness={6}
          />
        </div>
      </div>

      {/* The one state worth calling out in prose: a place with no team cannot
          log anyone through, so its occupancy figure will quietly stop moving.
          The hand-off link lives in the panel footer, which `BoardPanel` renders
          from `to`/`toLabel` — repeating it here gave the drill-in two identical
          "Open Hostels" links. */}
      {!row.staffed && (
        <p className="flex items-start gap-2 rounded-2xl bg-warning-bg/60 p-3 text-xs leading-relaxed text-ink ring-1 ring-warning/25">
          <ShieldAlert size={15} strokeWidth={2.25} className="mt-0.5 shrink-0 text-warning" />
          <span>
            No team is on {row.name}, so nobody can scan people through. Its live figures will not
            move until somebody is put on it.
          </span>
        </p>
      )}
    </div>
  );
}

/** Campus-wide roll-up, shown in the footer of the table view. */
function CampusFooter({
  totals,
  rowCount,
}: {
  totals: ReturnType<typeof capacityTotals>;
  rowCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      <span>
        <b className="font-bold tabular-nums text-ink">
          {totals.percent === null ? '—' : `${Math.round(totals.percent)}%`}
        </b>{' '}
        campus-wide
      </span>
      <span>
        <b className="font-bold tabular-nums text-ink">{orDash(totals.inside)}</b> inside
      </span>
      <span
        className={cn(totals.unstaffed > 0 && 'text-warning')}
        title="Places with no team member assigned"
      >
        <b className="font-bold tabular-nums">{totals.unstaffed}</b> unstaffed
      </span>
      {totals.readable < rowCount && (
        <span className="text-warning">{rowCount - totals.readable} unreadable</span>
      )}
    </div>
  );
}
