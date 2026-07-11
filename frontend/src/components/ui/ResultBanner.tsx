import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BannerVariant = 'success' | 'error' | 'warning';

const styles: Record<BannerVariant, string> = {
  success: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
};

const icons: Record<BannerVariant, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
};

/**
 * Status banner (Success / Error / Warning). Uses role="status" for success and
 * role="alert" for error/warning so assistive tech announces failures promptly.
 */
export function ResultBanner({
  variant,
  title,
  children,
  className,
}: {
  variant: BannerVariant;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={variant === 'success' ? 'status' : 'alert'}
      className={cn('flex items-start gap-3 rounded-lg p-4', styles[variant], className)}
    >
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/60 text-sm font-bold"
      >
        {icons[variant]}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
      </div>
    </div>
  );
}
