import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

type Tone = 'brand' | 'success' | 'danger' | 'warning' | 'muted';
type Size = 'sm' | 'md' | 'lg';

const toneClasses: Record<Tone, string> = {
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  warning: 'bg-warning-bg text-warning',
  muted: 'bg-surface-2 text-muted',
};

const sizeClasses: Record<Size, { tile: string; icon: number }> = {
  sm: { tile: 'h-8 w-8 rounded-lg', icon: 16 },
  md: { tile: 'h-10 w-10 rounded-xl', icon: 20 },
  lg: { tile: 'h-14 w-14 rounded-2xl', icon: 26 },
};

/**
 * A colored icon tile — a Lucide icon on a tinted rounded-square background.
 * Used as the leading element on cards/list rows throughout the app so every
 * screen shares the same "iconed row" visual language.
 */
export function IconTile({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: Size;
  className?: string;
}) {
  const { tile, icon } = sizeClasses[size];
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center',
        toneClasses[tone],
        tile,
        className,
      )}
    >
      <Icon size={icon} strokeWidth={2} />
    </span>
  );
}
