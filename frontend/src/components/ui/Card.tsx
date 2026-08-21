import type { HTMLAttributes, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconTile, type IconTileTone } from './IconTile';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover-lift + press feedback for clickable cards. */
  interactive?: boolean;
}

/**
 * Soft-elevation surface container — the base building block for every list row
 * and panel.
 *
 * An interactive card is two elements on purpose. Hover hit-testing uses an
 * element's *transformed* box, so a card that lifts itself on `:hover` moves out
 * from under the cursor near its bottom edge, loses hover, drops back, and
 * oscillates. The outer element therefore stays untransformed and owns both
 * `:hover` and the click target, while the inner one carries the visuals and the
 * lift via `group-hover`. The outer box never moves, so the hover boundary is
 * stable everywhere on the card — corners included.
 */
export function Card({ interactive = false, className, children, ...props }: CardProps) {
  if (!interactive) {
    return (
      <div
        className={cn('rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]', className)}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="group cursor-pointer rounded-2xl" {...props}>
      <div
        className={cn(
          'tap rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]',
          'group-hover:-translate-y-0.5 group-hover:shadow-lift group-active:scale-[0.99]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A `Card` that reads as one row: a tinted icon tile, a title over a subtitle,
 * an optional badge, and the chevron that says it opens something.
 *
 * The dashboard is built almost entirely out of this shape — seven of them across
 * My Events, What's Next, Help & Support and My Pass — and each one was written
 * out by hand. They had drifted into three different title treatments (base
 * `font-medium`, base `font-semibold`, `text-sm font-medium`), and only some of
 * them truncated, so a long event name made its row taller than the row above it.
 * One component fixes the height of every row on the screen.
 *
 * Wrap it in a `<Link>` to make it navigate; it deliberately does not take a
 * `to`, because it is also used for rows that only ever report.
 */
export function CardRow({
  icon,
  tone = 'brand',
  title,
  subtitle,
  trailing,
  chevron = true,
  className,
}: {
  icon: LucideIcon;
  tone?: IconTileTone;
  title: ReactNode;
  subtitle?: ReactNode;
  /** A badge or chip before the chevron. */
  trailing?: ReactNode;
  /** Drop the chevron for a row that does not lead anywhere. */
  chevron?: boolean;
  className?: string;
}) {
  return (
    <Card interactive className={cn('flex items-center gap-3', className)}>
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{title}</p>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {trailing}
      {chevron && <ChevronRight size={18} aria-hidden className="shrink-0 text-muted" />}
    </Card>
  );
}

/** Row item for lists. Optionally clickable. */
export function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0',
        interactive && 'tap cursor-pointer hover:bg-surface-2',
      )}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      {trailing}
    </div>
  );
}
