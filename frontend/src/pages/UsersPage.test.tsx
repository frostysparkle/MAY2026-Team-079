import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './UsersPage';
import { api } from '@/api';
import { useAuthStore } from '@/stores/authStore';
import type { Participant, ListUsersResponse } from '@/api/types';
import type { Role } from '@/config/constants';

// The user list comes from the real backend; stub it so the test focuses on
// the Super-Admin-only role control (FR-7.3), not on data fetching.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/ApiClient')>('@/api/ApiClient');
  return { ApiClientError: actual.ApiClientError, api: { listUsers: vi.fn(), assignRole: vi.fn() } };
});

const usersResponse: ListUsersResponse = {
  users: [
    {
      id: 'u_1',
      fullName: 'Aarav Participant',
      email: 'aarav@ds.study.iitm.ac.in',
      role: 'participant',
      createdAt: '2026-07-10T00:00:00Z',
    },
    {
      id: 'u_2',
      fullName: 'Bela Organizer',
      email: 'bela@es.study.iitm.ac.in',
      role: 'organizer',
      createdAt: '2026-07-11T00:00:00Z',
    },
  ],
};

function actorWithRole(role: Role): Participant {
  return {
    id: `me_${role}`,
    email: `me@ds.study.iitm.ac.in`,
    fullName: 'Me',
    role,
    age: null,
    gender: null,
    phone: null,
    country: null,
    state: null,
    city: null,
    program: null,
    courseStage: null,
    courseStageOther: null,
    photoUrl: null,
    profileComplete: true,
    createdAt: '2026-07-10T00:00:00Z',
  };
}

function renderUsers() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    vi.mocked(api.listUsers).mockReset();
    vi.mocked(api.listUsers).mockResolvedValue(usersResponse);
  });

  it('shows per-row role selects for a Super Admin', async () => {
    useAuthStore.getState().setSession('t', actorWithRole('super_admin'));
    renderUsers();
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0));
  });

  it('hides the role control for a regular Admin', async () => {
    useAuthStore.getState().setSession('t', actorWithRole('admin'));
    renderUsers();
    // Wait for the list to load, then confirm there is no role-editing control.
    await waitFor(() => expect(screen.getByText('User Management')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryAllByRole('combobox')).toHaveLength(0));
  });
});
