import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '@/router';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import type { ParticipantLoginResponse, StaffLoginResponse } from '@/api/types';

/**
 * The one thing this restructure has to keep true: signing in does not swap the
 * PARADOX Landing Page for a sidebar dashboard. Each role's home route renders
 * the same portal a visitor sees, with its own sections around the wordmark.
 */

const PARTICIPANT: ParticipantLoginResponse = {
  id: 'DS23F1000001',
  email: 'p@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'participant',
  full_name: 'Arjun Verma',
  dob: null,
  house: null,
  gender: null,
  phone: null,
  country: null,
  state: null,
  city: null,
  address: null,
  program: null,
  course_stage: null,
  photo: null,
  public_key: null,
};

const SUPER_ADMIN: StaffLoginResponse = {
  id: 'ST0001',
  email: 'admin@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'staff',
  role: 'super_admin',
  department: 'admin',
  designation: 'Super Admin',
};

const VOLUNTEER: StaffLoginResponse = {
  id: 'ST0002',
  email: 'wind-vol@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'staff',
  role: 'volunteer',
  department: 'technical',
  designation: 'Volunteer',
};

function renderAt(path: string) {
  return render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

/** The portal's perimeter nav, as opposed to a shell's rail. */
const perimeter = () => screen.getByRole('navigation', { name: 'Primary' });

describe('role landing routes', () => {
  beforeEach(() => useAuthStore.getState().clear());
  afterEach(() => useAuthStore.getState().clear());

  it('renders the landing for a visitor at "/"', () => {
    renderAt(ROUTES.splash);
    expect(screen.getByRole('heading', { name: 'PARADOX' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('gives a signed-in participant the same landing at /app, not a dashboard', () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.home);

    expect(screen.getByRole('heading', { name: 'PARADOX' })).toBeInTheDocument();
    // The portal, not the shell: no participant rail on the landing itself.
    expect(screen.queryByRole('navigation', { name: 'Participant sections' })).toBeNull();

    const nav = perimeter();
    for (const label of ['Home', 'Events', 'Workshops', 'Schedule', 'Stay']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    // Signed in, so the visitor's call to action is gone and the pass is offered.
    expect(screen.queryByRole('button', { name: 'Login' })).toBeNull();
    expect(screen.getByRole('button', { name: /Digital Pass/ })).toBeInTheDocument();
  });

  it('gives a Super Admin the landing at /staff with their own sections', () => {
    useAuthStore.getState().setStaffSession(SUPER_ADMIN);
    renderAt(ROUTES.staffHome);

    expect(screen.getByRole('heading', { name: 'PARADOX' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Staff sections' })).toBeNull();

    const nav = perimeter();
    for (const label of ['Home', 'Overview', 'Events', 'Workshops', 'Mess', 'Hostels']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    // Staff hold no participant pass, so it is not offered to them.
    expect(screen.queryByRole('button', { name: /Digital Pass/ })).toBeNull();
  });

  it('keeps the participant sections inside the shell, one Home away', () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.myQr);

    const rail = screen.getAllByRole('navigation', { name: 'Participant sections' })[0];
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute('href', ROUTES.home);
  });

  it('keeps the staff sections inside the shell, one Home away', () => {
    useAuthStore.getState().setStaffSession(SUPER_ADMIN);
    renderAt(ROUTES.staffChangePassword);

    const rail = screen.getAllByRole('navigation', { name: 'Staff sections' })[0];
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      ROUTES.staffHome,
    );
  });

  it('turns a participant away from the staff landing', () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.staffHome);
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });

  it('gives a volunteer the landing at /staff with their dashboard, not the admin sections', () => {
    useAuthStore.getState().setStaffSession(VOLUNTEER);
    renderAt(ROUTES.staffHome);

    const nav = perimeter();
    expect(within(nav).getByText('Dashboard')).toBeInTheDocument();
    expect(within(nav).queryByText('Audit Logs')).toBeNull();
  });

  it('keeps the participant dashboard as a section, no longer the /app index', () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.dashboard);

    const rail = screen.getAllByRole('navigation', { name: 'Participant sections' })[0];
    expect(within(rail).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      ROUTES.dashboard,
    );
  });

  it('keeps the staff dashboard as a section, no longer the /staff index', () => {
    useAuthStore.getState().setStaffSession(VOLUNTEER);
    renderAt(ROUTES.staffDuties);

    const rail = screen.getAllByRole('navigation', { name: 'Staff sections' })[0];
    // Labelled for the screen's own title. The route id stays `staffDuties`.
    expect(within(rail).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      ROUTES.staffDuties,
    );
    expect(within(rail).queryByRole('link', { name: 'Overview' })).toBeNull();
  });

  it('shows a signed-in participant their own sections on a brochure page', async () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.sponsors);

    // Sponsors is the one section with no signed-in build, so it stays the
    // public page — but its rail is the participant's, and Home leads back to
    // the participant landing rather than to `/`.
    const [rail] = await screen.findAllByRole('navigation', { name: 'Sections' });
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute('href', ROUTES.home);
    expect(within(rail).getByRole('link', { name: 'Stay' })).toHaveAttribute(
      'href',
      ROUTES.accommodation,
    );
  });

  it('sends a signed-out visitor from /app to sign in', () => {
    renderAt(ROUTES.home);
    // The landing is only public at `/`; behind the guard it needs a session.
    expect(screen.queryByRole('heading', { name: 'PARADOX' })).toBeNull();
    expect(screen.getByRole('heading', { name: /Welcome to Paradox/ })).toBeInTheDocument();
  });

  it('offers staff Support once, where Issues and Queries used to be two', () => {
    useAuthStore.getState().setStaffSession(VOLUNTEER);
    renderAt(ROUTES.staffSupport);

    const rail = screen.getAllByRole('navigation', { name: 'Staff sections' })[0];
    expect(within(rail).getByRole('link', { name: 'Support' })).toHaveAttribute(
      'href',
      ROUTES.staffSupport,
    );
    // The two the section replaced are gone from the rail, not merely renamed.
    for (const label of ['Issues', 'Queries']) {
      expect(within(rail).queryByRole('link', { name: label })).toBeNull();
    }
  });

  it('offers Help & Support once, where three entries used to be', () => {
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    renderAt(ROUTES.support);

    const rail = screen.getAllByRole('navigation', { name: 'Participant sections' })[0];
    expect(within(rail).getByRole('link', { name: 'Help & Support' })).toHaveAttribute(
      'href',
      ROUTES.support,
    );
    // The three the section replaced are gone from the rail, not merely renamed.
    for (const label of ['Help', 'Report', 'Queries']) {
      expect(within(rail).queryByRole('link', { name: label })).toBeNull();
    }
  });
});

