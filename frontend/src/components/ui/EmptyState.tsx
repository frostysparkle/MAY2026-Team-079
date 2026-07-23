import type { ReactNode } from 'react';

/** Explicit empty state so screens never render as a blank/broken page. */
export function EmptyState({
  title,
  description,
  icon = '📭',
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
