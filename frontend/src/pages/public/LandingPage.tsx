import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { ParadoxPortal, type PortalNavItem } from '@/features/landing/ParadoxPortal';
import { landingSections } from '@/features/landing/roleSections';
import { useAuthStore } from '@/stores/authStore';

/**
 * The Landing Page — the front door to Paradox Connect, and the home screen of
 * every role behind it.
 *
 * It is a single, fixed-height screen: the techfest-style "portal" hero, and
 * nothing else. The page fills exactly one viewport and does not scroll, so the
 * wordmark, the navigation wrapped around it, and the official links are the
 * whole of the first impression. Everything that used to sit underneath it (the
 * visitor intro, the Events and Workshops catalogue, the footer) now lives on
 * the sections the perimeter navigation opens, which is where a visitor was
 * going anyway.
 *
 * The same component is mounted three times: at `/` for a visitor, at `/app` for
 * a signed-in participant, and at `/staff` for a staffer or Super Admin. Signing
 * in therefore does not replace this experience with a sidebar dashboard — it
 * only changes which sections `landingSections` puts around the wordmark, and
 * which build of each section they open. There is no role-specific landing
 * *design*, because there is only one landing.
 */

export default function LandingPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const clear = useAuthStore((s) => s.clear);
  const authenticated = session !== null;
  const participant = session?.token_type === 'participant';

  // Perimeter navigation around the centred title — the sections this role may
  // open. "Home" is the page we are already on, so it points at the hero itself
  // rather than re-navigating; everywhere else it is a real link to `homeRoute`.
  const nav: PortalNavItem[] = landingSections(session).map((section) =>
    section.label === 'Home'
      ? { label: 'Home', href: '#top' }
      : { label: section.label, onClick: () => navigate(section.to) },
  );

  return (
    // A single viewport, clipped: this screen is deliberately not scrollable.
    <div className="h-[100dvh] overflow-hidden bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <ParadoxPortal
        nav={nav}
        authenticated={authenticated}
        onRegister={() => navigate(ROUTES.login, { state: { mode: 'register' } })}
        onSignIn={() => navigate(ROUTES.login)}
        // The pass and the profile screen are participant-only routes, so a
        // staff session is offered neither — a staffer following them would
        // only reach Access Denied.
        onOpenPass={participant ? () => navigate(ROUTES.myQr) : undefined}
        onOpenProfile={participant ? () => navigate(ROUTES.profile) : undefined}
        // This landing is mounted behind a guard at `/app` and `/staff` too,
        // so dropping the session there would bounce to a login screen. Send
        // the visitor to the public landing instead — same page, signed out.
        onSignOut={() => {
          clear();
          navigate(ROUTES.splash, { replace: true });
        }}
      />
    </div>
  );
}
