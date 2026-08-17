import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PublicEventsPage from './PublicEventsPage';
import { ROUTES } from '@/config/routes';
import { __resetMockApiForTests } from '@/api/mock/mockApi';
import { __resetPublicEventsCache } from '@/features/events/usePublicEvents';
import { useAuthStore } from '@/stores/authStore';

/**
 * The pre-login events catalogue. Nothing here is compiled into the app any
 * more: a signed-out visitor gets the whole programme from `GET /events/public`,
 * so these cases check that the published events actually reach the page.
 */
function renderEvents(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path={ROUTES.publicEvents} element={<PublicEventsPage />} />
        <Route path={ROUTES.publicEventCategory} element={<PublicEventsPage />} />
        <Route path={ROUTES.publicEventDetail} element={<div>Event page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicEventsPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    __resetPublicEventsCache();
  });

  it('counts the published events in each category, without a token', async () => {
    renderEvents(ROUTES.publicEvents);

    // Counts are computed from the API response, not asserted in the source.
    // The card art has no text of its own, so the category and its count reach
    // assistive tech through the button's accessible name.
    expect(await screen.findByRole('button', { name: 'Sports — 17 events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Culturals — 16 events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Technicals — 20 events' })).toBeInTheDocument();
  });

  it('lists a category’s events as a poster grid', async () => {
    renderEvents('/events/sports');

    expect(await screen.findByText('Last1Standing')).toBeInTheDocument();
    expect(screen.getByText('Sprintsaga')).toBeInTheDocument();
    expect(screen.getByText('Paradox Premier League 3.0')).toBeInTheDocument();

    // Each card links to its own detail page, keyed by the published event id.
    expect(screen.getByRole('link', { name: 'Last1Standing' })).toHaveAttribute(
      'href',
      '/events/sports/22',
    );
  });

  it('uses the event’s own poster artwork', async () => {
    renderEvents('/events/technicals');

    const card = await screen.findByRole('link', { name: 'Logi Innoverse 2026' });
    expect(card.querySelector('img')).toHaveAttribute('src', '/images/events/posters/102.avif');
  });

  it('does not show a count before the programme has loaded', () => {
    renderEvents(ROUTES.publicEvents);
    // Rendered synchronously, before the request resolves: the category is
    // there, but no misleading "0 events".
    expect(screen.getByRole('button', { name: 'Sports' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\d+ events/ })).not.toBeInTheDocument();
  });
});
