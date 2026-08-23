import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Clock, LocateFixed, MapPin, Radio, UserCheck } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { currentParticipant } from '@/stores/authStore';
import {
  ANY,
  DetailPanel,
  EmptyState,
  ErrorState,
  ListToolbar,
  Skeleton,
  StatCard,
  StatGrid,
  useListFilters,
  type FilterSpec,
} from '@/components/ui';
import { FestivalScreen, ScreenNote } from '@/components/layout/FestivalScreen';
import { useTick } from '@/features/overview/board/useTick';
import { DayRail } from '@/features/schedule/DayRail';
import { NowPanel } from '@/features/schedule/NowPanel';
import { ScheduleTimeline } from '@/features/schedule/ScheduleTimeline';
import {
  buildScheduleRows,
  categoryOf,
  dayKeyOf,
  groupSchedule,
  relativeLabel,
  roundStatus,
  scheduleCategories,
  scheduleDays,
} from '@/features/schedule/festSchedule';

/**
 * The participant's fest programme.
 *
 * Built from the admin control board's parts, in the board's reading order — a
 * pulse row of headline figures, then a command row of what is running beside
 * what is next, then the detail — so the two screens read as one product. What
 * changes is the subject: the board asks "is the fest running cleanly", this
 * asks "where do I need to be, and when".
 *
 * The detail is a timeline rather than the sortable table this page used to
 * carry. The table could sort every round in the fest by venue, which nobody
 * needs; it could not answer "what is on after lunch", which is the only
 * question a participant standing in a corridor actually has. Time now runs
 * downwards, each start time is printed once however many rounds share it, and
 * the day rail chunks the programme the way a participant plans it. Paging went
 * with the table: a day is a better unit than twelve rows.
 *
 * Everything is still one `GET /events` (plus the viewer's registrations) and
 * every round is still flattened out of `event.schedule` — see `festSchedule`.
 */

/** Behind the "Filters" disclosure: whose rounds, rather than which rounds. */
const MINE_SPEC: FilterSpec = {
  key: 'mine',
  label: 'Registration',
  anyLabel: 'Everyone’s rounds',
  options: [{ value: 'mine', label: 'Only my events' }],
};

/** The day rail owns this one; it is registered so the URL and Clear agree. */
const DAY_KEY = 'day';

