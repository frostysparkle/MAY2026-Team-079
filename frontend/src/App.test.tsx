import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the public landing page at "/"', () => {
    render(<App />);
    // Hero headline (the page's h1) and the primary Register CTA.
    expect(screen.getByRole('heading', { level: 1, name: /paradox/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /register/i }).length).toBeGreaterThan(0);
  });
});
