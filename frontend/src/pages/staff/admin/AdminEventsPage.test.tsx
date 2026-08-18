import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminEventsPage from './AdminEventsPage';
import { path, ROUTES } from '@/config/routes';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { useAuthStore } from '@/stores/authStore';

/**
 * The Super Admin event dashboard: the public poster grid plus a management
 * layer. These cases cover what an admin can actually do from a card — the four
 * menu actions and opening the event — as well as which events are listed.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.adminEvents]}>
      <Routes>
        <Route path={ROUTES.adminEvents} element={<AdminEventsPage />} />
        <Route path={ROUTES.adminEventNew} element={<div>Editor: new</div>} />
        <Route path={ROUTES.adminEventEdit} element={<div>Editor page</div>} />
        <Route path={ROUTES.adminEventDetail} element={<div>Event page</div>} />
        <Route path={ROUTES.eventParticipation} element={<div>Participants page</div>} />
        <Route path={ROUTES.publicEvents} element={<div>Public catalogue</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the ⋮ menu on a named event's card. */
async function openMenu(eventName: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${eventName}` }));
  return screen.getByRole('menu', { name: `Actions for ${eventName}` });
}

describe('AdminEventsPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  it('lists the real festival events, grouped by category', async () => {
    renderPage();

    expect(await screen.findByText('Last1Standing')).toBeInTheDocument();
    expect(screen.getByText('Hustlepreneurs By Escape Room')).toBeInTheDocument();
    expect(screen.getByText('Paradox Got Talent 2.0')).toBeInTheDocument();

    // Category sections, in the public catalogue's order.
    expect(screen.getByRole('heading', { name: 'Sports' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Culturals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Technicals' })).toBeInTheDocument();

    expect(screen.getByText(/53 events · 53 open for registration/)).toBeInTheDocument();
  });

  it('no longer shows the retired demo events', async () => {
    renderPage();

    await screen.findByText('Last1Standing');
    expect(screen.queryByText('Code Sprint')).not.toBeInTheDocument();
    expect(screen.queryByText('Battle of Bands')).not.toBeInTheDocument();
  });

  it('shows each event as a poster card linking to its event page', async () => {
    renderPage();

    const card = await screen.findByRole('link', { name: 'Last1Standing' });
    expect(card).toHaveAttribute('href', path(ROUTES.adminEventDetail, { eventId: '22' }));
    expect(card.querySelector('img')).toHaveAttribute('src', '/images/events/posters/22.avif');
  });

  it('opens the event page when the card is clicked', async () => {
    renderPage();

    await userEvent.click(await screen.findByRole('link', { name: 'Last1Standing' }));
    expect(await screen.findByText('Event page')).toBeInTheDocument();
  });

  it('offers Edit, View participants, Close and Delete on every card', async () => {
    renderPage();

    const menu = await openMenu('Last1Standing');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent?.trim());
    expect(labels).toEqual(['Edit', 'View participants', 'Close', 'Delete']);
  });

  it('goes to the editor from the menu', async () => {
    renderPage();

    const menu = await openMenu('Last1Standing');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByText('Editor page')).toBeInTheDocument();
  });

  it('goes to the participants list from the menu', async () => {
    renderPage();

    const menu = await openMenu('Last1Standing');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'View participants' }));

    expect(await screen.findByText('Participants page')).toBeInTheDocument();
  });

  it('closes registration from the menu and marks the card', async () => {
    renderPage();

    const menu = await openMenu('Last1Standing');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Close' }));

    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(await screen.findByText(/53 events · 52 open for registration/)).toBeInTheDocument();

    // The action flips for a closed event.
    const reopened = await openMenu('Last1Standing');
    expect(within(reopened).getByRole('menuitem', { name: 'Reopen' })).toBeInTheDocument();
  });

  it('deletes an event only after confirmation', async () => {
    renderPage();

    const menu = await openMenu('Last1Standing');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Delete "Last1Standing"?');

    // Backing out leaves it alone.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Last1Standing')).toBeInTheDocument();

    const again = await openMenu('Last1Standing');
    await userEvent.click(within(again).getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete event' }),
    );

    expect(await screen.findByText(/52 events/)).toBeInTheDocument();
    expect(screen.queryByText('Last1Standing')).not.toBeInTheDocument();
  });

  it('offers the New event button that created them', async () => {
    renderPage();

    await screen.findByText('Last1Standing');
    await userEvent.click(screen.getByRole('button', { name: /New event/i }));
    expect(await screen.findByText('Editor: new')).toBeInTheDocument();
  });
});
