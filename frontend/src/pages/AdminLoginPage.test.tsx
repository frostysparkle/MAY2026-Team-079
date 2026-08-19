import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminLoginPage from './AdminLoginPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests } from '@/api/mock/mockApi';

function renderAdminLogin() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginPage />} />
        {/* The two landing screens `postLoginRoute` chooses between for staff. */}
        <Route path="/staff" element={<div>Staff Dashboard</div>} />
        <Route path="/staff/admin/overview" element={<div>Fest Control Board</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLoginPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  /**
   * Staff do not all land in the same place, and the split is deliberate.
   * `/staff` is a *personal* duty list, built from the entity teams that name
   * you — the right first screen for a volunteer or an event head. A Super Admin
   * is on none of those teams, so they land on the fest-wide control board
   * instead. Both directions are pinned here because getting either wrong drops
   * somebody on a page with nothing on it.
   */
  it('sends the seeded super admin to the fest control board', async () => {
    renderAdminLogin();
    await userEvent.click(screen.getByRole('button', { name: /Fill seeded Super Admin/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Fest Control Board')).toBeInTheDocument();
    expect(useAuthStore.getState().session?.token_type).toBe('staff');
  });

  it('sends other staff to their own duty dashboard', async () => {
    renderAdminLogin();
    await userEvent.type(screen.getByLabelText(/^Email/), 'eventhead@paradox.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Staff Dashboard')).toBeInTheDocument();
  });

  it('shows the backend error for invalid credentials', async () => {
    renderAdminLogin();
    await userEvent.type(screen.getByLabelText(/^Email/), 'nobody@paradox.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
  });
});
