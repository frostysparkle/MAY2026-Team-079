import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Simple surface container. */
export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-line bg-surface p-4 shadow-sm', className)}
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
        interactive && 'cursor-pointer hover:bg-gray-50',
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
