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
  beforeEach(() => useAuthStore.getState().clear());

  it('shows an error for incorrect credentials', async () => {
    const { container } = renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'nobody@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it('signs in a seeded admin and routes to User Management', async () => {
    const { container } = renderLogin();
    await userEvent.type(screen.getByLabelText(/^email/i), 'admin@es.study.iitm.ac.in');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText('User Management')).toBeInTheDocument();
    expect(useAuthStore.getState().participant?.role).toBe('admin');
  });

  it('registers a new account and routes into onboarding', async () => {
    const { container } = renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    await userEvent.type(screen.getByLabelText(/^email/i), 'fresh@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'password123');
    await userEvent.click(submitButton(container));
    expect(await screen.findByText('Onboarding')).toBeInTheDocument();
    expect(useAuthStore.getState().participant?.profileComplete).toBe(false);
  });
});
