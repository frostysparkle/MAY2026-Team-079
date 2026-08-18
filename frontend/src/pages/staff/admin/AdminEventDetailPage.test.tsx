import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminEventDetailPage from './AdminEventDetailPage';
import { path, ROUTES } from '@/config/routes';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { useAuthStore } from '@/stores/authStore';

/**
 * The admin's read view of an event. It renders through the same
 * `EventDetailView` as the public site, so the assertions here double as a check
 * that an admin sees the published content, not a stripped-down version of it.
 */
function renderDetail(eventId: string) {
  return render(
    <MemoryRouter initialEntries={[path(ROUTES.adminEventDetail, { eventId })]}>
      <Routes>
        <Route path={ROUTES.adminEventDetail} element={<AdminEventDetailPage />} />
        <Route path={ROUTES.adminEvents} element={<div>Events dashboard</div>} />
        <Route path={ROUTES.adminEventEdit} element={<div>Editor page</div>} />
        <Route path={ROUTES.eventParticipation} element={<div>Participants page</div>} />
        <Route path={ROUTES.publicEventDetail} element={<div>Public event page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminEventDetailPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  it('renders the published event content, exactly as the public page does', async () => {
    renderDetail('122');

    expect(
      await screen.findByRole('heading', { name: /Hustlepreneurs By Escape Room/i }),
    ).toBeInTheDocument();

    // Prize wording, round venue and meta tiles all survive.
    expect(screen.getByText('₹10000 each')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /The Pitch/ })).toBeInTheDocument();
    expect(screen.getAllByText(/ICSR Hall III/).length).toBeGreaterThan(0);
    expect(screen.getByText('2 – 4')).toBeInTheDocument();
  });

  it('offers the admin actions alongside the content', async () => {
    renderDetail('122');
    await screen.findByRole('heading', { name: /Hustlepreneurs/i });

    await userEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    expect(await screen.findByText('Editor page')).toBeInTheDocument();
  });

  it('opens the participants list', async () => {
    renderDetail('122');
    await screen.findByRole('heading', { name: /Hustlepreneurs/i });

    await userEvent.click(screen.getByRole('button', { name: /View participants/ }));
    expect(await screen.findByText('Participants page')).toBeInTheDocument();
  });

  it('links through to the live public page', async () => {
    renderDetail('122');
    await screen.findByRole('heading', { name: /Hustlepreneurs/i });

    await userEvent.click(screen.getByRole('button', { name: /Public page/ }));
    expect(await screen.findByText('Public event page')).toBeInTheDocument();
  });

  it('returns to the dashboard after deleting the event', async () => {
    renderDetail('122');
    await screen.findByRole('heading', { name: /Hustlepreneurs/i });

    await userEvent.click(
      screen.getByRole('button', { name: 'Actions for Hustlepreneurs By Escape Room' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete event' }),
    );

    expect(await screen.findByText('Events dashboard')).toBeInTheDocument();
    expect((await mockApi.listEvents()).some((e) => e.event_id === '122')).toBe(false);
  });

  it('closes registration from the menu', async () => {
    renderDetail('122');
    await screen.findByRole('heading', { name: /Hustlepreneurs/i });
    expect(screen.getByText('Registration is open')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Actions for Hustlepreneurs By Escape Room' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(await screen.findByText('Registration is closed')).toBeInTheDocument();
    expect(screen.getByText('Closed for registration')).toBeInTheDocument();
  });

  it('still manages an event that has no public category', async () => {
    await mockApi.createEvent({
      event_id: 'internal-briefing',
      event_type: 'others',
      name: 'Volunteer Briefing',
      description: 'Internal only.',
      team: { min: 1, max: 1, house: false, allow_single_registration: true },
      registration: {},
    });

    renderDetail('internal-briefing');

    expect(await screen.findByRole('heading', { name: /Volunteer Briefing/i })).toBeInTheDocument();
    // Framed as unlisted, told why, and given no dead link to a public page.
    expect(screen.getByText(/Not in the public catalogue/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Public page/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Actions for Volunteer Briefing' }),
    ).toBeInTheDocument();
  });

  it('reports an event id that does not exist', async () => {
    renderDetail('nope');
    expect(await screen.findByText(/no longer exists/)).toBeInTheDocument();
  });
});
