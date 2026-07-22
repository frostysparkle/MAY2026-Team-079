import { cn } from '@/lib/cn';

/**
 * Shimmering skeleton placeholder for loading states. A gradient sweep moves
 * across a neutral block (nicer than a plain pulse). Purely presentational.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('relative overflow-hidden rounded-xl bg-surface-2', className)}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
    </div>
  );
}
