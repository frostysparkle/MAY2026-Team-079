import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from './ActionMenu';

function setup(overrides: Partial<Parameters<typeof ActionMenu>[0]> = {}) {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(
    <ActionMenu
      label="Actions for Last1Standing"
      items={[
        { label: 'Edit', onSelect: onEdit },
        { label: 'Close', onSelect: vi.fn() },
        { label: 'Delete', tone: 'danger', onSelect: onDelete },
      ]}
      {...overrides}
    />,
  );
  return {
    onEdit,
    onDelete,
    trigger: screen.getByRole('button', { name: 'Actions for Last1Standing' }),
  };
}

describe('ActionMenu', () => {
  it('is collapsed until opened', () => {
    const { trigger } = setup();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens on click and runs the chosen action', async () => {
    const { trigger, onEdit } = setup();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledOnce();
    // Choosing an action closes the menu.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens from the keyboard with focus on the first item', async () => {
    const { trigger } = setup();

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('rovers focus through the items and wraps around', async () => {
    const { trigger } = setup();

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Close' })).toHaveFocus();

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();

    // Past the last item, back to the first.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('skips a disabled item while navigating', async () => {
    const { trigger } = setup({
      items: [
        { label: 'Edit', onSelect: vi.fn() },
        { label: 'Close', onSelect: vi.fn(), disabled: true },
        { label: 'Delete', onSelect: vi.fn() },
      ],
    });

    trigger.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const { trigger } = setup();

    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when clicking outside', async () => {
    const { trigger } = setup();

    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not activate the card it sits on', async () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <ActionMenu label="Actions" items={[{ label: 'Edit', onSelect: vi.fn() }]} />
      </div>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
