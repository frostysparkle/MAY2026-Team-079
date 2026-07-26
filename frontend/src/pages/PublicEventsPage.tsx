import { useNavigate, useParams, Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AuroraBackdrop } from '@/features/landing/AuroraBackdrop';
import { PublicPageHeader } from '@/features/landing/PublicPageHeader';
import {
  PUBLIC_EVENT_CATEGORIES,
  getPublicEventCategory,
  type PublicEventCategory,
} from '@/features/events/publicEvents';

/**
 * Public, pre-login Events catalogue. Mirrors the reference site
 * (iitmparadox.org/events):
 *   /events            → light landing with three category cards
 *   /events/:category  → a dark, themed section page with a big centred title
 *                        and the category's poster grid
 *
 * No authentication required; the data is static (see features/events).
 * Fully responsive across mobile and desktop.
 */
export default function PublicEventsPage() {
  const navigate = useNavigate();
  const { category: slug } = useParams<{ category?: string }>();
  const category = getPublicEventCategory(slug);

  // Category section — dark, themed, reference-style page.
  if (category) {
    return <CategorySection category={category} />;
  }

  // Landing — the three category cards on the branded light backdrop.
  return (
    <div className="safe-top safe-bottom relative flex min-h-full flex-col overflow-hidden bg-canvas text-ink">
      <AuroraBackdrop />
      <PublicPageHeader />
      {/* Back to home — mirrors the back control on the category sections. */}
      <Link
        to={ROUTES.splash}
        aria-label="Back to home"
        className="tap fixed left-20 top-10 z-30 flex h-11 w-14 items-center justify-center rounded-2xl bg-brand text-lg text-white shadow-lg ring-1 ring-white/20 transition hover:brightness-110 active:scale-95 sm:left-24 sm:top-12"
      >
        ↩
      </Link>
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-6 sm:px-6 sm:pb-8">
        <CategoryGrid onOpen={(s) => navigate(ROUTES.publicEventsCategory(s))} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------- category grid --- */

function CategoryGrid({ onOpen }: { onOpen: (slug: string) => void }) {
  return (
    <div className="animate-rise flex flex-1 flex-col gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-black uppercase tracking-[0.18em] text-ink sm:text-4xl">
          Event Categories
        </h1>
      </div>

      <ul className="mx-auto grid w-full max-w-md gap-6 sm:max-w-none sm:grid-cols-3 sm:gap-8">
        {PUBLIC_EVENT_CATEGORIES.map((c) => (
          <li key={c.slug}>
            <button
              type="button"
              onClick={() => onOpen(c.slug)}
              aria-label={`${c.label} — ${c.events.length} events`}
              className="tap group block w-full overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-1.5"
            >
              {/* Exact portrait category card artwork from the reference site
                  (title + illustration are baked into the image). */}
              <img
                src={c.card}
                alt={`${c.label} — ${c.events.length} events`}
                loading="lazy"
                className="block h-auto w-full object-contain drop-shadow-lg transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------- category section --- */

function CategorySection({ category }: { category: PublicEventCategory }) {
  return (
    <div
      className="relative min-h-full text-white"
      style={{
        background: `radial-gradient(ellipse 90% 55% at 50% 0%, ${category.accent}44, ${category.darkBg} 60%)`,
        backgroundColor: category.darkBg,
      }}
    >
      <div className="safe-top safe-bottom relative mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-7">
        {/* Top bar: back (left) + menu/sign-in (right) */}
        <Link
          to={ROUTES.publicEvents}
          aria-label="Back to event categories"
          className="tap fixed left-20 top-10 z-30 flex h-11 w-14 items-center justify-center rounded-2xl text-lg text-white shadow-lg ring-1 ring-white/20 transition hover:brightness-110 active:scale-95 sm:left-24 sm:top-12"
          style={{ backgroundColor: category.accent }}
        >
          ↩
        </Link>

        {/* Big centred title */}
        <h1 className="mt-6 text-center font-serif text-5xl font-black uppercase tracking-[0.08em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] sm:mt-8 sm:text-7xl">
          {category.label}
        </h1>

        {/* Poster grid */}
        <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {category.events.map((event) => (
            <li key={event.name}>
              <Link
                to={ROUTES.publicEventDetail(category.slug, event.id)}
                aria-label={event.name}
                className="tap group block overflow-hidden rounded-2xl shadow-xl transition-transform duration-300 hover:-translate-y-1.5"
              >
                {/* Posters are a uniform 4:5 with their own frame baked in. */}
                <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ backgroundColor: category.darkBg }}>
                  <img
                    src={event.poster ?? category.image}
                    alt={event.name}
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (img.src !== window.location.origin + category.image) {
                        img.src = category.image;
                      }
                    }}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
