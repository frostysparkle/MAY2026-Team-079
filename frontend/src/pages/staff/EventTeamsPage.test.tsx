import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import EventTeamsPage from './EventTeamsPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { ROUTES, path } from '@/config/routes';

async function renderTeams(eventId: string) {
  return render(
    <MemoryRouter initialEntries={[path(ROUTES.eventTeams, { eventId })]}>
      <Routes>
        <Route path={ROUTES.eventTeams} element={<EventTeamsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EventTeamsPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  it('shows "Not a team event" for a max-1 event without treating it as an error', async () => {
    const session = await mockApi.adminLogin({
      email: 'eventhead@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);

    // Last1Standing is a solo event (team max 1).
    await renderTeams('22');
    await userEvent.click(await screen.findByRole('button', { name: /Allocate teams/i }));
    expect(await screen.findByText('Not a team event')).toBeInTheDocument();
  });

  it('lists a registered participant for a team event', async () => {
    await mockApi.login({ email: 'participant@ds.study.iitm.ac.in', password: 'password123' });
    // Sprintsaga takes teams of up to 4.
    await mockApi.registerForEvent('74', {});

    const staff = await mockApi.adminLogin({
      email: 'eventhead@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(staff);

    await renderTeams('74');
    expect(await screen.findByText('Arjun Verma')).toBeInTheDocument();
  });
});
