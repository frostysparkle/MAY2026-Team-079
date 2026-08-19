import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile } from './IconTile';

/** Explicit empty state so screens never render as a blank/broken page. */
export function EmptyState({
  title,
  description,
  icon = Inbox,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <IconTile icon={icon} tone="muted" size="lg" />
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="max-w-xs text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
