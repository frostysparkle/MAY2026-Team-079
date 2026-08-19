import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { PUBLIC_SCHEDULE } from '@/features/events/publicSchedule';
import { announce } from '@/components/a11y/Announcer';
import { cn } from '@/lib/cn';

/**
 * Public, pre-login fest schedule — day pills across the top, then that day's
 * sessions as time · title · venue cards, each with a shortcut to the venue on
 * Google Maps.
 *
 * Driven entirely by the static `PUBLIC_SCHEDULE` dataset, so it works with no
 * backend and no authentication.
 */
export default function PublicSchedulePage() {
  const [dayIndex, setDayIndex] = useState(0);
  const day = PUBLIC_SCHEDULE[dayIndex];

  function selectDay(index: number) {
    setDayIndex(index);
    announce(
      `Showing ${PUBLIC_SCHEDULE[index].date}, ${PUBLIC_SCHEDULE[index].items.length} sessions`,
    );
  }

  return (
    <PublicPageChrome title="Schedule" active="Schedule" width="md">
      <div className="mt-8 flex flex-col gap-6">
        {/* Day selector */}
        <nav aria-label="Festival days" className="flex flex-wrap justify-center gap-2">
          {PUBLIC_SCHEDULE.map((d, i) => (
            <button
              key={d.iso}
              type="button"
              aria-pressed={i === dayIndex}
              onClick={() => selectDay(i)}
              className={cn(
                'tap rounded-full px-4 py-2 text-sm font-semibold transition-colors active:scale-95',
                i === dayIndex
                  ? 'bg-brand text-white shadow-fab'
                  : 'bg-surface text-muted shadow-card ring-1 ring-line hover:text-ink',
              )}
            >
              Day {i + 1}
            </button>
          ))}
        </nav>

        {day && (
          <section aria-live="polite" className="animate-rise flex flex-col gap-4">
            <div className="text-center">
              <h2 className="text-2xl font-black tracking-tight text-brand sm:text-3xl">
                {day.date}
              </h2>
              <p className="mt-0.5 text-sm text-muted">{day.items.length} sessions</p>
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
          Schedule is tentative and subject to change.
        </p>
      </div>
    </PublicPageChrome>
  );
}
