import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FABProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label — required since the FAB is usually icon-only. */
  label: string;
  icon: ReactNode;
  /** Optional text shown beside the icon (extended FAB). */
  extended?: string;
}

/**
 * Floating Action Button. Sits above the bottom navigation and respects the
 * device safe area. Brand gradient with a soft glow and press feedback.
 */
export function FAB({ label, icon, extended, className, ...props }: FABProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'tap fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex items-center gap-2',
        'rounded-full bg-gradient-to-br from-brand to-brand-dark px-5 py-4 font-semibold text-white shadow-fab',
        'active:scale-95',
        extended ? 'pr-6' : 'aspect-square p-0 w-14 justify-center',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="text-xl leading-none">
        {icon}
      </span>
      {extended && <span className="text-sm">{extended}</span>}
    </button>
  );
}
