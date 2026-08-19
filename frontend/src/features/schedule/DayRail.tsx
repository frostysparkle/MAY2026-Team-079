import { ANY } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ScheduleDay } from './festSchedule';

/**
 * The schedule's primary navigation: one chip per fest day, plus an "all days"
 * chip, laid out as a horizontal strip.
 *
 * A day selector rather than a pager, because a schedule's natural chunk is a
 * day — "page 3 of 9" tells a participant nothing, "Fri 12 Jun · 14 rounds"
 * tells them everything. Today is named in words as well as marked with a dot,
 * so the strip still says which day is which in a screenshot, in greyscale, or
 * with animation off.
 *
 * It drives the same URL-backed `day` filter the rest of the toolbar uses, so a
 * chosen day survives a refresh and can be pasted into a group chat.
 *
 * Built as a radiogroup, like `ViewToggle`: the days are mutually exclusive, so
 * arrow keys should move between them and only the selected chip is a tab stop.
 */
export function DayRail({
  days,
  value,
  onChange,
  today,
  total,
}: {
  days: ScheduleDay[];
  /** A `dayKey`, or `ANY` for every day at once. */
  value: string;
  onChange: (next: string) => void;
  /** Today's `dayKey`, whether or not it carries any rounds. */
  today: string;
  /** Rounds across every day, for the "all days" chip. */
  total: number;
}) {
  const options = [ANY, ...days.map((day) => day.key)];
  const tomorrow = dayAfter(today);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? options[(index + 1) % options.length]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? options[(index - 1 + options.length) % options.length]
          : event.key === 'Home'
            ? options[0]
            : event.key === 'End'
              ? options[options.length - 1]
              : null;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Fest day"
      className="no-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1"
    >
      <DayChip
        selected={value === ANY}
        onSelect={() => onChange(ANY)}
        onKeyDown={(event) => onKeyDown(event, 0)}
        top="All"
        figure={days.length}
        bottom={`day${days.length === 1 ? '' : 's'}`}
        count={total}
        label={`All days, ${total} round${total === 1 ? '' : 's'}`}
      />

      {days.map((day, index) => {
        // "Today"/"Tomorrow" replace the weekday on screen, so they have to
        // reach the accessible name too — the chip's `aria-label` is what a
        // screen reader hears instead of its text, and dropping the word would
        // hide the one thing the marker dot is there to say.
        const relative = day.key === today ? 'Today' : day.key === tomorrow ? 'Tomorrow' : null;

        return (
          <DayChip
            key={day.key}
            selected={value === day.key}
            onSelect={() => onChange(day.key)}
            onKeyDown={(event) => onKeyDown(event, index + 1)}
            top={relative ?? day.weekday}
            figure={day.dayNumber}
            bottom={day.month}
            today={day.key === today}
            count={day.count}
            label={`${relative ? `${relative}, ` : ''}${day.label}, ${day.count} round${
              day.count === 1 ? '' : 's'
            }`}
          />
        );
      })}
    </div>
  );
}

/** The `YYYY-MM-DD` after the given one, month and year rollovers included. */
function dayAfter(key: string): string {
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + 1);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * One chip. Two elements, not one, and this is the project's standing rule:
 * hover hit-testing uses an element's *transformed* box, so a chip that lifts
 * itself slides out from under a cursor resting at its edge, loses hover, drops
 * back and vibrates. The stable outer box owns `:hover`; the inner one moves.
 */
function DayChip({
  selected,
  onSelect,
  onKeyDown,
  top,
  figure,
  bottom,
  today = false,
  count,
  label,
}: {
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  top: string;
  figure: React.ReactNode;
  bottom: string;
  /** Draws the "this is today" dot. */
  today?: boolean;
  /** Rounds behind this chip. */
  count: number;
  /** Accessible name — the chip's own text is abbreviated. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="group shrink-0 snap-start rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <span
        className={cn(
          'tap flex w-[4.5rem] flex-col items-center gap-0.5 rounded-2xl px-2 py-2.5 ring-1 transition-colors sm:w-20',
          'group-hover:-translate-y-0.5',
          selected
            ? 'bg-brand text-white shadow-fab ring-brand'
            : 'bg-surface text-ink shadow-card ring-line group-hover:bg-surface-2',
        )}
      >
        <span
          className={cn(
            'flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em]',
            selected ? 'text-white/85' : 'text-muted',
          )}
        >
          {today && (
            <span
              aria-hidden
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                selected ? 'bg-white' : 'bg-accent',
              )}
            />
          )}
          {top}
        </span>
        <span className="text-xl font-black leading-none tabular-nums">{figure}</span>
        <span
          className={cn('text-[11px] font-semibold', selected ? 'text-white/85' : 'text-muted')}
        >
          {bottom}
        </span>
        <span
          className={cn(
            'mt-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums',
            selected ? 'bg-white/20 text-white' : 'bg-surface-2 text-muted',
          )}
        >
          {count}
        </span>
      </span>
    </button>
  );
}
