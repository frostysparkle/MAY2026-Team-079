import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Heading for a block within a festival-themed screen: an accent bar, an
 * uppercase wide-tracked title, and an optional count beside it.
 *
 * Shared so every staff section groups its content the same way — the public
 * brochure's typographic voice, rather than each page inventing its own.
 */
export function SectionHeading({
  title,
  meta,
  accentColor,
  className,
}: {
  title: string;
  /** Small muted note beside the title, usually a count. */
  meta?: ReactNode;
  /** Overrides the brand accent, e.g. an event category's colour. */
  accentColor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        aria-hidden
        className={cn('h-5 w-1.5 shrink-0 rounded-full', !accentColor && 'bg-brand')}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      />
      <h2 className="text-lg font-black uppercase tracking-[0.12em] text-ink">{title}</h2>
      {meta && <span className="text-sm font-medium text-muted">{meta}</span>}
    </div>
  );
}

/**
 * The heading row a block puts its title and its trailing control on.
 *
 * Exported so `DetailPanel` and `SectionBlock` are guaranteed the same one: a
 * panelled block and an un-panelled block on the same screen have to align their
 * titles identically, and two copies of these four utilities is how they stop.
 */
export const HEADING_ROW_CLASS = 'flex flex-wrap items-center justify-between gap-x-3 gap-y-2';

/**
 * A titled block of content with no surface of its own — the un-panelled
 * counterpart of `DetailPanel`, on the same heading row and the same 4-unit gap
 * beneath it.
 *
 * Every screen that groups content under a `SectionHeading` used to open its own
 * `<section>` for it, and they disagreed: the participant dashboard and the staff
 * one sat their rows 3 units under the heading, while the event, workshop and
 * registration grids sat theirs 4 under. On a masonry where a dashboard panel and
 * a poster grid can end up side by side, that is a visible half-step. One wrapper
 * means one answer.
 */
export function SectionBlock({
  title,
  meta,
  accentColor,
  actions,
  className,
  children,
}: {
  title: string;
  /** Small muted note beside the title, usually a count. */
  meta?: ReactNode;
  /** Overrides the brand accent, e.g. an event category's colour. */
  accentColor?: string;
  /** Rendered at the far end of the heading row — a button or a chip. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `min-w-0` for the same reason `DetailPanel` has it: a block in a grid column
    // or a masonry column must be bounded by that column rather than by its
    // longest unbroken word.
    <section className={cn('flex min-w-0 flex-col gap-4', className)}>
      <div className={HEADING_ROW_CLASS}>
        <SectionHeading title={title} meta={meta} accentColor={accentColor} />
        {actions}
      </div>
      {children}
    </section>
  );
}
