import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './LoginPage';
import RegisterPage from './RegisterPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests } from '@/api/mock/mockApi';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<div>Create Account</div>} />
        <Route path="/forgot-password" element={<div>Forgot Password</div>} />
        <Route path="/complete-profile" element={<div>Complete Your Profile</div>} />
        <Route path="/app" element={<div>Home Screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  it('shows the backend error message for an unknown account', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^Email/), 'someone@gmail.com');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrongpass');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
  });

  it('signs in the seeded participant and routes to the home screen', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /Fill seeded participant/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Home Screen')).toBeInTheDocument();
    expect(useAuthStore.getState().session?.token_type).toBe('participant');
  });

  it('opens on the Sign in tab and swaps the form when Register is chosen', async () => {
    renderLogin();
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Register' }));

    expect(screen.getByRole('tab', { name: 'Register' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    // Forgot-password is a sign-in-only affordance.
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).toBeNull();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('minlength', '8');
  });

  it('keeps the email but clears the password when switching tabs', async () => {
    renderLogin();
    await userEvent.type(screen.getByLabelText(/^Email/), 'someone@ds.study.iitm.ac.in');
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret123');

    await userEvent.click(screen.getByRole('tab', { name: 'Register' }));

    expect(screen.getByLabelText(/^Email/)).toHaveValue('someone@ds.study.iitm.ac.in');
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  });

  it('reveals and re-hides the password', async () => {
    renderLogin();
    const field = screen.getByLabelText(/^Password/);
    expect(field).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field).toHaveAttribute('type', 'password');
  });

  it('registers a new account, then returns to the Sign in tab', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('tab', { name: 'Register' }));
    await userEvent.type(screen.getByLabelText(/^Email/), 'brand.new@ds.study.iitm.ac.in');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account created')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('RegisterPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  it('renders the sign-in screen with the Register tab already active', () => {
    render(
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('tab', { name: 'Register' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
  });
});
