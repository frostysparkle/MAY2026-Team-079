import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The column counts a masonry is offered.
 *
 * `3` is the full-width case — the participant dashboard, Profile, and the staff
 * home — and `2` is for a masonry that already sits in one half of a screen, like
 * the guidance beside the pass on My QR.
 */
const COLUMNS = {
  2: 'columns-1 xl:columns-2',
  3: 'md:columns-2 xl:columns-3',
} as const;

/**
 * Panels packed into balanced columns rather than laid out on a grid.
 *
 * A grid row is as tall as its tallest cell, so a row of panels 3 and 4 facts
 * deep leaves the shorter one trailing a strip of empty surface — and a panel
 * that then spans the full width starts below the taller of them, opening a hole
 * beside the shorter one. CSS columns pack by height instead, so the columns end
 * level and nothing is padded out to match a neighbour. `break-inside-avoid`
 * keeps a panel whole rather than splitting it across a column boundary.
 *
 * Shared because three screens had already written this exact declaration out,
 * and the two that had not — My QR's guidance column — used the grid it replaces.
 */
export function PanelMasonry({
  columns = 3,
  className,
  children,
}: {
  columns?: keyof typeof COLUMNS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        // The gap is the column gutter; the margin is the row gutter. Both are
        // the 5 units `FestivalScreen` puts between its own children, so a
        // masonry's panels are spaced exactly like the blocks around it.
        'gap-5 [&>*]:mb-5 [&>*]:break-inside-avoid',
        COLUMNS[columns],
        className,
      )}
    >
      {children}
    </div>
  );
}
