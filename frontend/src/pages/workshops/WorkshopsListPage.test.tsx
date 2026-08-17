import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import WorkshopsListPage from './WorkshopsListPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { ROUTES } from '@/config/routes';

describe('WorkshopsListPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.login({
      email: 'participant@ds.study.iitm.ac.in',
      password: 'password123',
    });
    useAuthStore.getState().setParticipantSession(session);
  });

  it('lists all seeded workshops', async () => {
    render(
      <MemoryRouter initialEntries={[ROUTES.workshops]}>
        <Routes>
          <Route path={ROUTES.workshops} element={<WorkshopsListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The seeded programme is the migrated Paradox catalogue, so these are the
    // real workshop titles taken from the flyers.
    expect(await screen.findByText('Ethics of AI')).toBeInTheDocument();
    expect(screen.getByText('Measurement of AI')).toBeInTheDocument();
  });
});
