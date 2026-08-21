import { useState } from 'react';
import { Clock, CookingPot, Info, Pencil, Soup, Sunrise, Sunset } from 'lucide-react';
import type { MealSlot } from '@/api/types';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/ui';
import { MENU_SLOTS, SLOT_LABEL, timingLabel, type ResolvedMenu } from './messMenu';

const SLOT_ICON: Record<MealSlot, typeof Soup> = {
  breakfast: Sunrise,
  lunch: Soup,
  dinner: Sunset,
};

/** Day 3 → "Wed 11 Jun". Falls back to the stored weekday if the date will not parse. */
function dayLabel(iso: string, weekday: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return weekday;
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The mess menu as a participant reads it: one day at a time, three sittings,
 * each with the window it is served in and the dishes on it.
 *
 * A day picker rather than six days stacked, because the question this answers is
 * almost always "what is lunch today" — `initialDay` is wired to the current fest
 * day by the screens that use it, so that question is already answered on arrival
 * and the other five days are one tap away.
 *
 * Shared by the participant view and the mess team's editor, which renders its
 * unsaved draft through this same component. That is deliberate: a volunteer
 * editing Thursday's dinner is looking at the exact markup a student will, so
 * there is no second rendering that can quietly disagree with the first.
 */
export function MessMenuBoard({
  menu,
  initialDay = 1,
  /** Shown under the day picker — the caller's own caveat, e.g. that day 6 has no swipe. */
  dayNote,
  className,
}: {
  menu: ResolvedMenu;
  initialDay?: number;
  dayNote?: (day: number) => string | null;
  className?: string;
}) {
  const clamped = Math.min(Math.max(initialDay, 1), menu.days.length);
  const [day, setDay] = useState(clamped);
  const active = menu.days.find((d) => d.day === day) ?? menu.days[0];
  const note = dayNote?.(active.day) ?? null;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* ---- service windows, for the day on show ---- */}
      <div className="flex flex-wrap gap-2">
        {active.timings.map((timing) => (
          <span
            key={timing.slot}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-ink"
          >
            <Clock size={13} strokeWidth={2.25} aria-hidden className="text-muted" />
            {SLOT_LABEL[timing.slot]} · {timingLabel(timing)}
          </span>
        ))}
      </div>

      {/* ---- day picker ---- */}
      <div
        role="tablist"
        aria-label="Fest day"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
      >
        {menu.days.map((d) => (
          <button
            key={d.day}
            type="button"
            role="tab"
            aria-selected={d.day === day}
            onClick={() => setDay(d.day)}
            className={cn(
              'tap shrink-0 rounded-xl px-3 py-2 text-left transition-colors',
              d.day === day
                ? 'bg-brand text-white shadow-card'
                : 'bg-surface-2 text-muted hover:text-ink',
            )}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
              Day {d.day}
            </span>
            <span className="block text-sm font-bold">{dayLabel(d.date, d.weekday)}</span>
          </button>
        ))}
      </div>

      {note && (
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Info size={14} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
          {note}
        </p>
      )}

      {/* ---- the three sittings ---- */}
      <div className="grid gap-3 sm:grid-cols-3">
        {MENU_SLOTS.map((slot) => {
          const Icon = SLOT_ICON[slot];
          const timing = active.timings.find((t) => t.slot === slot);
          const dishes = active[slot];
          return (
            <section
              key={slot}
              className="flex min-w-0 flex-col gap-2 rounded-2xl bg-surface-2/60 p-4"
            >
              <header className="flex items-center gap-2">
                <Icon size={16} strokeWidth={2.25} aria-hidden className="shrink-0 text-brand" />
                <h4 className="flex-1 text-sm font-bold text-ink">{SLOT_LABEL[slot]}</h4>
                {active.edited[slot] && (
                  <StatusBadge tone="warning">
                    <Pencil size={11} strokeWidth={2.5} aria-hidden /> Edited
                  </StatusBadge>
                )}
              </header>
              {timing && <p className="text-xs font-medium text-muted">{timingLabel(timing)}</p>}

              {dishes.length === 0 ? (
                <p className="text-sm italic text-muted">Nothing recorded for this sitting.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm leading-relaxed text-ink">
                  {dishes.map((dish, i) => (
                    <li key={`${dish}-${i}`} className="flex gap-2">
                      <span aria-hidden className="text-muted">
                        ·
                      </span>
                      <span className="min-w-0 break-words">{dish}</span>
                    </li>
                  ))}
                </ul>
              )}

              {menu.common[slot] && (
                <p className="mt-auto border-t border-line pt-2 text-xs leading-relaxed text-muted">
                  <span className="font-semibold uppercase tracking-wide">Always served</span>
                  <br />
                  {menu.common[slot]}
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/* ---- provenance and caveats ---- */}
      <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted">
        {menu.note && (
          <p className="flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2 text-warning">
            <CookingPot size={14} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
            <span className="min-w-0">{menu.note}</span>
          </p>
        )}
        {menu.caveat && <p>{menu.caveat}</p>}
        <p>
          {menu.label}
          {menu.source ? ` · published sheet “${menu.source}”` : ''}
        </p>
      </div>
    </div>
  );
}
