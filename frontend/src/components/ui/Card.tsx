import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover lift + press feedback for tappable cards. */
  interactive?: boolean;
}

/** Rounded, softly-elevated surface container. */
export function Card({ className, interactive, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]',
        interactive && 'tap cursor-pointer hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.99]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Row item for lists (e.g. the admin user list). Optionally clickable. */
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
        <div className="truncate text-sm font-medium text-gray-800">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted">{subtitle}</div>}
      </div>
      {trailing}
    </div>
  );
}
