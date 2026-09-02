import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhoneInput } from './PhoneInput';

function Harness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <PhoneInput
      label="Phone Number"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('PhoneInput', () => {
  it('defaults the country code to India', () => {
    render(<PhoneInput label="Phone Number" value="" onChange={() => undefined} />);
    expect(screen.getByRole('combobox', { name: /phone number country code/i })).toHaveValue('IN');
    expect(screen.queryByText('10 digits for India')).not.toBeInTheDocument();
  });

  it("caps the national field at the selected country's limit", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const national = screen.getByRole('textbox', { name: /phone number/i });
    expect(national).toHaveAttribute('maxLength', '10');

    await userEvent.click(national);
    await userEvent.paste('9876543210123');
    expect(national).toHaveValue('9876543210');
    expect(onChange).toHaveBeenLastCalledWith('+91 9876543210');
  });

  it('does not keep extra keystrokes in the box once the country limit is reached', async () => {
    render(<Harness />);
    const national = screen.getByRole('textbox', { name: /phone number/i });
    await userEvent.type(national, '9876543210999');
    expect(national).toHaveValue('9876543210');
  });

  it('switches the digit cap when the country code changes', async () => {
    const onChange = vi.fn();
    render(<PhoneInput label="Phone Number" value="+91 9876543210" onChange={onChange} />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /phone number country code/i }),
      'SG',
    );
    // Singapore is 8 digits; the extra Indian digits are dropped rather than
    // stored past the new country's limit.
    expect(onChange).toHaveBeenCalledWith('+65 98765432');
  });

  it('opens a stored Indian mobile on +91', () => {
    render(<PhoneInput label="Phone Number" value="9876543210" onChange={() => undefined} />);
    expect(screen.getByRole('combobox', { name: /phone number country code/i })).toHaveValue('IN');
    expect(screen.getByRole('textbox', { name: /phone number/i })).toHaveValue('9876543210');
  });
});
