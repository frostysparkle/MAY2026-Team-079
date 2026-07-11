import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UsersPage from './UsersPage';
import { useAuthStore } from '@/stores/authStore';
import type { Participant } from '@/api/types';
import type { Role } from '@/config/constants';

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
  beforeEach(() => useAuthStore.getState().clear());

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
