import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, LayoutGrid, List, MapPin, Ticket, UserCheck } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  IconTile,
  ListToolbar,
  Skeleton,
  StatCard,
  StatusBadge,
  TablePager,
  ViewToggle,
  sortRows,
  useListFilters,
  usePagedList,
  useTableSort,
  useViewMode,
  type DataTableColumn,
  type FilterSpec,
  type ViewOption,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  buildScheduleRows,
  scheduleCategories,
  scheduleDays,
  timeLabelOf,
  type ScheduleRow,
} from '@/features/schedule/festSchedule';
import { useNow } from '@/features/schedule/useNow';

/**
 * The fest schedule, laid out the way the admin lists are: headline figures over a
 * single panel that holds the controls, the rows, and the pager.
 *
 * It was a day-by-day stack of cards before, which reads fine on a phone and stops
 * working the moment there are a hundred rounds — there was no way to ask "what is
 * on tomorrow", "where is this happening", or "what do *I* have". Those are now
 * filters over one sortable table, the same `ListToolbar` + `DataTable` +
 * `TablePager` combination `AdminHostelsPage` uses, with a card view kept for
 * narrow screens.
 */

/** 12 rows keeps the table roughly one screen tall on a laptop. */
const PAGE_SIZE = 12;

const VIEW_OPTIONS: readonly ViewOption<'table' | 'cards'>[] = [
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
  { value: 'table', label: 'Table view', icon: List },
];

/** Behind the "Filters" disclosure: whose rounds, rather than which rounds. */
const MINE_SPEC: FilterSpec = {
  key: 'mine',
  label: 'Registration',
  anyLabel: 'Everything',
  options: [{ value: 'mine', label: 'Only my events' }],
};

export default function FestSchedulePage() {
  const now = useNow();
  const [events, setEvents] = useState<Event[] | null>(null);
  const [registeredIds, setRegisteredIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations()])
      .then(([allEvents, mine]) => {
        setEvents(allEvents);
        setRegisteredIds(new Set(mine.map((r) => r.event_id)));
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the schedule.'),
      );
  }
  useEffect(load, []);

  const rows = useMemo(
    () => (events ? buildScheduleRows(events, registeredIds) : []),
    [events, registeredIds],
  );

  const days = useMemo(() => scheduleDays(rows), [rows]);
  const categories = useMemo(() => scheduleCategories(rows), [rows]);

  // Options are derived from the rows, so the filters can only offer days and
  // categories that something is actually filed under.
  const specs = useMemo<FilterSpec[]>(
    () => [
      {
        key: 'day',
        label: 'Filter by day',
        anyLabel: 'All days',
        options: days.map((day) => ({ value: day.key, label: `${day.label} (${day.count})` })),
      },
      {
        key: 'category',
        label: 'Filter by category',
        anyLabel: 'All categories',
        options: categories.map((value) => ({ value, label: value })),
      },
    ],
    [days, categories],
  );
  const allSpecs = useMemo(() => [...specs, MINE_SPEC], [specs]);

  const filters = useListFilters(allSpecs);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (!filters.matches('day', row.dayKey)) return false;
        if (!filters.matches('category', row.eventType)) return false;
        if (filters.values.mine === 'mine' && !row.mine) return false;
        if (!filters.needle) return true;
        return [row.eventName, row.roundName, row.venue, row.dayLabel]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(filters.needle));
      }),
    [rows, filters],
  );

  const sort = useTableSort('time');
  const columns = useScheduleColumns();
  const sorted = useMemo(() => sortRows(visible, columns, sort), [visible, columns, sort]);

  const paged = usePagedList(sorted, {
    pageSize: PAGE_SIZE,
    resetKey: `${filters.signature}|${sort.signature}`,
  });

  const { view, setView } = useViewMode(VIEW_OPTIONS, 'table');

  /* ------------------------------------------------------------- render --- */

  if (loadError) {
    return <ErrorState title="Could not load schedule" description={loadError} onRetry={load} />;
  }

  const loading = events === null;
  const mineCount = rows.filter((row) => row.mine).length;
  const nextUp = rows.find((row) => row.start.getTime() >= now) ?? null;

  return (
    <FestivalScreen
      title="Schedule"
      eyebrow="Programme"
      subtitle={
        loading
          ? 'Loading the schedule…'
          : `${rows.length} round${rows.length === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'}`
      }
    >
      {/* ---- headline figures ---- */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={CalendarDays}
            tone="brand"
            label="Fest Days"
            value={days.length}
            footnote={
              days.length === 0
                ? 'Nothing published yet'
                : `${days[0].label} – ${days[days.length - 1].label}`
            }
          />
          <StatCard
            icon={Clock}
            tone="info"
            label="Total Rounds"
            value={rows.length}
            footnote={
              nextUp === null
                ? 'Nothing still ahead'
                : `Next ${nextUp.dayLabel}, ${timeLabelOf(nextUp.start)}`
            }
          />
          <StatCard
            icon={Ticket}
            tone="accent"
            label="Categories"
            value={categories.length}
            footnote={categories.length === 0 ? 'None yet' : categories.join(', ')}
          />
          <StatCard
            icon={UserCheck}
            tone="success"
            label="My Rounds"
            value={mineCount}
            footnote={
              mineCount === 0 ? 'Register to see yours here' : 'Filter to them under “Filters”'
            }
          />
        </div>
      )}

      {/* One panel holds the controls, the rows, and the pager, so filtering and
          paging read as acting on the thing directly below them. */}
      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <ListToolbar
          filters={filters}
          specs={specs}
          advancedSpecs={[MINE_SPEC]}
          searchLabel="Search the schedule"
          searchPlaceholder="Event, round, venue, or day…"
          shown={visible.length}
          total={rows.length}
          noun="rounds"
          trailing={<ViewToggle options={VIEW_OPTIONS} value={view} onChange={setView} />}
        />

        {loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: PAGE_SIZE }, (_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No scheduled rounds yet"
            description="Event timings appear here once the organisers publish them."
            icon={CalendarDays}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching rounds"
            description="Try a different search, or clear the filters."
            icon={CalendarDays}
          />
        ) : view === 'table' ? (
          <DataTable
            columns={columns}
            rows={paged.items}
            rowKey={(row) => row.id}
            sort={sort}
            caption="Every published round with its day, time, venue, and event"
          />
        ) : (
          <ScheduleCards rows={paged.items} />
        )}

        {!loading && visible.length > 0 && <TablePager paged={paged} noun="rounds" />}
      </section>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <MapPin size={12} /> Timings are tentative — each event&apos;s page carries the latest.
      </p>
    </FestivalScreen>
  );
}

