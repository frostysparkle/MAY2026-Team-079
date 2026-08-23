import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Mess, MessMenuRequest, MessageResponse, StaffLoginResponse } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { readMenuOverride, saveMenuOverride } from '@/features/mess/messMenu';

/**
 * Story 4.1's write half. It is only delivered if an edit *leaves the device*,
 * so these assert the body that goes to `PUT /mess/{id}/menu` rather than what
 * lands in `localStorage` — and that a failed send is reported instead of being
 * quietly downgraded to a local write that would reach nobody.
 */

const listMess = vi.fn<() => Promise<Mess[]>>();
const updateMessMenu = vi.fn<(id: string, req: MessMenuRequest) => Promise<MessageResponse>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listMess: () => listMess(),
      updateMessMenu: (id: string, req: MessMenuRequest) => updateMessMenu(id, req),
    },
  };
});

const { default: MessMenuPage } = await import('./MessMenuPage');

const MESS_ID = 'MESS01';
const VOLUNTEER = 'BT1000000003';

function makeMess(overrides: Partial<Mess> = {}): Mess {
  return {
    mess_id: MESS_ID,
    name: 'Nilgiri Mess',
    capacity: 400,
    type: 'south_indian__veg',
    mess_team: [{ user_id: VOLUNTEER, role: 'volunteer', logging: true }],
    ...overrides,
  };
}

