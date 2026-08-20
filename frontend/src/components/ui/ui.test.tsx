import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { TextInput } from './TextInput';
import { ResultBanner } from './ResultBanner';

describe('Button', () => {
  it('calls onClick when enabled', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled and non-interactive while loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('TextInput', () => {
  it('associates the label and shows an accessible error', () => {
    render(<TextInput label="Full Name" required error="Name is required" />);
    const input = screen.getByLabelText(/Full Name/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required');
  });
});

describe('ResultBanner', () => {
  it('uses role=alert for errors and role=status for success', () => {
    const { rerender } = render(<ResultBanner variant="error" title="Invalid" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
    rerender(<ResultBanner variant="success" title="Valid" />);
    expect(screen.getByRole('status')).toHaveTextContent('Valid');
  });
});
