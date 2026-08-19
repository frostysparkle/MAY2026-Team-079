import { Link } from 'react-router-dom';
import { path, ROUTES } from '@/config/routes';
import { PUBLIC_EVENT_CATEGORIES } from '@/features/events/publicEvents';
import { usePublicEventCounts } from '@/features/events/usePublicEvents';
import {
  usePublicWorkshopCounts,
  usePublicWorkshops,
} from '@/features/workshops/usePublicWorkshops';
import { WORKSHOP_COVER } from '@/features/workshops/workshopView';

/**
 * The public Events and Workshops catalogue — category card art linking into the
 * public event lists, and a preview strip of workshop flyers.
 *
 * It lives here rather than inside `LandingPage` because the same catalogue is
 * the body of more than one screen, and every record it shows is public: the
 * counts come from `GET /events/public` and `GET /workshops/public`, the artwork
 * and copy are local.
 */
export function LandingCatalogue({ authenticated }: { authenticated: boolean }) {
  const { counts } = usePublicEventCounts();
  const { views: workshops } = usePublicWorkshops();
  const { total: workshopTotal } = usePublicWorkshopCounts();

  // A compact preview of the workshop flyers (the full list is one tap away).
  const workshopPreview = workshops.slice(0, 8);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-4 pb-16 pt-10 sm:px-6">
      {/* Events */}
      <section aria-labelledby="landing-events-title" className="flex flex-col gap-5">
        <div className="flex items-end justify-between">
          <h2
            id="landing-events-title"
            className="text-2xl font-black uppercase tracking-[0.12em] text-ink sm:text-3xl"
          >
            Events
          </h2>
          <Link
            to={ROUTES.publicEvents}
            className="text-sm font-semibold text-brand hover:underline"
          >
            View all
          </Link>
        </div>
        <ul className="grid gap-6 sm:grid-cols-3 sm:gap-8">
          {PUBLIC_EVENT_CATEGORIES.map((c) => (
            <li key={c.slug} className="flex flex-col">
              <Link
                to={path(ROUTES.publicEventCategory, { category: c.slug })}
                aria-label={
                  counts?.[c.slug] == null ? c.label : `${c.label} — ${counts[c.slug]} events`
                }
                className="group block rounded-2xl"
              >
                {/* The lift lives on this inner wrapper so the Link's own box —
                    and therefore the hover boundary — never moves. */}
                <div className="tap overflow-hidden rounded-2xl transition-transform duration-300 group-hover:-translate-y-1.5">
                  {/* Intrinsic size of the category card art. Unlike the poster
                      grids below, this image has no aspect-ratio container, so
                      without width/height the row collapses and then jumps as
                      each card loads. */}
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
              </Link>
              {/* The card art carries no machine-readable text, so the category
                  name and count live on the Link's aria-label instead of as
                  visible copy. */}
            </li>
          ))}
        </ul>
      </section>

      {/* Workshops */}
      <section aria-labelledby="landing-workshops-title" className="flex flex-col gap-5">
        <div className="flex items-end justify-between">
          <h2
            id="landing-workshops-title"
            className="text-2xl font-black uppercase tracking-[0.12em] text-ink sm:text-3xl"
          >
            Workshops
          </h2>
          <Link
            to={ROUTES.publicWorkshops}
            className="text-sm font-semibold text-brand hover:underline"
          >
            {workshopTotal == null ? 'View all' : `View all ${workshopTotal}`}
          </Link>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5">
          {workshopPreview.map((w) => (
            <li key={w.id}>
              <Link
                to={path(ROUTES.publicWorkshopDetail, { workshopId: w.id })}
                aria-label={w.name}
                className="group block rounded-2xl"
              >
                <div className="tap overflow-hidden rounded-2xl shadow-card transition-transform duration-300 group-hover:-translate-y-1.5">
                  <div className="relative aspect-[210/297] w-full overflow-hidden bg-surface-2">
                    <img
                      src={w.poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        if (!e.currentTarget.src.endsWith(WORKSHOP_COVER)) {
                          e.currentTarget.src = WORKSHOP_COVER;
                        }
                      }}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {!authenticated && (
        <p className="text-sm text-muted">
          Registration for events and workshops opens once you{' '}
          <Link to={ROUTES.login} className="font-semibold text-brand hover:underline">
            create an account
          </Link>
          .
        </p>
      )}
    </div>
  );
}
