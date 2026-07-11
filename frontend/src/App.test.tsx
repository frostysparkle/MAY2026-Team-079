import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the splash role-landing at "/"', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Paradox Connect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I'm a Student/i })).toBeInTheDocument();
  });
});
