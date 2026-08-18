import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AdminEventEditorPage from './AdminEventEditorPage';
import { ROUTES, path } from '@/config/routes';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';
import { useAuthStore } from '@/stores/authStore';
import { publicEventView } from '@/features/events/eventView';

/**
 * Editing a migrated event must be lossless.
 *
 * The published catalogue leans on a display overlay for the things the columns
 * cannot hold (prize wording, round times as written, the meta tiles). If the
 * editor did not round-trip that overlay, opening an event and pressing Save
 * would quietly rewrite the public page — so that is what these cases check.
 */
async function renderEditor(eventId: string) {
  const view = render(
    <MemoryRouter initialEntries={[path(ROUTES.adminEventEdit, { eventId })]}>
      <Routes>
        <Route path={ROUTES.adminEventEdit} element={<AdminEventEditorPage />} />
        <Route path={ROUTES.adminEvents} element={<div>Back to events</div>} />
      </Routes>
    </MemoryRouter>,
  );
  // Wait for hydration from the API.
  await screen.findByDisplayValue('Hustlepreneurs By Escape Room');
  return view;
}

async function currentView(eventId: string) {
  const events = await mockApi.listEvents();
  const event = events.find((e) => e.event_id === eventId)!;
  return publicEventView(event);
}

describe('AdminEventEditorPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  it('loads a migrated event with its display wording intact', async () => {
    await renderEditor('122');

    // The prize as printed, beside its numeric amount.
    expect(screen.getByDisplayValue('₹10000 each')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Top 5 Teams')).toBeInTheDocument();

    // Round venues (two rounds share one) and the times as written — including
    // a date with no time, which no timestamp pair could express.
    expect(screen.getAllByDisplayValue('ICSR Hall III')).toHaveLength(2);
    expect(screen.getByDisplayValue('4 Jun')).toBeInTheDocument();
    expect(screen.getByDisplayValue('13 Jun, 12:30 pm')).toBeInTheDocument();

    // Meta tiles, editable as label/value rows.
    expect(screen.getByDisplayValue('Reg. Start')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2 – 4')).toBeInTheDocument();
  });

  it('saves without altering what the public page shows', async () => {
    const before = await currentView('122');

    await renderEditor('122');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Back to events')).toBeInTheDocument();

    const after = await currentView('122');
    expect(after).toEqual(before);
  });

  it('carries an edit through to the public page', async () => {
    await renderEditor('122');

    const shownAs = screen.getByDisplayValue('₹10000 each');
    await userEvent.clear(shownAs);
    await userEvent.type(shownAs, '₹12000 each');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Back to events');

    const after = await currentView('122');
    expect(after!.prizes).toEqual([{ label: 'Top 5 Teams', amount: '₹12000 each' }]);
  });
});
