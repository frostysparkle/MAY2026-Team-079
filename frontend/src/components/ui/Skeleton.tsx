import { cn } from '@/lib/cn';

/** Skeleton placeholder block for loading states. Purely presentational. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-line', className)} />;
}
