import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Ticket } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The poster tile the festival programme is built from — one component behind
 * both the public catalogue and the Super Admin dashboard, so the two cannot
 * drift apart visually.
 *
 * Renders an `<li>`, so it belongs inside a `<ul>`; use `EVENT_GRID_CLASS` for
 * that list to get the standard responsive grid.
 *
 * The `overlay` and `badge` slots are siblings of the link rather than children
 * of it: nesting a button inside an anchor is invalid, and it would make every
 * menu click also follow the card.
 */
export function EventPosterCard({
  to,
  name,
  poster,
  fallbackImage,
  badge,
  overlay,
  meta,
  dimmed = false,
}: {
  to: string;
  name: string;
  /** Poster URL. Falls back to `fallbackImage`, then to a gradient tile. */
  poster?: string;
  /** Category artwork to use when the poster is missing or fails to load. */
  fallbackImage?: string;
  /** Status pill pinned to the top-left, e.g. "Closed". */
  badge?: ReactNode;
  /** Controls pinned to the top-right, e.g. the ⋮ menu. */
  overlay?: ReactNode;
  /** Small line under the title, e.g. the category or round count. */
  meta?: ReactNode;
  /**
   * Fades the tile and stops it being followed — for something on the programme
   * that this viewer cannot take, e.g. a workshop clashing with one they booked.
   * The reason belongs in `meta`, so the card still says *why*. `badge` and
   * `overlay` stay live, since they sit outside the link.
   */
  dimmed?: boolean;
}) {
  const src = poster?.trim() || fallbackImage;

  return (
    <li className="relative flex flex-col">
      <Link
        to={to}
        aria-label={name}
        aria-disabled={dimmed || undefined}
        // `tabIndex={-1}` as well as `pointer-events-none`: the latter only stops
        // the mouse, so without it the card stays reachable by keyboard.
        tabIndex={dimmed ? -1 : undefined}
        className={cn('group block rounded-2xl', dimmed && 'pointer-events-none opacity-50')}
      >
        <div className="tap overflow-hidden rounded-2xl shadow-card ring-1 ring-line/70 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-lift">
          <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-2">
            {src ? (
              <img
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  // Only worth swapping when there is something else to show.
                  if (fallbackImage && e.currentTarget.src !== fallbackImage) {
                    e.currentTarget.src = fallbackImage;
                  }
                }}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
            ) : (
              // An event with no artwork at all — unlisted events, or one an
              // admin has not given a poster yet.
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-accent">
                <Ticket size={40} strokeWidth={1.5} className="text-white/90" />
              </div>
            )}
          </div>
        </div>
        {/* Scales with the card: at four-up the tiles are wide enough that the
            phone-sized title looked lost under them. */}
        <p className="mt-2.5 text-sm font-semibold leading-5 text-ink lg:text-base lg:leading-6">
          {name}
        </p>
      </Link>

      {meta && (
        <p className="mt-0.5 text-xs font-medium capitalize text-muted lg:text-sm">{meta}</p>
      )}

      {badge && <div className="absolute left-2 top-2 z-10">{badge}</div>}
      {overlay && <div className="absolute right-2 top-2 z-20">{overlay}</div>}
    </li>
  );
}

/**
 * The responsive grid the poster tiles are laid out on.
 *
 * Four columns is the widest it goes: a fifth column at `xl` squeezed each
 * poster down to roughly 200px, where the artwork and title both stopped being
 * readable. Capping at four gives every card ~25% more width and lets the
 * gutters open up instead.
 */
export const EVENT_GRID_CLASS =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6 xl:gap-8';
