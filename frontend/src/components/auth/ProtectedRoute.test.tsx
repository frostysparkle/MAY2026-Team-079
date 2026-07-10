import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '@/stores/authStore';
import type { Participant } from '@/api/types';
import type { Role } from '@/config/constants';

function participantWithRole(role: Role): Participant {
  return {
    id: 'p',
    email: 'x@ds.study.iitm.ac.in',
    fullName: 'X',
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

function renderGuarded(minRole?: Role) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute minRole={minRole}>
              <div>Secret Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login</div>} />
        <Route path="/access-denied" element={<div>Access Denied</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('redirects unauthenticated users to login', () => {
    renderGuarded();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('shows Access Denied when the role is too low', () => {
    useAuthStore.getState().setSession('t', participantWithRole('participant'));
    renderGuarded('admin');
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('renders content when the role is sufficient', () => {
    useAuthStore.getState().setSession('t', participantWithRole('admin'));
    renderGuarded('admin');
    expect(screen.getByText('Secret Content')).toBeInTheDocument();
  });
});