/* -------------------------------------------------------------- columns --- */

function useScheduleColumns(): DataTableColumn<ScheduleRow>[] {
  return useMemo(
    () => [
      {
        key: 'day',
        header: 'Day',
        sortValue: (row) => row.dayKey,
        cell: (row) => (
          <span className="whitespace-nowrap font-medium text-ink">{row.dayLabel}</span>
        ),
      },
      {
        key: 'time',
        header: 'Time',
        sortValue: (row) => row.start.getTime(),
        cell: (row) => (
          <span className="whitespace-nowrap tabular-nums text-ink">
            {timeLabelOf(row.start)}
            {row.end && ` – ${timeLabelOf(row.end)}`}
          </span>
        ),
      },
      {
        key: 'event',
        header: 'Event',
        sortValue: (row) => row.eventName,
        cell: (row) => (
          <Link
            to={path(ROUTES.eventDetail, { eventId: row.eventId })}
            className="font-semibold text-ink hover:text-brand"
          >
            {row.eventName}
          </Link>
        ),
      },
      {
        key: 'round',
        header: 'Round',
        sortValue: (row) => row.roundName,
        cell: (row) => <span className="text-muted">{row.roundName}</span>,
      },
      {
        key: 'venue',
        header: 'Venue',
        sortValue: (row) => row.venue ?? '',
        cell: (row) => <span className="text-muted">{row.venue ?? '—'}</span>,
      },
      {
        key: 'category',
        header: 'Category',
        sortValue: (row) => row.eventType,
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone="neutral" className="capitalize">
              {row.eventType}
            </StatusBadge>
            {row.mine && <StatusBadge tone="success">Mine</StatusBadge>}
          </div>
        ),
      },
    ],
    [],
  );
}

/* ---------------------------------------------------------------- cards --- */

/** The same rows as the table, one per card, for narrow screens. */
function ScheduleCards({ rows }: { rows: ScheduleRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={path(ROUTES.eventDetail, { eventId: row.eventId })}>
            <Card interactive className="flex items-center gap-3">
              <IconTile icon={Clock} tone="muted" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink">{row.eventName}</p>
                <p className="truncate text-sm text-muted">
                  {row.roundName} · {row.dayLabel}, {timeLabelOf(row.start)}
                  {row.end && ` – ${timeLabelOf(row.end)}`}
                </p>
                {row.venue && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
                    <MapPin size={11} className="shrink-0" /> {row.venue}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge tone="neutral" className="capitalize">
                  {row.eventType}
                </StatusBadge>
                {row.mine && <StatusBadge tone="success">Mine</StatusBadge>}
              </div>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
