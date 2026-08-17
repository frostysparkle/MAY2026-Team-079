import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EventsListPage from './EventsListPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { ROUTES } from '@/config/routes';
import type { ParticipantLoginResponse } from '@/api/types';

describe('EventsListPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session: ParticipantLoginResponse = await mockApi.login({
      email: 'participant@ds.study.iitm.ac.in',
      password: 'password123',
    });
    useAuthStore.getState().setParticipantSession(session);
  });

  it('lists events and marks a registered one', async () => {
    await mockApi.registerForEvent('22', {});

    render(
      <MemoryRouter initialEntries={[ROUTES.events]}>
        <Routes>
          <Route path={ROUTES.events} element={<EventsListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // The catalogue is whatever the Super Admin has published.
    expect(await screen.findByText('Last1Standing')).toBeInTheDocument();
    expect(screen.getByText('Sprintsaga')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
  });
});
