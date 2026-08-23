import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { buildScheduleDays, PUBLIC_SCHEDULE } from '@/features/events/publicSchedule';
import { usePublicEvents } from '@/features/events/usePublicEvents';
import { announce } from '@/components/a11y/Announcer';
import { cn } from '@/lib/cn';

/**
 * Public, pre-login fest schedule — day pills across the top, then that day's
 * sessions as time · title · venue cards, each with a shortcut to the venue on
 * Google Maps.
 *
 * The timetable is built from the published programme (`GET /events/public`), so
 * what a visitor sees is whatever the Super Admin has scheduled — editing a round's
 * start time in the dashboard changes this page.
 *
 * `PUBLIC_SCHEDULE` remains as the fallback for the case where the programme has
 * no dated rounds at all (an empty database, or a request that failed). Without it
 * the page would go blank; with it, a visitor still gets the published timetable.
 */
export default function PublicSchedulePage() {
  const [dayIndex, setDayIndex] = useState(0);
  const { events, loading } = usePublicEvents();

  const fromApi = useMemo(() => buildScheduleDays(events), [events]);
  const schedule = fromApi.length > 0 ? fromApi : PUBLIC_SCHEDULE;

  // A day index from a longer schedule must not survive a switch to a shorter one.
  const safeIndex = Math.min(dayIndex, Math.max(schedule.length - 1, 0));
  const day = schedule[safeIndex];

  function selectDay(index: number) {
    setDayIndex(index);
    const count = schedule[index].items.length;
    announce(`Showing ${schedule[index].date}, ${count} session${count === 1 ? '' : 's'}`);
  }

  return (
    <PublicPageChrome title="Schedule" active="Schedule" width="md">
      <div className="mt-8 flex flex-col gap-6">
        {/* Day selector */}
        <nav aria-label="Festival days" className="flex flex-wrap justify-center gap-2">
          {schedule.map((d, i) => (
            <button
              key={d.iso}
              type="button"
              aria-pressed={i === safeIndex}
              onClick={() => selectDay(i)}
              className={cn(
                'tap rounded-full px-4 py-2 text-sm font-semibold transition-colors active:scale-95',
                i === safeIndex
                  ? 'bg-brand text-white shadow-fab'
                  : 'bg-surface text-muted shadow-card ring-1 ring-line hover:text-ink',
              )}
            >
              {/* The date, not "Day N". Rounds run from May trials through the
                  fest week, so a sequential index would label 18 May as "Day 1"
                  and imply nineteen consecutive fest days. */}
              {d.date}
            </button>
          ))}
        </nav>

        {day && (
          <section aria-live="polite" className="animate-rise flex flex-col gap-4">
            <div className="text-center">
              <h2 className="text-2xl font-black tracking-tight text-brand sm:text-3xl">
                {day.date}
              </h2>
              <p className="mt-0.5 text-sm text-muted">
                {day.items.length} session{day.items.length === 1 ? '' : 's'}
              </p>
            </div>

            <ol className="flex flex-col gap-3">
              {day.items.map((item, i) => (
                <li
                  key={`${item.time}-${item.title}-${i}`}
                  className="flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line/70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-black leading-tight tracking-tight text-ink sm:text-2xl">
                      {item.time}
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-snug text-ink">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{item.venue}</p>
                  </div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${item.venue}, IIT Madras, Chennai`,
                    )}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`Find ${item.venue} on Google Maps`}
                    className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-accent text-white shadow-fab active:scale-90"
                  >
                    <ChevronRight size={20} strokeWidth={2.5} />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}

        <p className="text-center text-xs italic text-muted">
          {loading && fromApi.length === 0
            ? 'Loading the latest schedule…'
            : 'Schedule is tentative and subject to change.'}
        </p>
      </div>
    </PublicPageChrome>
  );
}
