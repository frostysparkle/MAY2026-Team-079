import { cn } from '@/lib/cn';
import { formatAge } from '../format';
import type { TierState } from '../useFestSnapshot';
import { useTick } from './useTick';

/**
 * "Updated 14s ago", turning amber once a tier is more than five minutes stale.
 *
 * A figure without its age is a figure an admin cannot safely act on, so this is
 * never optional — every panel on the board carries one. Shared by the board
 * panels and the eight domain panels so the whole page ages identically.
 */
export function Staleness({ tier, className }: { tier: TierState; className?: string }) {
  const now = useTick();

  if (tier.updatedAt === null) {
    return (
      <span className={cn('text-[11px] text-muted', className)}>
        {tier.loading ? 'Loading…' : 'No data'}
      </span>
    );
  }

  const seconds = Math.max(0, Math.round((now - tier.updatedAt.getTime()) / 1000));

  return (
    <span
      className={cn(
        'text-[11px] tabular-nums',
        seconds > 300 ? 'text-warning' : 'text-muted',
        className,
      )}
    >
      Updated {formatAge(seconds)}
    </span>
  );
}
