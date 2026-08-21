import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconTile } from './IconTile';
import { HEADING_ROW_CLASS, SectionHeading } from './SectionHeading';

/**
 * The read-only counterpart of the admin list panels: the same `Card` surface
 * and the same `SectionHeading`, plus a slot on the heading row for a status
 * chip and a hairline footer for the one line of guidance a panel needs.
 *
 * Shared rather than re-typed per screen because the participant area's detail
 * screens (Profile, My QR) and the admin sections are meant to be the same
 * product: a panel here has to have the identical radius, padding, shadow and
 * heading rhythm as a panel there, or the two areas drift apart card by card —
 * which is exactly how the participant screens ended up looking hand-rolled
 * before.
 */
export function DetailPanel({
  title,
  meta,
  trailing,
  footer,
  className,
  children,
}: {
  title: string;
  /** Small muted note beside the title, usually a count. */
  meta?: ReactNode;
  /** Rendered at the far end of the heading row — a badge or a chip. */
  trailing?: ReactNode;
  /** One muted line under a hairline, for a caveat or a hint. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    // `min-w-0` so a panel placed in a grid column is bounded by that column
    // rather than by its longest unbroken value (an address, an email).
    <section
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03] sm:p-5',
        className,
      )}
    >
      <div className={HEADING_ROW_CLASS}>
        <SectionHeading title={title} meta={meta} />
        {trailing}
      </div>

      {children}

      {footer && (
        <div className="border-t border-line pt-3 text-xs leading-relaxed text-muted">{footer}</div>
      )}
    </section>
  );
}

/** The description list a panel's facts sit in. */
export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('flex flex-col', className)}>{children}</dl>;
}

/**
 * One labelled fact — a tinted icon, the label above the value, and a hairline
 * under it.
 *
 * Label-over-value rather than the label-left/value-right split this replaced:
 * that split reads well for a two-word value and badly for an address or an
 * email, which it pushes into a ragged right-aligned block. Stacking gives every
 * value the panel's full width and one consistent left edge to scan down.
 *
 * Laid out as a grid so the icon can sit beside both lines while `dt` and `dd`
 * stay direct children of the row `<div>`, which is what a `<dl>` allows.
 */
export function Fact({
  icon,
  label,
  value,
  hint,
  emptyText = 'Not added yet',
}: {
  icon: LucideIcon;
  label: string;
  /** A blank value renders as `emptyText`, never as an empty row. */
  value?: ReactNode;
  /** Optional third line, e.g. what the value is used for. */
  hint?: ReactNode;
  emptyText?: string;
}) {
  const empty = value === null || value === undefined || value === '';

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <IconTile icon={icon} size="sm" tone={empty ? 'muted' : 'brand'} className="row-span-2" />
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0">
        {empty ? (
          <span className="text-sm italic text-muted">{emptyText}</span>
        ) : (
          <span className="block break-words text-sm font-medium leading-relaxed text-ink">
            {value}
          </span>
        )}
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </dd>
    </div>
  );
}