function signIn(id: string, role = 'volunteer') {
  const session: StaffLoginResponse = {
    id,
    email: `${id.toLowerCase()}@paradox.in`,
    access_token: 't',
    token_type: 'staff',
    role,
    department: 'mess',
    designation: 'Mess Volunteer',
  };
  useAuthStore.getState().setStaffSession(session);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[path(ROUTES.messMenu, { messId: MESS_ID })]}>
      <Routes>
        <Route path={ROUTES.messMenu} element={<MessMenuPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Focus the editor on a known day, so the assertions do not depend on the clock. */
async function pickDayOne(user: ReturnType<typeof userEvent.setup>) {
  const days = await screen.findByRole('tablist', { name: 'Fest day to edit' });
  await user.click(within(days).getByRole('tab', { name: /Day 1/ }));
}

describe('MessMenuPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    listMess.mockResolvedValue([makeMess()]);
    updateMessMenu.mockResolvedValue({ message: 'Menu updated' });
  });

  describe('who may open it', () => {
    it('opens for a volunteer on the hall’s team', async () => {
      signIn(VOLUNTEER);
      renderPage();
      expect(await screen.findByText('Nilgiri Mess')).toBeInTheDocument();
      expect(screen.getByText('Meal timings')).toBeInTheDocument();
      expect(screen.getByText('Dishes')).toBeInTheDocument();
    });

    it('turns away a staffer who is not on the team and is not a Super Admin', async () => {
      signIn('BT9999999999');
      renderPage();
      expect(await screen.findByText("Not on this hall's team")).toBeInTheDocument();
      expect(screen.queryByText('Meal timings')).not.toBeInTheDocument();
    });

    it('lets a Super Admin in for a hall they are not on the team of', async () => {
      signIn('BT9999999999', 'super_admin');
      renderPage();
      expect(await screen.findByText('Meal timings')).toBeInTheDocument();
    });
  });

  describe('publishing', () => {
    it('sends the whole menu — every day, every sitting, dishes and windows', async () => {
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      const dinner = screen.getByLabelText('Dinner');
      await user.clear(dinner);
      // Typed, not pasted: this also covers Enter starting a second dish, which
      // the parse/format round-trip used to swallow.
      await user.type(dinner, 'Biryani{Enter}Raita');
      await user.click(screen.getByRole('button', { name: /Publish menu/ }));

      await waitFor(() => expect(updateMessMenu).toHaveBeenCalled());
      const [messId, body] = updateMessMenu.mock.calls[0];
      expect(messId).toBe(MESS_ID);

      // The whole menu, not a diff: six days, three sittings each.
      expect(body.days).toHaveLength(6);
      expect(body.days.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6]);
      const dayOne = body.days[0];
      expect(dayOne.slots.map((s) => s.slot)).toEqual(['breakfast', 'lunch', 'dinner']);
      expect(dayOne.slots[2].dishes).toEqual(['Biryani', 'Raita']);
      expect(dayOne.slots[2].start_time).toBe('19:00');
      // Untouched sittings still travel, carrying the published dishes.
      expect(dayOne.slots[0].dishes.length).toBeGreaterThan(0);
    });

    it('carries an edited service window on every day', async () => {
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();

      const start = await screen.findByLabelText('Dinner starts');
      await user.clear(start);
      await user.paste('19:30');
      await user.click(screen.getByRole('button', { name: /Publish menu/ }));

      await waitFor(() => expect(updateMessMenu).toHaveBeenCalled());
      const [, body] = updateMessMenu.mock.calls[0];
      expect(body.days.every((d) => d.slots[2].start_time === '19:30')).toBe(true);
    });

    it('confirms the change reached everyone, not just this browser', async () => {
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      const dinner = screen.getByLabelText('Dinner');
      await user.clear(dinner);
      await user.paste('Biryani');
      await user.click(screen.getByRole('button', { name: /Publish menu/ }));

      expect(await screen.findByText('Published to everyone in this hall')).toBeInTheDocument();
    });

    it('reports a failed send and keeps the draft, rather than saving locally', async () => {
      const user = userEvent.setup();
      updateMessMenu.mockRejectedValue(new Error('network down'));
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      const dinner = screen.getByLabelText('Dinner');
      await user.clear(dinner);
      await user.paste('Biryani');
      await user.click(screen.getByRole('button', { name: /Publish menu/ }));

      expect(await screen.findByText('The menu was not saved')).toBeInTheDocument();
      // The draft survives, and nothing was written to the device.
      expect(screen.getByLabelText('Dinner')).toHaveValue('Biryani');
      expect(readMenuOverride(MESS_ID)).toBeNull();
    });

    it('will not send a window that ends before it starts', async () => {
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();

      const start = await screen.findByLabelText('Lunch starts');
      await user.clear(start);
      await user.paste('15:00');

      expect(screen.getByText('The end has to come after the start.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Publish menu/ })).toBeDisabled();
      expect(updateMessMenu).not.toHaveBeenCalled();
    });

    it('previews the draft before it is sent, and sends nothing until asked', async () => {
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      const dinner = screen.getByLabelText('Dinner');
      await user.clear(dinner);
      await user.paste('Biryani');

      const preview = screen.getByText('What participants see').closest('section')!;
      expect(within(preview).getByText('Biryani')).toBeInTheDocument();
      expect(screen.getByText('Unsaved draft')).toBeInTheDocument();
      expect(updateMessMenu).not.toHaveBeenCalled();
    });
  });

  describe('reading back what is stored', () => {
    it('starts from the hall’s published menu when it has one', async () => {
      listMess.mockResolvedValue([
        makeMess({
          menu: {
            days: [
              {
                day: 1,
                slots: [
                  { slot: 'dinner', start_time: '19:30', end_time: '21:30', dishes: ['Pongal'] },
                ],
              },
            ],
            note: 'Dinner runs late.',
            updated_by: 'bt1000000003@paradox.in',
          },
        }),
      ]);
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      expect(screen.getByLabelText('Dinner')).toHaveValue('Pongal');
      expect(screen.getByLabelText('Dinner starts')).toHaveValue('19:30');
      expect(screen.getByLabelText('One line for today')).toHaveValue('Dinner runs late.');
    });

    it('picks up a menu left on this device before the route existed', async () => {
      saveMenuOverride(MESS_ID, { days: { '1': { dinner: ['Leftover draft'] } } });
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      expect(screen.getByLabelText('Dinner')).toHaveValue('Leftover draft');
    });

    it('clears that device copy once the menu is published', async () => {
      saveMenuOverride(MESS_ID, { days: { '1': { dinner: ['Leftover draft'] } } });
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      await user.click(screen.getByRole('button', { name: /Publish menu/ }));
      await waitFor(() => expect(updateMessMenu).toHaveBeenCalled());
      expect(readMenuOverride(MESS_ID)).toBeNull();
    });

    it('prefers the hall’s published menu over a stale copy on this device', async () => {
      saveMenuOverride(MESS_ID, { days: { '1': { dinner: ['Stale device copy'] } } });
      listMess.mockResolvedValue([
        makeMess({
          menu: {
            days: [
              {
                day: 1,
                slots: [
                  { slot: 'dinner', start_time: '19:00', end_time: '21:00', dishes: ['The truth'] },
                ],
              },
            ],
          },
        }),
      ]);
      const user = userEvent.setup();
      signIn(VOLUNTEER);
      renderPage();
      await pickDayOne(user);

      expect(screen.getByLabelText('Dinner')).toHaveValue('The truth');
    });
  });

  it('withdraws every change by publishing an empty menu, not by clearing the device', async () => {
    const user = userEvent.setup();
    listMess.mockResolvedValue([
      makeMess({
        menu: {
          days: [
            {
              day: 1,
              slots: [
                { slot: 'dinner', start_time: '19:00', end_time: '21:00', dishes: ['Biryani'] },
              ],
            },
          ],
        },
      }),
    ]);
    signIn(VOLUNTEER);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Back to the published menu/ }));
    await user.click(screen.getByRole('button', { name: 'Reset menu' }));

    await waitFor(() => expect(updateMessMenu).toHaveBeenCalled());
    const [, body] = updateMessMenu.mock.calls[0];
    // Reset still publishes: it sends the published sheet back up, so the hall's
    // stored menu stops disagreeing with it for everyone, not just here.
    expect(body.days).toHaveLength(6);
    expect(body.note).toBeNull();
  });
});
