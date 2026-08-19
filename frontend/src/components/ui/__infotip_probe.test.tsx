import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoTip } from './InfoTip';
import { DetailPanel } from './DetailPanel';
import { TextInput } from './TextInput';

describe('InfoTip probe', () => {
  it('is hidden until the icon is used, then shows the explanation', async () => {
    render(<InfoTip label="About demo data">Nothing is charged.</InfoTip>);

    expect(screen.queryByText('Nothing is charged.')).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'About demo data' });
    await userEvent.click(trigger);

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Nothing is charged.');
    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens on hover and closes again on unhover', async () => {
    render(<InfoTip label="About x">Detail.</InfoTip>);
    const trigger = screen.getByRole('button', { name: 'About x' });

    await userEvent.hover(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await userEvent.unhover(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('a click pins it, so it survives the pointer leaving', async () => {
    render(<InfoTip label="About x">Detail.</InfoTip>);
    const trigger = screen.getByRole('button', { name: 'About x' });

    await userEvent.click(trigger);
    await userEvent.unhover(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('is reachable on touch, which has no hover', async () => {
    render(<InfoTip label="About x">Detail.</InfoTip>);
    const trigger = screen.getByRole('button', { name: 'About x' });

    await userEvent.pointer([
      { target: trigger, keys: '[TouchA>]', pointerName: 'TouchA' },
      { target: trigger, keys: '[/TouchA]', pointerName: 'TouchA' },
    ]);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('opens on keyboard focus alone', async () => {
    render(<InfoTip label="About x">Detail.</InfoTip>);
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'About x' })).toHaveFocus();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(<InfoTip label="About x">Detail.</InfoTip>);
    await userEvent.click(screen.getByRole('button', { name: 'About x' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hangs a DetailPanel info off its heading without printing it', async () => {
    render(
      <DetailPanel title="Receipt" info="Simulated only.">
        <p>body</p>
      </DetailPanel>,
    );

    expect(screen.queryByText('Simulated only.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About Receipt' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Simulated only.');
  });

  it('keeps a TextInput hint visible while hiding its info', async () => {
    render(<TextInput label="Workshop ID" hint="Permanent." info="Used in the public URL." />);

    // The rule stays on the page.
    expect(screen.getByText('Permanent.')).toBeInTheDocument();
    // The explanation does not.
    expect(screen.queryByText('Used in the public URL.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'About Workshop ID' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Used in the public URL.');
    // The real <label> still points at the input after being wrapped in a row.
    expect(screen.getByRole('textbox', { name: /Workshop ID/ })).toBeInstanceOf(HTMLInputElement);
  });
});
