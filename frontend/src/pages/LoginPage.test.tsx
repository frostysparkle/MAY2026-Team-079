import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuthStore } from '@/stores/authStore';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/complete-profile" element={<div>Complete Your Profile</div>} />
        <Route path="/app" element={<div>Home Screen</div>} />
        <Route path="/admin/users" element={<div>User Management</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('shows a specific error for a non-IITM email', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/any IITM email/i), 'someone@gmail.com');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/not a valid IITM email/i)).toBeInTheDocument();
  });

  it('signs in a seeded admin and routes to User Management', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'admin@es.study.iitm.ac.in' }));
    expect(await screen.findByText('User Management')).toBeInTheDocument();
    expect(useAuthStore.getState().participant?.role).toBe('admin');
  });
});
