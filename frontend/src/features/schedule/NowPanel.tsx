import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarClock, MapPin, Radio } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { LivePill } from '@/features/overview/board/LivePill';
import { path, ROUTES } from '@/config/routes';
import { cn } from '@/lib/cn';
import { relativeLabel, roundStatus, timeLabelOf, type ScheduleRow } from './festSchedule';

/**
 * The command row, borrowed from the admin board: what is running right now,
 * beside what the viewer personally has next.
 *
 * The board answers those two questions for the whole fest before it shows any
 * detail; a participant needs the same two answered about *their* fest, and
 * needs them without scrolling a programme of two hundred rounds. Everything
 * here is a projection of the same rows the timeline below draws, so the panel
 * and the timeline can never disagree.
 */
export function NowPanel({
  rows,
  now,
  loading,
  registeredCount,
}: {
  /** Every round in the fest, unfiltered — this panel ignores the day rail. */
  rows: ScheduleRow[];
  now: number;
  loading: boolean;
  /** Rounds the viewer holds a registration for, across the whole fest. */
  registeredCount: number;
}) {
  if (loading) {
    return <Skeleton className="h-56 rounded-3xl" />;
  }

  const live = rows.filter((row) => roundStatus(row, now) === 'live');
  const ahead = rows.filter((row) => row.start.getTime() > now);
  const mineAhead = ahead.filter((row) => row.mine);
  // Their own rounds when they have any, the fest's otherwise — an empty panel
  // would be the least useful thing to show someone who hasn't registered yet.
  const queue = mineAhead.length > 0 ? mineAhead : ahead;
  const next = queue[0] ?? null;

  return (
    <section
      aria-label="Now and next"
      className="glass-panel grid gap-5 rounded-3xl p-5 lg:grid-cols-2 lg:gap-6"
    >
      {/* ---- what is running ---- */}
      <div className="flex min-w-0 flex-col gap-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-ink">Happening now</h2>
          <LivePill
            live={live.length > 0}
            label="Live"
            count={`${live.length} running`}
            tone="success"
          />
        </header>

        {live.length === 0 ? (
          <Quiet
            icon={Radio}
            title="Nothing running right now"
            detail={
              ahead[0]
                ? `The fest picks up again ${relativeLabel(ahead[0].start, now)}, with ${ahead[0].eventName}.`
                : 'Every published round has finished.'
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-1.5 p-0">
            {live.slice(0, 4).map((row) => (
              <MiniRow key={row.id} row={row} trailing="Started" now={now} />
            ))}
            {live.length > 4 && (
              <li className="pl-1 text-[11px] text-muted">
                and {live.length - 4} more running now
              </li>
            )}
          </ul>
        )}
      </div>

      {/* ---- what the viewer has next ---- */}
      <div className="flex min-w-0 flex-col gap-3 lg:border-l lg:border-line/70 lg:pl-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-[0.14em] text-ink">
            {mineAhead.length > 0 ? 'Up next for you' : 'Up next'}
          </h2>
          {registeredCount > 0 && (
            <Link
              to={ROUTES.myRegistrations}
              className="tap inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-brand hover:bg-brand-light"
            >
              My registrations
              <ArrowUpRight size={13} strokeWidth={2.5} aria-hidden />
            </Link>
          )}
        </header>

        {next === null ? (
          <Quiet
            icon={CalendarClock}
            title="Nothing ahead"
            detail="Once the organisers publish more rounds, the next one shows up here."
          />
        ) : (
          <>
            {/* The one figure this half exists for: how long they have. */}
            <div className="group rounded-2xl">
              <div className="tap relative flex flex-col gap-1 rounded-2xl bg-surface p-3.5 shadow-card ring-1 ring-brand/20 group-hover:-translate-y-0.5 group-hover:shadow-lift">
                <p className="text-2xl font-black leading-none tracking-tight text-brand">
                  {relativeLabel(next.start, now)}
                </p>
                <Link
                  to={path(ROUTES.eventDetail, { eventId: next.eventId })}
                  className="text-sm font-bold leading-snug text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand"
                >
                  {next.eventName}
                </Link>
                <p className="text-xs text-muted">
                  {next.roundName} · {next.dayLabel}, {timeLabelOf(next.start)}
                </p>
                {next.venue && (
                  <p className="inline-flex items-center gap-1 text-xs text-muted">
                    <MapPin size={12} strokeWidth={2.25} aria-hidden className="shrink-0" />
                    <span className="truncate">{next.venue}</span>
                  </p>
                )}
              </div>
            </div>

            {queue.length > 1 && (
              <ul className="flex list-none flex-col gap-1.5 p-0">
                {queue.slice(1, 3).map((row) => (
                  <MiniRow key={row.id} row={row} trailing="Starts" now={now} />
                ))}
              </ul>
            )}

            {mineAhead.length === 0 && (
              <p className="text-[11px] text-muted">
                You have no rounds of your own ahead.{' '}
                <Link to={ROUTES.events} className="font-semibold text-brand hover:underline">
                  Browse events
                </Link>{' '}
                to fill this in.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** A one-line entry: what it is on the left, when it is on the right. */
function MiniRow({
  row,
  trailing,
  now,
}: {
  row: ScheduleRow;
  /** Verb in front of the relative time, e.g. "Starts in 20 min". */
  trailing: 'Started' | 'Starts';
  now: number;
}) {
  return (
    <li>
      <Link
        to={path(ROUTES.eventDetail, { eventId: row.eventId })}
        className="tap flex items-baseline justify-between gap-3 rounded-lg px-1.5 py-1 hover:bg-surface-2"
      >
        <span className="min-w-0 truncate text-xs font-semibold text-ink">
          {row.eventName}
          <span className="font-normal text-muted"> · {row.roundName}</span>
        </span>
        <span
          className={cn(
            'shrink-0 text-[11px] font-semibold tabular-nums',
            trailing === 'Started' ? 'text-success' : 'text-muted',
          )}
        >
          {trailing} {relativeLabel(row.start, now)}
        </span>
      </Link>
    </li>
  );
}

/** The empty half of the panel — stated plainly, with what to expect instead. */
function Quiet({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Radio;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-1 items-center gap-3 rounded-2xl bg-surface-2/60 p-3.5">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted ring-1 ring-line"
      >
        <Icon size={16} strokeWidth={2.1} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-bold text-ink">{title}</p>
        <p className="text-[11px] leading-relaxed text-muted">{detail}</p>
      </div>
    </div>
  );
}
