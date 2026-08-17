import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PublicEventDetailPage from './PublicEventDetailPage';
import { ROUTES } from '@/config/routes';
import { __resetMockApiForTests } from '@/api/mock/mockApi';
import { __resetPublicEventsCache } from '@/features/events/usePublicEvents';
import { useAuthStore } from '@/stores/authStore';

/**
 * The public detail page reads the published programme from `GET /events/public`
 * with no token, so these assertions double as a check that a signed-out visitor
 * sees the full event content: the prizes, timeline, meta tiles and FAQ.
 */
function renderDetail(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path={ROUTES.publicEventDetail} element={<PublicEventDetailPage />} />
        <Route path={ROUTES.publicEventCategory} element={<div>Category page</div>} />
        <Route path={ROUTES.publicEvents} element={<div>All categories</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicEventDetailPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    __resetPublicEventsCache();
  });

  it('renders the event name, prizes, timeline and rulebook from the API', async () => {
    renderDetail('/events/technicals/122');

    expect(await screen.findByRole('heading', { name: /Hustlepreneurs/i })).toBeInTheDocument();

    // Prizes — the wording is preserved, not reformatted from the integer column.
    expect(screen.getByText('₹10000 each')).toBeInTheDocument();
    expect(screen.getByText('Top 5 Teams')).toBeInTheDocument();

    // Rounds & timeline, including the venue line
    expect(screen.getByRole('heading', { name: /The Pitch/ })).toBeInTheDocument();
    expect(screen.getAllByText(/ICSR Hall III/).length).toBeGreaterThan(0);

    // Meta grid
    expect(screen.getByText('Team Size')).toBeInTheDocument();
    expect(screen.getByText('2 – 4')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Rulebook/ })).toHaveAttribute(
      'href',
      expect.stringContaining('docs.google.com'),
    );
  });

  it('opens the first FAQ by default and toggles the rest', async () => {
    renderDetail('/events/technicals/122');

    expect(await screen.findByText(/Yes — teams of 2 to 4 participants./)).toBeInTheDocument();

    const second = screen.getByRole('button', { name: /Is a prototype required\?/ });
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(/you can present a startup idea through a pitch deck/i),
    ).toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in before registering', async () => {
    renderDetail('/events/technicals/122');
    expect(await screen.findByRole('link', { name: /Sign in to register/ })).toHaveAttribute(
      'href',
      ROUTES.login,
    );
  });

  it('redirects an unknown event id back to its category', async () => {
    renderDetail('/events/technicals/does-not-exist');
    // Only after the programme has loaded — not while the id is merely unresolved.
    expect(await screen.findByText('Category page')).toBeInTheDocument();
  });
});
