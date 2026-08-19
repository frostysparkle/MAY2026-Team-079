import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Clock, MapPin, Navigation } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { path, ROUTES } from '@/config/routes';
import { cn } from '@/lib/cn';
import {
  durationLabel,
  nowMarkerIndex,
  relativeLabel,
  roundStatus,
  timeLabelOf,
  type RoundStatus,
  type ScheduleDayGroup,
  type ScheduleRow,
  type ScheduleSlot,
} from './festSchedule';

/**
 * The programme as a timeline: days, then a gutter of start times down the left
 * with that moment's rounds hanging off it.
 *
 * This replaced a sortable table with a pager. The table could answer "sort every
 * round in the fest by venue", which nobody asked; it could not answer "what is
 * on after lunch", which is the only question a participant standing in a corridor
 * actually has. A timeline answers that by construction: time runs downwards, each
 * moment is printed once however many rounds share it, and where "now" falls is
 * drawn rather than calculated by the reader.
 *
 * Density is handled by the day rail above it rather than by paging — a day is
 * the chunk a schedule naturally comes in, and it is also the chunk a participant
 * plans in.
 */

/** How far ahead a round is called out as imminent. Matches the admin board. */
const SOON_MS = 6 * 3_600_000;

export function ScheduleTimeline({
  groups,
  now,
  today,
  showDayHeadings = true,
}: {
  groups: ScheduleDayGroup[];
  /** Epoch ms, ticking — drives the live badges, countdowns, and the now line. */
  now: number;
  /** Today's `dayKey`, so exactly one day can carry the now line. */
  today: string;
  /** Off when the rail has already narrowed to a single day. */
  showDayHeadings?: boolean;
}) {
  return (
    <ol className="flex list-none flex-col gap-7 p-0">
      {groups.map((group) => {
        const marker = nowMarkerIndex(group, now, today);

        return (
          <li key={group.day.key} className="flex flex-col gap-3">
            {showDayHeadings && <DayHeading group={group} today={today} />}

            <ol className="flex list-none flex-col p-0">
              {group.slots.map((slot, index) => (
                <Fragment key={slot.key}>
                  {marker === index && <NowLine now={now} />}
                  <SlotRow
                    slot={slot}
                    now={now}
                    last={index === group.slots.length - 1 && marker !== group.slots.length}
                  />
                </Fragment>
              ))}
              {marker === group.slots.length && <NowLine now={now} />}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------------- heading --- */

function DayHeading({ group, today }: { group: ScheduleDayGroup; today: string }) {
  const isToday = group.day.key === today;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line/70 pb-2">
      <h3 className="text-base font-black uppercase tracking-[0.12em] text-ink">
        {group.day.label}
      </h3>
      {isToday && <StatusBadge tone="info">Today</StatusBadge>}
      <span className="text-xs text-muted">
        {group.day.count} round{group.day.count === 1 ? '' : 's'} · {group.slots.length} time
        {group.slots.length === 1 ? '' : 's'}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------- now line --- */

/**
 * Where the present sits in the day.
 *
 * The one element on the page that is time-critical, so it is the one place the
 * accent hue is used structurally. It carries the clock as text as well as the
 * rule and the pulse: "now" has to be readable without seeing motion.
 */
function NowLine({ now }: { now: number }) {
  return (
    <li id="schedule-now" className="flex scroll-mt-24 items-center gap-3 py-1.5 sm:gap-4">
      <span className="w-14 shrink-0 text-right text-[10px] font-black uppercase tracking-[0.16em] text-accent sm:w-20">
        Now
      </span>
      <span className="relative flex w-3 shrink-0 items-center justify-center" aria-hidden>
        <span className="animate-pulse-ring absolute h-2.5 w-2.5 rounded-full bg-accent" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="h-px flex-1 bg-gradient-to-r from-accent/70 to-accent/0" />
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-accent">
          {timeLabelOf(new Date(now))}
        </span>
      </span>
    </li>
  );
}

/* --------------------------------------------------------------- slot --- */

/** One moment on the timeline: the time printed once, then everything at it. */
function SlotRow({ slot, now, last }: { slot: ScheduleSlot; now: number; last: boolean }) {
  // "9:00 am" splits into a figure and a meridiem so the gutter can stack them
  // and stay narrow on a phone. A 24-hour locale has no second part and simply
  // renders the clock alone.
  const [clock, meridiem] = slot.timeLabel.split(' ');
  const anyLive = slot.rows.some((row) => roundStatus(row, now) === 'live');

  return (
    <li className="flex gap-3 sm:gap-4">
      <div className="flex w-14 shrink-0 flex-col items-end pt-1.5 sm:w-20">
        <span className="text-sm font-black leading-none tabular-nums text-ink sm:text-base">
          {clock}
        </span>
        {meridiem && (
          <span className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
            {meridiem}
          </span>
        )}
      </div>

      {/* The rail. It runs the height of the slot so consecutive slots join into
          one continuous line, and stops just under the dot on the last one. */}
      <div className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span className={cn('absolute w-px bg-line', last ? 'top-0 h-5' : 'inset-y-0')} />
        <span
          className={cn(
            'relative mt-2 h-2.5 w-2.5 rounded-full ring-4 ring-canvas',
            anyLive ? 'bg-success' : 'bg-line',
          )}
        />
      </div>

      <ul className="flex min-w-0 flex-1 list-none flex-col gap-2 p-0 pb-5">
        {slot.rows.map((row) => (
          <li key={row.id}>
            <RoundCard row={row} now={now} />
          </li>
        ))}
      </ul>
    </li>
  );
}

/* --------------------------------------------------------------- card --- */

const STATUS_RING: Record<RoundStatus, string> = {
  live: 'ring-success/35 bg-success-bg/25',
  upcoming: 'ring-line bg-surface',
  past: 'ring-line/60 bg-surface',
};

/**
 * One round.
 *
 * The whole card is the link to the event, via a stretched pseudo-element on the
 * title rather than a wrapping anchor — the venue's map shortcut is a second
 * link, and an anchor inside an anchor is invalid. The title stays the accessible
 * name of the click target either way.
 */
export function RoundCard({ row, now }: { row: ScheduleRow; now: number }) {
  const status = roundStatus(row, now);
  const duration = durationLabel(row);
  const soon = status === 'upcoming' && row.start.getTime() - now <= SOON_MS;

  return (
    // Two elements: the outer box owns hover and never moves, the inner one
    // carries the lift. See `hoverStability.test.tsx`.
    <div className="group rounded-2xl">
      <div
        className={cn(
          'tap relative flex flex-col gap-2 rounded-2xl p-3.5 shadow-card ring-1 transition-colors',
          'group-hover:-translate-y-0.5 group-hover:shadow-lift',
          STATUS_RING[status],
          row.mine && status !== 'past' && 'ring-brand/30',
          status === 'past' && 'opacity-65',
        )}
        style={{ borderLeft: `3px solid ${row.accent}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              to={path(ROUTES.eventDetail, { eventId: row.eventId })}
              className="text-sm font-bold leading-snug text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand sm:text-[0.95rem]"
            >
              {row.eventName}
            </Link>
            <p className="mt-0.5 truncate text-xs font-medium text-muted">{row.roundName}</p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {status === 'live' && <StatusBadge tone="success">Live now</StatusBadge>}
            {soon && <StatusBadge tone="warning">{relativeLabel(row.start, now)}</StatusBadge>}
            {status === 'past' && <StatusBadge tone="neutral">Done</StatusBadge>}
            {row.mine && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-semibold text-brand-700">
                Registered
              </span>
            )}
          </div>
        </div>

        {row.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted">{row.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock size={12} strokeWidth={2.25} aria-hidden />
            {timeLabelOf(row.start)}
            {row.end && ` – ${timeLabelOf(row.end)}`}
            {duration && <span className="text-muted/80">· {duration}</span>}
          </span>

          {row.venue && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin size={12} strokeWidth={2.25} aria-hidden className="shrink-0" />
              <span className="truncate">{row.venue}</span>
            </span>
          )}

          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-semibold"
            style={{ color: row.accent }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: row.accent }}
            />
            {row.categoryLabel}
          </span>

          {row.venue && (
            <a
              // Above the title's stretched hit area, so the map shortcut stays
              // reachable without nesting one anchor inside another.
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${row.venue}, IIT Madras, Chennai`,
              )}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`Find ${row.venue} on Google Maps`}
              className="tap relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-line hover:text-brand active:scale-90"
            >
              <Navigation size={12} strokeWidth={2.5} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
