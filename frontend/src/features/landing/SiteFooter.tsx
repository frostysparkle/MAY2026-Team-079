import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { SocialRow } from './SocialRow';
import { SUPPORT_EMAIL } from './socialLinks';

/**
 * Public footer. The site previously ended abruptly with no footer at all, which
 * left visitors with no way to reach the organisers and no secondary navigation
 * once they had scrolled past the hero.
 *
 * Only verified destinations appear here — see `socialLinks.ts`.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line/70 bg-surface/60">
      {/* Matches the landing page's own column so the footer lines up with the
          catalogue above it rather than sitting inside a narrower box. */}
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <Link to={ROUTES.splash} className="tap flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
                P
              </span>
              <span className="text-base font-black tracking-tight text-ink">Paradox Connect</span>
            </Link>
            <p className="max-w-sm text-sm leading-6 text-muted">
              The event platform and digital pass for Paradox, the annual festival of the IIT Madras
              BS Degree programme.
            </p>
          </div>

          <nav aria-label="Footer" className="flex flex-col gap-2 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Explore</p>
            <Link to={ROUTES.publicEvents} className="text-ink hover:text-brand hover:underline">
              Events
            </Link>
            <Link to={ROUTES.publicWorkshops} className="text-ink hover:text-brand hover:underline">
              Workshops
            </Link>
            <Link to={ROUTES.publicSchedule} className="text-ink hover:text-brand hover:underline">
              Schedule
            </Link>
            <Link to={ROUTES.sponsors} className="text-ink hover:text-brand hover:underline">
              Sponsors
            </Link>
          </nav>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Contact</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-sm font-semibold text-brand hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            <SocialRow />
          </div>
        </div>

        <p className="text-xs text-muted">
          Paradox, IIT Madras · Organised by students of the BS Degree programme.
        </p>
      </div>
    </footer>
  );
}
