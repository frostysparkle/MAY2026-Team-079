import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Event } from '@/api/types';
import { ApiClientError } from '@/api';

/**
 * The event editor is where a Super Admin creates the staff who run an event —
 * the "Create new staff" flow in the Event Team panel. That flow mints a staff
 * account (`POST /backend_teams`) and then assigns it (`POST /events/{id}/team`),
 * so these tests drive the real form and assert on the exact payload the panel
 * builds, because that payload is what the backend's closed department vocabulary
 * validates.
 *
 * Regression: the panel used to post `department: "events"`, which is not in the
 * backend's `BACKEND_TEAM_DEPARTMENTS` set, so every attempt to create an event
 * head or volunteer failed with a 422 ("Input should be 'technical', 'sports',
 * …") before the account was ever created.
 */

const createBackendTeam = vi.fn();
const assignEventTeam = vi.fn();
const listBackendTeams = vi.fn();
const listEvents = vi.fn();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      createBackendTeam: (...args: Parameters<typeof createBackendTeam>) =>
        createBackendTeam(...args),
      assignEventTeam: (...args: Parameters<typeof assignEventTeam>) => assignEventTeam(...args),
      listBackendTeams: (...args: Parameters<typeof listBackendTeams>) => listBackendTeams(...args),
      listEvents: (...args: Parameters<typeof listEvents>) => listEvents(...args),
    },
  };
});

const { default: AdminEventEditorPage } = await import('./AdminEventEditorPage');

function renderEditor(eventId?: string) {
  const path = eventId ? `/staff/admin/events/${eventId}/edit` : '/staff/admin/events/new';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/staff/admin/events/new" element={<AdminEventEditorPage />} />
        <Route path="/staff/admin/events/:eventId/edit" element={<AdminEventEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Drives the "Create new staff" form inside the Event Team panel. */
async function submitNewStaff() {
  // The panel opens on "Assign existing staff"; the new-account fields only
  // exist after switching to the "Create new staff" tab.
  fireEvent.click(await screen.findByRole('button', { name: 'Create new staff' }));
  fireEvent.change(await screen.findByLabelText('Email'), {
    target: { value: 'last1standing@paradox.in' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'Paradox@2026' },
  });
  fireEvent.click(screen.getByRole('button', { name: /create and assign/i }));
  await waitFor(() => expect(createBackendTeam).toHaveBeenCalled());
}

describe('Event Team panel — create new staff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBackendTeam.mockResolvedValue({ message: 'ok', paradox_id: 'ADSP1234' });
    assignEventTeam.mockResolvedValue({ message: 'assigned' });
    listBackendTeams.mockResolvedValue([]);
  });

  it('sends a department the backend accepts when creating an event head', async () => {
    const event: Partial<Event> = {
      event_id: '22',
      name: 'Last1Standing',
      event_type: 'sports',
      team: { min: 1, max: 1, house_vs_house_event: false, allow_single_registration: true },
    };
    listEvents.mockResolvedValue([event as Event]);
    renderEditor('22');

    await submitNewStaff();

    expect(createBackendTeam).toHaveBeenCalledWith(
      expect.objectContaining({ department: 'sports', role: 'volunteer' }),
    );
    expect(assignEventTeam).toHaveBeenCalledWith('22', {
      user_id: 'ADSP1234',
      role: 'volunteer',
    });
  });

  it('falls back to an accepted department when the event type has none', async () => {
    const event: Partial<Event> = {
      event_id: '23',
      name: 'Open Mic',
      event_type: 'others',
    };
    listEvents.mockResolvedValue([event as Event]);
    renderEditor('23');

    await submitNewStaff();

    expect(createBackendTeam).toHaveBeenCalledWith(
      expect.objectContaining({ department: 'technical' }),
    );
  });

  it('surfaces a validation failure from the backend instead of failing silently', async () => {
    const event: Partial<Event> = {
      event_id: '22',
      name: 'Last1Standing',
      event_type: 'sports',
    };
    listEvents.mockResolvedValue([event as Event]);
    createBackendTeam.mockRejectedValue(
      new ApiClientError(422, 'Validation failed', [
        { field: 'department', message: "Input should be 'technical', 'sports', …" },
      ]),
    );
    renderEditor('22');

    await submitNewStaff();

    expect(await screen.findByText(/Action failed/i)).toBeInTheDocument();
    expect(assignEventTeam).not.toHaveBeenCalled();
  });
});
