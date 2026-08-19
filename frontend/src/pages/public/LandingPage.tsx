import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { LandingCatalogue } from '@/features/landing/LandingCatalogue';
import { ParadoxPortal, type PortalNavItem } from '@/features/landing/ParadoxPortal';
import { SiteFooter } from '@/features/landing/SiteFooter';
import { useAuthStore } from '@/stores/authStore';
import { usePublicEventCounts } from '@/features/events/usePublicEvents';
import { festivalDateRange } from '@/features/events/publicSchedule';
import { usePublicWorkshopCounts } from '@/features/workshops/usePublicWorkshops';

/**
 * Public landing page — the front door to Paradox Connect.
 *
 * It opens with the techfest-style "portal" hero (a huge centred PARADOX title
 * with navigation wrapped around it), then the Events and Workshops catalogue.
 *
 * Everything here is public information, so a prospective attendee can browse
 * the whole fest before ever creating an account. The event programme comes from
 * `GET /events/public`; only the category artwork and copy are local.
 * Registration itself lives behind sign-in, in the app shell at `/app`, where
 * the real backend is.
 */

export default function LandingPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const clear = useAuthStore((s) => s.clear);
  const authenticated = session !== null;

  /** Signed-in users go to whichever shell their token type allows. */
  const appHome = session?.token_type === 'staff' ? ROUTES.staffHome : ROUTES.home;

  // Perimeter navigation around the centred title.
  const nav: PortalNavItem[] = [
    { label: 'Home', href: '#top' },
    { label: 'Events', onClick: () => navigate(ROUTES.publicEvents) },
    { label: 'Schedule', onClick: () => navigate(ROUTES.publicSchedule) },
    { label: 'Workshops', onClick: () => navigate(ROUTES.publicWorkshops) },
    { label: 'Sponsors', onClick: () => navigate(ROUTES.sponsors) },
    { label: 'Staff', onClick: () => navigate(ROUTES.adminLogin) },
  ];

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <div className="min-h-[100dvh]">
        <ParadoxPortal
          nav={nav}
          authenticated={authenticated}
          onRegister={() => navigate(ROUTES.login, { state: { mode: 'register' } })}
          onSignIn={() => navigate(ROUTES.login)}
          onOpenPass={() => navigate(ROUTES.myQr)}
          onOpenProfile={() => navigate(appHome)}
          onSignOut={() => clear()}
        />
      </div>

      <main id="main">
        {!authenticated && (
          <VisitorIntro
            onRegister={() => navigate(ROUTES.login, { state: { mode: 'register' } })}
          />
        )}
        <LandingCatalogue authenticated={authenticated} />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------- visitor intro --- */

/**
 * What the fest is, when it runs, and how big it is — for someone who has not
 * signed in. Every number here is derived from the published catalogue rather
 * than asserted, so it cannot drift out of date.
 */
function VisitorIntro({ onRegister }: { onRegister: () => void }) {
  const dates = festivalDateRange();
  const { total } = usePublicEventCounts();
  const { total: workshopTotal } = usePublicWorkshopCounts();

  return (
    <section
      aria-labelledby="visitor-intro-title"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-10 sm:px-6"
    >
      <div className="flex flex-col gap-6 rounded-3xl bg-surface p-6 shadow-card ring-1 ring-line/70 sm:p-8">
        {/* The copy is capped at a readable measure, which on a wide screen left
            the right half of this card empty. The facts move into that space as
            a panel rather than sitting in a full-width row underneath it. */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-12">
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand">
              IIT Madras BS Degree
            </p>
            <h2
              id="visitor-intro-title"
              className="max-w-2xl text-2xl font-black leading-tight tracking-tight text-ink sm:text-3xl"
            >
              The annual techno-cultural and sports festival, on campus in Chennai.
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-muted sm:text-base">
              Compete, attend workshops, and meet the rest of the programme in person. Browse
              everything below — you only need an account to register or to book a hostel room.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-4 rounded-2xl bg-surface-2/60 p-5 ring-1 ring-line/60 sm:grid-cols-4 lg:grid-cols-2">
            {dates && <IntroFact label="Dates" value={dates} />}
            <IntroFact label="Venue" value="IIT Madras" />
            {/* Always rendered so the panel cannot reflow when the counts
                arrive; a non-breaking space holds the line until then. */}
            <IntroFact label="Events" value={total == null ? '\u00A0' : String(total)} />
            <IntroFact
              label="Workshops"
              value={workshopTotal == null ? ' ' : String(workshopTotal)}
            />
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onRegister}
            className="tap rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
          >
            Create account
          </button>
          <Link
            to={ROUTES.publicSchedule}
            className="tap rounded-full bg-surface-2 px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-ink hover:bg-surface active:scale-95"
          >
            See the schedule
          </Link>
        </div>
      </div>
    </section>
  );
}

function IntroFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-black text-ink">{value}</dd>
    </div>
  );
}
