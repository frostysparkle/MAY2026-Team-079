import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type BannerVariant = 'success' | 'error' | 'warning';

const styles: Record<BannerVariant, string> = {
  success: 'bg-success-bg text-success',
  error: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
};

const icons: Record<BannerVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
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
  const Icon = icons[variant];
  return (
    <div
      role={variant === 'success' ? 'status' : 'alert'}
      className={cn(
        'animate-pop flex items-start gap-3 rounded-2xl p-4 ring-1 ring-inset ring-black/[0.03]',
        styles[variant],
        className,
      )}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/60">
        <Icon size={15} strokeWidth={2.25} />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
      </div>
    </div>
  );
}
