import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the public landing page at "/"', () => {
    render(<App />);
    // The festival wordmark, and the catalogue that a signed-out visitor can
    // browse without an account.
    expect(screen.getByRole('heading', { name: 'PARADOX' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workshops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('offers staff sign-in behind the menu button', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('link', { name: 'Staff / Volunteer Login' })).toHaveAttribute(
      'href',
      '/admin/login',
    );
  });
});
