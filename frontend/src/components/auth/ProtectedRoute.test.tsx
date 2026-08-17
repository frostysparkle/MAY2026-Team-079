import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '@/stores/authStore';
import type { ParticipantLoginResponse, StaffLoginResponse } from '@/api/types';

const participant: ParticipantLoginResponse = {
  id: 'DS23F1000001',
  email: 'x@ds.study.iitm.ac.in',
  access_token: 't',
  token_type: 'participant',
  full_name: 'X',
  dob: null,
  house: null,
  gender: null,
  phone: null,
  country: null,
  state: null,
  city: null,
  address: null,
  program: null,
  course_stage: null,
  photo: null,
  public_key: null,
};

const staff: StaffLoginResponse = {
  id: 'BT1',
  email: 'x@example.com',
  access_token: 't',
  token_type: 'staff',
  role: 'volunteer',
  department: 'technical',
  designation: 'Volunteer',
};

function renderGuarded(
  requireTokenType?: 'participant' | 'staff',
  requireStaffRole?: string,
  requireCompleteProfile?: boolean,
) {
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route
          path="/protected"
          element={
            <ProtectedRoute
              requireTokenType={requireTokenType}
              requireStaffRole={requireStaffRole}
              requireCompleteProfile={requireCompleteProfile}
            >
              <div>Secret Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<div>Login</div>} />
        <Route path="/admin/login" element={<div>Admin Login</div>} />
        <Route path="/access-denied" element={<div>Access Denied</div>} />
        <Route path="/complete-profile" element={<div>Complete Profile</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('redirects unauthenticated users to participant login by default', () => {
    renderGuarded();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('redirects unauthenticated staff-only routes to admin login', () => {
    renderGuarded('staff');
    expect(screen.getByText('Admin Login')).toBeInTheDocument();
  });

  it('denies a participant session on a staff-only route', () => {
    useAuthStore.getState().setParticipantSession(participant);
    renderGuarded('staff');
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('denies a staff session lacking the required role', () => {
    useAuthStore.getState().setStaffSession(staff);
    renderGuarded('staff', 'super_admin');
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
  });

  it('renders content when the session satisfies the gate', () => {
    useAuthStore.getState().setStaffSession({ ...staff, role: 'super_admin' });
    renderGuarded('staff', 'super_admin');
    expect(screen.getByText('Secret Content')).toBeInTheDocument();
  });

  // The post-login redirect only fires at sign-in. The session is persisted, so
  // without a route-level gate a reload or a typed URL walks straight into the
  // app with an empty profile.
  it('sends a participant with an incomplete profile to Complete Profile', () => {
    useAuthStore.getState().setParticipantSession({ ...participant, full_name: null });
    renderGuarded('participant', undefined, true);
    expect(screen.getByText('Complete Profile')).toBeInTheDocument();
  });

  it('lets a participant with a completed profile through', () => {
    useAuthStore.getState().setParticipantSession(participant);
    renderGuarded('participant', undefined, true);
    expect(screen.getByText('Secret Content')).toBeInTheDocument();
  });

  it('does not gate staff on profile completion', () => {
    useAuthStore.getState().setStaffSession(staff);
    renderGuarded('staff', undefined, true);
    expect(screen.getByText('Secret Content')).toBeInTheDocument();
  });
});
