import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface FABProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label — required since the FAB is usually icon-only. */
  label: string;
  icon: LucideIcon;
  /** Optional text shown beside the icon (extended FAB). */
  extended?: string;
}

/**
 * Floating Action Button. Sits above the bottom navigation and respects the
 * device safe area. Brand gradient with a soft glow and press feedback.
 */
export function FAB({ label, icon: Icon, extended, className, ...props }: FABProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'tap fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-2',
        'rounded-full bg-gradient-to-br from-brand to-brand-dark font-semibold text-white shadow-fab',
        'active:scale-95',
        extended ? 'px-5 py-4 pr-6' : 'h-14 w-14 justify-center',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden size={22} strokeWidth={2} />
      {extended && <span className="text-sm">{extended}</span>}
    </button>
  );
}
