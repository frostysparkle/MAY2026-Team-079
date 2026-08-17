import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from './LandingPage';
import { __resetMockApiForTests } from '@/api/mock/mockApi';
import { __resetPublicEventsCache } from '@/features/events/usePublicEvents';
import { useAuthStore } from '@/stores/authStore';

/**
 * The landing page a visitor sees before signing in. Its event figures are read
 * from the published programme rather than counted in the source, so they cannot
 * drift from what the Super Admin has actually created.
 */
describe('LandingPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    __resetPublicEventsCache();
  });

  it('reports the published event total and per-category counts', async () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    // "Events" headline figure in the visitor intro.
    const total = await screen.findByText('53');
    expect(total).toBeInTheDocument();

    // Category cards in the catalogue below it. The art carries the label, so
    // the count reaches assistive tech through the link's accessible name.
    expect(screen.getByRole('link', { name: 'Sports — 17 events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Culturals — 16 events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Technicals — 20 events' })).toBeInTheDocument();
  });

  it('renders the catalogue before the counts arrive', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    // The category frame is local, so it paints immediately; only the figures
    // wait on the API.
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sports' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /\d+ events/ })).not.toBeInTheDocument();
  });
});
