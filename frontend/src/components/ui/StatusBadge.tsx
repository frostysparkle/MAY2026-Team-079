import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  neutral: 'bg-surface-2 text-muted',
};

/**
 * The single canonical status→color mapping used for every pill/badge in the
 * app (event open/closed, registration state, inside/outside, roles, etc.).
 * Keeping one component means a status always reads the same tone everywhere.
 */
export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
