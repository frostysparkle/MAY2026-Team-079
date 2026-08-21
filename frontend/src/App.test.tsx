import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the public landing page at "/"', () => {
    render(<App />);
    // The landing is the hero and nothing else: the festival wordmark, the
    // perimeter nav that opens each section, and the way in.
    expect(screen.getByRole('heading', { name: 'PARADOX' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workshops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();

    // The catalogue and the intro used to sit below the fold. This screen no
    // longer scrolls, so they are not here — they are on the pages the nav
    // opens.
    expect(screen.queryByRole('heading', { name: 'Events' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
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
