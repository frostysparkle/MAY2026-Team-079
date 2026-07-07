import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the splash route at "/"', () => {
    render(<App />);
    expect(screen.getByText(/Splash \/ Role Landing/i)).toBeInTheDocument();
  });
});