export default function FestSchedulePage() {
  const participant = currentParticipant();
  // A ticking clock, unlike the frozen `useNow` the dashboard uses: this page
  // draws a "now" line, live badges, and countdowns, all of which would quietly
  // go stale on a screen left open through an afternoon.
  const now = useTick(30_000);

  const [events, setEvents] = useState<Event[] | null>(null);
  const [registeredIds, setRegisteredIds] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations()])
      .then(([allEvents, mine]) => {
        setEvents(allEvents);
        setRegisteredIds(
          new Set(mine.map((r) => r.event_id).filter((id): id is string => id !== null)),
        );
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
  const today = dayKeyOf(new Date(now));

  // Options are derived from the rows, so a filter can only offer a day or a
  // category that something is actually filed under.
  const daySpec = useMemo<FilterSpec>(
    () => ({
      key: DAY_KEY,
      label: 'Filter by day',
      anyLabel: 'All days',
      options: days.map((day) => ({ value: day.key, label: day.label })),
    }),
    [days],
  );
  const categorySpec = useMemo<FilterSpec>(
    () => ({
      key: 'category',
      label: 'Filter by category',
      anyLabel: 'All categories',
      options: categories.map((value) => ({ value, label: categoryOf(value).label })),
    }),
    [categories],
  );
  const allSpecs = useMemo(() => [daySpec, categorySpec, MINE_SPEC], [daySpec, categorySpec]);

  const filters = useListFilters(allSpecs);

  const visible = useMemo(
    () =>
      rows.filter((row) => {
        if (!filters.matches(DAY_KEY, row.dayKey)) return false;
        if (!filters.matches('category', row.eventType)) return false;
        if (filters.values.mine === 'mine' && !row.mine) return false;
        if (!filters.needle) return true;
        return [row.eventName, row.roundName, row.venue, row.dayLabel, row.categoryLabel]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(filters.needle));
      }),
    [rows, filters],
  );

  const groups = useMemo(() => groupSchedule(visible), [visible]);

  /* ---- jump to now ----
     Scrolling to the marker is immediate when the day showing already contains
     it. When the rail has to switch days first it cannot be: the marker is not
     in the document until that day has rendered, so the request is parked on a
     ref and picked up by the effect the new `groups` fires. A ref rather than
     state because nothing on screen depends on the request being pending. */
  const scrollPending = useRef(false);

  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    scrollToNow();
  }, [groups]);

  function scrollToNow() {
    document
      .getElementById('schedule-now')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function jumpToNow() {
    const day = filters.values[DAY_KEY] ?? ANY;
    if (day === ANY || day === today) {
      scrollToNow();
      return;
    }
    scrollPending.current = true;
    filters.setValue(DAY_KEY, today);
  }

  /* ------------------------------------------------------------- render --- */

  // Inside the screen rather than instead of it — see `EventsListPage` for why a
  // bare `ErrorState` is a full-bleed message with no section title on it.
  if (loadError) {
    return (
      <FestivalScreen title="Schedule" eyebrow={participant?.house ?? 'Programme'}>
        <ErrorState title="Could not load schedule" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  const loading = events === null;
  const liveCount = rows.filter((row) => roundStatus(row, now) === 'live').length;
  const mine = rows.filter((row) => row.mine);
  const mineAhead = mine.filter((row) => row.start.getTime() > now);
  const nextUp = rows.find((row) => row.start.getTime() > now) ?? null;
  const soonCount = rows.filter(
    (row) => row.start.getTime() > now && row.start.getTime() - now <= 6 * 3_600_000,
  ).length;
  const todayHasRounds = days.some((day) => day.key === today);

  return (
    <FestivalScreen
      title="Schedule"
      // The house a participant belongs to, as on their dashboard — the eyebrow
      // is what tells the shared layout which area of the app you are in.
      eyebrow={participant?.house ?? 'Programme'}
      subtitle={
        loading
          ? 'Loading the programme…'
          : `${rows.length} round${rows.length === 1 ? '' : 's'} across ${days.length} day${days.length === 1 ? '' : 's'}`
      }
    >
      {/* 1 — The pulse row: the four figures worth reading before anything else.
             Same `StatGrid` as the dashboard's, so the two rows of figures are
             one row of figures in two places. */}
      <StatGrid loading={loading}>
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
              : `Next ${relativeLabel(nextUp.start, now)} · ${nextUp.eventName}`
          }
        />
        <StatCard
          icon={Radio}
          tone="success"
          label="Live Now"
          value={liveCount}
          footnote={
            soonCount > 0
              ? `${soonCount} starting within 6 hours`
              : liveCount > 0
                ? 'Running right now'
                : 'Nothing running'
          }
        />
        <StatCard
          icon={UserCheck}
          tone="accent"
          label="My Rounds"
          value={mine.length}
          footnote={
            mine.length === 0
              ? 'Register to see yours here'
              : `${mineAhead.length} still ahead of you`
          }
        />
      </StatGrid>

      {/* 2 — The command row: what is running, beside what the viewer has next. */}
      <NowPanel rows={rows} now={now} loading={loading} registeredCount={mine.length} />

      {/* 3 — The programme itself: the rail picks the day, the toolbar narrows
             it, the timeline draws it. One panel, so the controls read as acting
             on the thing directly below them. */}
      {/* 3 — `DetailPanel`, not a bespoke surface.
             This block used to hand-roll three things the shared panel already
             owns: `glass-panel` (the admin control board's translucent surface,
             which nothing else on a participant screen uses), `rounded-3xl` (a
             28px corner where every other card in the app has 20px), and a header
             whose accent bar and uppercase `h2` were a character-for-character
             copy of `SectionHeading`. Sitting directly under the pulse row and the
             Now panel, both of them opaque 20px cards, the difference read as this
             panel belonging to a different screen. `trailing` is exactly the slot
             "Jump to now" wanted. */}
      <DetailPanel
        title="Programme"
        trailing={
          todayHasRounds && (
            <button
              type="button"
              onClick={jumpToNow}
              className="tap inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-card ring-1 ring-line hover:bg-surface-2 active:scale-95"
            >
              <LocateFixed size={14} strokeWidth={2.25} aria-hidden />
              Jump to now
            </button>
          )
        }
      >
        {loading ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-24 rounded-2xl" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No scheduled rounds yet"
            description="Event timings appear here once the organisers publish them."
            icon={CalendarDays}
          />
        ) : (
          <>
            <DayRail
              days={days}
              value={filters.values[DAY_KEY] ?? ANY}
              onChange={(next) => filters.setValue(DAY_KEY, next)}
              today={today}
              total={rows.length}
            />

            <ListToolbar
              filters={filters}
              specs={[categorySpec]}
              advancedSpecs={[MINE_SPEC]}
              searchLabel="Search the schedule"
              searchPlaceholder="Event, round, venue…"
              shown={visible.length}
              total={rows.length}
              noun="rounds"
            />

            {visible.length === 0 ? (
              <EmptyState
                title="No matching rounds"
                description="Try a different day, a different search, or clear the filters."
                icon={CalendarDays}
              />
            ) : (
              <ScheduleTimeline
                groups={groups}
                now={now}
                today={today}
                showDayHeadings={groups.length > 1}
              />
            )}
          </>
        )}
      </DetailPanel>

      <ScreenNote icon={MapPin}>
        Timings are tentative — each event&apos;s page carries the latest.
      </ScreenNote>
    </FestivalScreen>
  );
}
