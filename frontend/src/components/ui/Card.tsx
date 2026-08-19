import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

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
