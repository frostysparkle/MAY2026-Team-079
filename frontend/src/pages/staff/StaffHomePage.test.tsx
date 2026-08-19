import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaffHomePage from './StaffHomePage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/** The staff dashboard, on the same festival layout as every section it links to. */
describe('StaffHomePage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  async function signIn(email: string) {
    const session = await mockApi.adminLogin({ email, password: 'password123' });
    useAuthStore.getState().setStaffSession(session);
  }

  function renderPage() {
    return render(
      <MemoryRouter>
        <StaffHomePage />
      </MemoryRouter>,
    );
  }

  it('greets the signed-in staff member under the themed title', async () => {
    await signIn('superadmin@paradox.dev');
    renderPage();

    expect(screen.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeInTheDocument();
    // The eyebrow carries the designation, the subtitle the account.
    expect(screen.getByText('Fest Director')).toBeInTheDocument();
    expect(screen.getByText('superadmin@paradox.dev')).toBeInTheDocument();
  });

  // Section navigation belongs to `StaffShell`, which renders it on every screen.
  // A panel of the same links here would be a second copy, free to drift.
  it('leaves admin section navigation to the shell', async () => {
    await signIn('superadmin@paradox.dev');
    renderPage();

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByText('Manage Events')).not.toBeInTheDocument();
  });

  // `workshop_team` is readable by a super admin, so the assignment is derived and
  // the manual "type the Workshop ID" fallback has nothing to do.
  it('hides the manual workshop entry when the assignment can be derived', async () => {
    await signIn('superadmin@paradox.dev');
    renderPage();

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Scan a Workshop' })).not.toBeInTheDocument(),
    );
  });

  // For anyone else the field is stripped from `GET /workshops`, so they cannot
  // self-discover the assignment and typing the id is the only way to the scanner.
  it('offers the manual workshop entry when the assignment is not readable', async () => {
    await signIn('eventhead@paradox.dev');
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Scan a Workshop' })).toBeInTheDocument();
  });
});