/**
 * The three routes Help & Support was consolidated out of.
 *
 * They are on students' bookmarks and were linked from `AccommodationPage`, so
 * they still resolve — to the tab that now carries each of them. A 404 on "Report
 * a problem" is exactly the impression this restructure set out to remove.
 */
describe('support route redirects', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
  });
  afterEach(() => useAuthStore.getState().clear());

  const cases = [
    [ROUTES.queries, 'ask', 'Ask a question'],
    [ROUTES.reportIssue, 'report', 'Report a problem'],
    [ROUTES.helpDirectory, 'contacts', 'Who to call'],
  ] as const;

  for (const [from, tab, label] of cases) {
    it(`sends ${from} to the ${tab} tab`, () => {
      const router = createMemoryRouter(routes, { initialEntries: [from] });
      render(<RouterProvider router={router} />);

      expect(router.state.location.pathname).toBe(ROUTES.support);
      expect(router.state.location.search).toBe(`?tab=${tab}`);

      const tabs = screen.getByRole('tablist', { name: 'Help and support sections' });
      expect(within(tabs).getByRole('tab', { name: new RegExp(label) })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
  }

  it('replaces rather than stacks, so Back does not bounce through the redirect', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [ROUTES.dashboard, ROUTES.reportIssue],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe(ROUTES.support);
    // The old path was consumed, not added: one step back is the dashboard.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('still puts a signed-out visitor through the guard on an old bookmark', () => {
    useAuthStore.getState().clear();
    const router = createMemoryRouter(routes, { initialEntries: [ROUTES.reportIssue] });
    render(<RouterProvider router={router} />);

    // The redirect lives inside the participant guard, so this is a sign-in
    // prompt rather than a redirect to a route that then bounces.
    expect(screen.getByRole('heading', { name: /Welcome to Paradox/ })).toBeInTheDocument();
  });
});

/**
 * The two sections the staff Support desk was consolidated out of.
 *
 * `/staff/queries` and `/staff/issues` are linked from the overview board's alert
 * rail, from `SupportPanel`, and from the duty list, quite apart from whatever a
 * volunteer bookmarked mid-fest — so they resolve to the tab that now carries
 * each of them rather than 404ing.
 */
describe('staff support route redirects', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setStaffSession(VOLUNTEER);
  });
  afterEach(() => useAuthStore.getState().clear());

  const cases = [
    [ROUTES.queryConsole, 'questions'],
    [ROUTES.facilityIssues, 'faults'],
  ] as const;

  for (const [from, tab] of cases) {
    it(`sends ${from} to the ${tab} tab`, () => {
      const router = createMemoryRouter(routes, { initialEntries: [from] });
      render(<RouterProvider router={router} />);

      expect(router.state.location.pathname).toBe(ROUTES.staffSupport);
      expect(router.state.location.search).toBe(`?tab=${tab}`);
    });
  }

  it('replaces rather than stacks, so Back does not bounce through the redirect', () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [ROUTES.staffDuties, ROUTES.facilityIssues],
      initialIndex: 1,
    });
    render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe(ROUTES.staffSupport);
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('still puts a participant through the staff guard on an old bookmark', () => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setParticipantSession(PARTICIPANT);
    const router = createMemoryRouter(routes, { initialEntries: [ROUTES.queryConsole] });
    render(<RouterProvider router={router} />);

    // The redirect lives inside the staff guard, so a participant is turned away
    // rather than redirected to a route that then bounces them.
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
  });
});
