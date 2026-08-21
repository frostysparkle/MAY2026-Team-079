import { useNavigate, useParams, Link, Navigate } from 'react-router-dom';
import { path, ROUTES } from '@/config/routes';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  PUBLIC_EVENT_CATEGORIES,
  getPublicEventCategory,
  type PublicEventCategory,
} from '@/features/events/publicEvents';
import { EVENT_GRID_CLASS, EventPosterCard } from '@/features/events/EventPosterCard';
import { usePublicCategoryEvents, usePublicEventCounts } from '@/features/events/usePublicEvents';

/**
 * Public, pre-login Events catalogue:
 *   /events            → three category cards
 *   /events/:category  → that category's poster grid, with a big centred title
 *
 * No authentication required — the programme comes from `GET /events/public`, so
 * a visitor with no account sees exactly what the Super Admin has published.
 * The three categories and their artwork are presentation, and stay local;
 * everything about an individual event comes from the API.
 */
export default function PublicEventsPage() {
  const navigate = useNavigate();
  const { category: slug } = useParams<{ category?: string }>();
  const category = getPublicEventCategory(slug);

  if (slug && !category) return <Navigate to={ROUTES.splash} replace />;

  return (
    <PublicPageChrome title={category?.label ?? 'Events'} active="Events" width="xl">
      {category ? (
        <>
          <div className="mt-6 flex justify-center">
            <Link
              to={ROUTES.publicEvents}
              className="tap inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-card ring-1 ring-line"
            >
              ← All categories
            </Link>
          </div>
          <CategorySection category={category} />
        </>
      ) : (
        <CategoryGrid onOpen={(s) => navigate(path(ROUTES.publicEventCategory, { category: s }))} />
      )}
    </PublicPageChrome>
  );
}

/* ----------------------------------------------------- category grid --- */

function CategoryGrid({ onOpen }: { onOpen: (slug: string) => void }) {
  const { counts } = usePublicEventCounts();

  return (
    <div className="animate-rise mt-10 flex flex-1 flex-col gap-6">
      {/* This row used to bleed 6rem wider than its column (left-1/2 + a
          negative translate) to claw back some of the space the old symmetric
          gutters took. The column is wide enough now, so the cards get their
          size from the grid instead of from a positioning trick. */}
      <ul className="mx-auto grid w-full max-w-md gap-6 sm:max-w-none sm:grid-cols-3 sm:gap-8 lg:gap-10">
        {PUBLIC_EVENT_CATEGORIES.map((c) => {
          const count = counts?.[c.slug];
          return (
            <li key={c.slug} className="flex flex-col">
              <button
                type="button"
                onClick={() => onOpen(c.slug)}
                aria-label={count == null ? c.label : `${c.label} — ${count} events`}
                className="group block w-full rounded-2xl"
              >
                {/* The lift lives on this inner wrapper, never on the hover target
                  itself — see the note in components/ui/Card.tsx. */}
                <div className="tap overflow-hidden rounded-2xl transition-transform duration-300 group-hover:-translate-y-1.5">
                  <img
                    src={c.card}
                    alt=""
                    width={962}
                    height={1146}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
              </button>
              {/* The card art carries no machine-readable text, so the label and
                count live on the button's aria-label instead of as visible copy. */}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* -------------------------------------------------- category section --- */

function CategorySection({ category }: { category: PublicEventCategory }) {
  const { views, loading } = usePublicCategoryEvents(category.slug);

  // Placeholders in the real grid, so the page does not reflow when they resolve.
  if (loading) {
    return (
      <ul className={cn('mt-8', EVENT_GRID_CLASS)} aria-busy="true">
        {/* Two full rows of the four-up grid, so the placeholder block is not
            left with a ragged last row. */}
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={cn('mt-8', EVENT_GRID_CLASS)}>
      {views.map((view) => (
        <EventPosterCard
          key={view.id}
          to={path(ROUTES.publicEventDetail, { category: category.slug, eventId: view.id })}
          name={view.name}
          poster={view.poster}
          fallbackImage={category.image}
        />
      ))}
    </ul>
  );
}
