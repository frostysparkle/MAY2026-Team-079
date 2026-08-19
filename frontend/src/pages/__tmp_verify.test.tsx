import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listEvents: () => Promise.resolve([]),
      myEventRegistrations: () => Promise.resolve([]),
      listWorkshops: () => Promise.resolve([]),
      myHostel: () =>
        Promise.resolve({
          assigned_hostel: null,
          room: null,
          logged_in: false,
          registered: false,
          volunteers: [],
        }),
      myMess: () => Promise.resolve({ allotted_mess: null, mess_details: null, slots: [] }),
      listHostels: () => Promise.resolve([]),
      listMess: () => Promise.resolve([]),
      listPublicEvents: () => Promise.resolve([]),
      listPublicWorkshops: () => Promise.resolve([]),
    },
  };
});

const { default: StudentHomePage } = await import('./StudentHomePage');
const { AppShell } = await import('@/components/layout/AppShell');
const { postLoginRoute } = await import('@/features/auth/postLoginRoute');

const SESSION = {
  access_token: 't',
  token_type: 'participant' as const,
  id: 'DS23F1000042',
  email: 'stu@example.com',
  full_name: 'Asha Rao',
  house: 'Wayanad',
};

describe('student home hub', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: SESSION as never });
  });

  it('post-login lands a participant on the home hub, not the dashboard', () => {
    expect(postLoginRoute(SESSION as never)).toBe(ROUTES.home);
    expect(ROUTES.home).not.toBe(ROUTES.dashboard);
  });

  it('renders a hub card per section, each linking to its existing route', () => {
    const { container } = render(
      <MemoryRouter initialEntries={[ROUTES.home]}>
        <Routes>
          <Route path={ROUTES.home} element={<StudentHomePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Paradox' })).toBeInTheDocument();

    // The hub is the one `ul` whose items are section cards.
    const hub = container.querySelector('ul.grid.gap-3');
    expect(hub).not.toBeNull();
    const cards = Array.from(hub!.querySelectorAll('a')).map((a) => ({
      label: a.querySelector('p')?.textContent,
      href: a.getAttribute('href'),
    }));

    expect(cards).toEqual([
      { label: 'Dashboard', href: ROUTES.dashboard },
      { label: 'Events', href: ROUTES.events },
      { label: 'My Registrations', href: ROUTES.myRegistrations },
      { label: 'Schedule', href: ROUTES.schedule },
      { label: 'Workshops', href: ROUTES.workshops },
      { label: 'Accommodation & Mess', href: ROUTES.accommodation },
      { label: 'My QR', href: ROUTES.myQr },
      { label: 'Profile', href: ROUTES.profile },
    ]);

    // The public landing page's catalogue, rendered from the shared component.
    expect(screen.getByRole('heading', { name: 'Events', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workshops', level: 2 })).toBeInTheDocument();
    // Signed in, so the "create an account" note is gone.
    expect(screen.queryByText(/create an account/)).not.toBeInTheDocument();
  });

  it('gives the shell a Home entry and renames Stay to Accommodation & Mess', () => {
    render(
      <MemoryRouter initialEntries={[ROUTES.home]}>
        <Routes>
          <Route path={ROUTES.home} element={<AppShell />}>
            <Route index element={<p>hub</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const rail = screen.getAllByRole('navigation', { name: 'Participant sections' })[0];
    const labels = within(rail)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual([
      'Home',
      'Dashboard',
      'Events',
      'Workshops',
      'Schedule',
      'Accommodation & Mess',
      'My QR',
      'Profile',
    ]);
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveAttribute('href', ROUTES.home);
    expect(labels).not.toContain('Stay');
  });
});
