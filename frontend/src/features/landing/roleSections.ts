import { ROUTES } from '@/config/routes';
import type { Session } from '@/stores/authStore';

/**
 * Which sections the PARADOX Landing Page offers, per role.
 *
 * Signing in does not change the shape of the site — it changes which sections
 * the perimeter nav around the wordmark lists, and which build of each section
 * those entries point at. A visitor's Events opens the public brochure; a
 * participant's opens the same catalogue inside the app shell, where registering
 * is possible; a Super Admin's opens the admin table. None of those pages are
 * redesigned or duplicated here — this module only decides which already-built
 * screen a label leads to.
 *
 * It is the single source of truth for three navs: the portal's perimeter links
 * (`ParadoxPortal` via `LandingPage`), the brochure rail (`PublicPageChrome`),
 * and — through the same labels and order — the shells' rails.
 */

export interface LandingSection {
  label: string;
  to: string;
}

/**
 * The Landing Page for this session. Every "Home" in the app resolves through
 * here, so a section screen always returns to the *role's* landing rather than
 * to the public one.
 */
export function homeRoute(session: Session | null): string {
  if (!session) return ROUTES.splash;
  return session.token_type === 'staff' ? ROUTES.staffHome : ROUTES.home;
}

/** Signed out — the public festival brochure, plus the staff way in. */
const PUBLIC_SECTIONS: LandingSection[] = [
  { label: 'Events', to: ROUTES.publicEvents },
  { label: 'Schedule', to: ROUTES.publicSchedule },
  { label: 'Workshops', to: ROUTES.publicWorkshops },
  { label: 'Sponsors', to: ROUTES.sponsors },
  { label: 'Staff', to: ROUTES.adminLogin },
];

/**
 * A participant. Events/Workshops/Schedule point into the app shell rather than
 * the brochure, because those are the builds that can register, book, and show
 * "you are in" state. Sponsors has no signed-in build, so it stays the public
 * page — reached, like every other section, from this same landing.
 *
 * Announcements and Help & Support close a gap that made both of them look
 * unbuilt. `AppShell`'s rail has always listed them, but the rail only exists
 * *inside* a section — so a student who signed in and went to Events from the
 * portal had no way to discover that the fest could be asked a question at all,
 * and the portal is the screen they land on. A section reachable from one of two
 * navs is a section half the users never find.
 *
 * My Pass and Profile are still absent on purpose: the portal's own top bar
 * carries them for a signed-in participant, and a second copy could only drift.
 */
const PARTICIPANT_SECTIONS: LandingSection[] = [
  { label: 'Events', to: ROUTES.events },
  { label: 'Workshops', to: ROUTES.workshops },
  { label: 'Schedule', to: ROUTES.schedule },
  { label: 'Stay', to: ROUTES.accommodation },
  { label: 'Sponsors', to: ROUTES.sponsors },
  { label: 'Dashboard', to: ROUTES.dashboard },
  { label: 'Announcements', to: ROUTES.announcements },
  { label: 'Help & Support', to: ROUTES.support },
];

/** A Super Admin — the fest-wide sections, in the order the rail used to list them. */
const SUPER_ADMIN_SECTIONS: LandingSection[] = [
  { label: 'Overview', to: ROUTES.adminOverview },
  { label: 'Events', to: ROUTES.adminEvents },
  { label: 'Workshops', to: ROUTES.adminWorkshops },
  { label: 'Mess', to: ROUTES.adminMess },
  { label: 'Hostels', to: ROUTES.adminHostels },
  { label: 'Staff', to: ROUTES.adminBackendTeams },
  { label: 'Audit Logs', to: ROUTES.adminAuditLogs },
];

/**
 * Any other staffer — volunteer, event head, mess/hostel team. Their one
 * role-specific screen is the duty list; the rest of the programme is the public
 * brochure, which they can read like anyone else. Scanners are deliberately
 * missing: they are per-entity routes, reached from the duty list that names
 * which mess, hostel, event, or workshop is actually theirs.
 */
const STAFF_SECTIONS: LandingSection[] = [
  { label: 'Duties', to: ROUTES.staffDuties },
  { label: 'Events', to: ROUTES.publicEvents },
  { label: 'Schedule', to: ROUTES.publicSchedule },
  { label: 'Workshops', to: ROUTES.publicWorkshops },
  { label: 'Sponsors', to: ROUTES.sponsors },
];

/**
 * The sections this session may open, Home first. Role decides the list; the
 * presentation around it never changes.
 */
export function landingSections(session: Session | null): LandingSection[] {
  const home: LandingSection = { label: 'Home', to: homeRoute(session) };
  if (!session) return [home, ...PUBLIC_SECTIONS];
  if (session.token_type === 'participant') return [home, ...PARTICIPANT_SECTIONS];
  return [home, ...(session.role === 'super_admin' ? SUPER_ADMIN_SECTIONS : STAFF_SECTIONS)];
}
