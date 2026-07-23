import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import { api, ApiClientError } from '@/api';
import { useAuthStore } from '@/stores/authStore';
import type { AuthResponse, Participant } from '@/api/types';
import type { Role } from '@/config/constants';

// Auth is now served only by the real backend. Stub the typed api so these
// tests assert the page's behaviour (error copy, post-login routing) without a
// running server.
vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api/ApiClient')>('@/api/ApiClient');
  return {
    ApiClientError: actual.ApiClientError,
    api: { login: vi.fn(), register: vi.fn(), getJourney: vi.fn() },
  };
});

function participant(overrides: Partial<Participant> & { role: Role }): Participant {
  return {
    id: `p_${overrides.role}`,
    email: 'user@ds.study.iitm.ac.in',
    fullName: 'Test User',
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
    ...overrides,
  };
}

function authResponse(p: Participant, isNewUser: boolean): AuthResponse {
  return { session: { token: 'tok', participant: p }, isNewUser };
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/complete-profile" element={<div>Complete Your Profile</div>} />
        <Route path="/onboarding" element={<div>Onboarding</div>} />
        <Route path="/app" element={<div>Home Screen</div>} />
        <Route path="/admin/users" element={<div>User Management</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const submitButton = (container: HTMLElement) =>
  container.querySelector('button[type="submit"]') as HTMLButtonElement;

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    vi.mocked(api.login).mockReset();
    vi.mocked(api.register).mockReset();
    vi.mocked(api.getJourney).mockReset();
  });

  it('shows an error for incorrect credentials', async () => {
    vi.mocked(api.login).mockRejectedValue(
      new ApiClientError(401, 'invalid_credentials', 'bad creds'),
    );
    const { container } = renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'nobody@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it('signs in a seeded admin and routes to User Management', async () => {
    const admin = participant({ role: 'admin', email: 'admin@es.study.iitm.ac.in' });
    vi.mocked(api.login).mockResolvedValue(authResponse(admin, false));
    const { container } = renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'admin@es.study.iitm.ac.in');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText('User Management')).toBeInTheDocument();
    expect(useAuthStore.getState().participant?.role).toBe('admin');
  });

  it('registers a new account and routes into onboarding', async () => {
    const fresh = participant({ role: 'participant', profileComplete: false });
    vi.mocked(api.register).mockResolvedValue(authResponse(fresh, true));
    // A brand-new participant has no journey yet; the page falls back to the
    // role/profile route (onboarding) when the lookup fails.
    vi.mocked(api.getJourney).mockRejectedValue(new Error('no journey'));
    const { container } = renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    await userEvent.type(screen.getByLabelText(/^email/i), 'fresh@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText('Onboarding')).toBeInTheDocument();
    expect(useAuthStore.getState().participant?.profileComplete).toBe(false);
  });
});
