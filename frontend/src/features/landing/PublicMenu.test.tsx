import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PublicMenu } from './PublicMenu';
import { ROUTES } from '@/config/routes';

function renderMenu() {
  return render(
    <MemoryRouter>
      <PublicMenu />
    </MemoryRouter>,
  );
}

describe('PublicMenu', () => {
  it('starts closed', () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Staff / Volunteer Login' })).toBeNull();
  });

  it('opens to reveal the staff sign-in entry', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Staff / Volunteer Login' })).toHaveAttribute(
      'href',
      ROUTES.adminLogin,
    );
  });

  it('does not repeat the public page links the page chrome already shows', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    for (const label of ['Home', 'Events', 'Schedule', 'Workshops', 'Sponsors']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    renderMenu();
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('link', { name: 'Staff / Volunteer Login' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
  });

  it('closes on an outside click', async () => {
    render(
      <MemoryRouter>
        <PublicMenu />
        <button type="button">Elsewhere</button>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('link', { name: 'Staff / Volunteer Login' })).toBeNull();
  });
});
