import { cn } from '@/lib/cn';

/** Skeleton placeholder block for loading states — a shimmering sweep, not a flat pulse. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('relative overflow-hidden rounded-lg bg-surface-2', className)}>
      <div className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}
