import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Heading for a block within a festival-themed screen: an accent bar, an
 * uppercase wide-tracked title, and an optional count beside it.
 *
 * Shared so every staff section groups its content the same way — the public
 * brochure's typographic voice, rather than each page inventing its own.
 */
export function SectionHeading({
  title,
  meta,
  accentColor,
  className,
}: {
  title: string;
  /** Small muted note beside the title, usually a count. */
  meta?: ReactNode;
  /** Overrides the brand accent, e.g. an event category's colour. */
  accentColor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span
        aria-hidden
        className={cn('h-5 w-1.5 shrink-0 rounded-full', !accentColor && 'bg-brand')}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      />
      <h2 className="text-lg font-black uppercase tracking-[0.12em] text-ink">{title}</h2>
      {meta && <span className="text-sm font-medium text-muted">{meta}</span>}
    </div>
  );
}
