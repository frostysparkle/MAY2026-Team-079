import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EntityLogsPage from './EntityLogsPage';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/**
 * One entity's complete log.
 *
 * The point of this page is that it merges the three places the system records
 * activity — the audit trail, `event_logs`, and `workshop_logs` — so most of these
 * cases exist to prove a record from each source actually reaches the screen, and
 * that entry and exit stay distinguishable.
 */
describe('EntityLogsPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  function renderAt(pathname: string) {
    return render(
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path={ROUTES.adminEntityLogs} element={<EntityLogsPage />} />
          <Route path={ROUTES.adminAuditLogs} element={<div>Audit trail</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const statCard = (label: string) => screen.getByRole('group', { name: label });

  /* ------------------------------------------------------------- hostels --- */

  it('tells a hostel block’s entries apart from its exits', async () => {
    renderAt('/staff/admin/audit-logs/hostels/HS01');

    // Named from the catalogue, not from the id alone.
    expect(await screen.findByText(/Alakananda/)).toBeInTheDocument();

    // The action name is the only thing that distinguishes the two in the data,
    // so each gets its own label and its own headline figure.
    expect(screen.getByText('Entered the block')).toBeInTheDocument();
    expect(screen.getByText('Left the block')).toBeInTheDocument();
    expect(statCard('Entries')).toHaveTextContent('1');
    expect(statCard('Exits')).toHaveTextContent('1');
  });

  it('names who scanned and who was scanned', async () => {
    renderAt('/staff/admin/audit-logs/hostels/HS01');
    await screen.findByText('Entered the block');

    const trail = await mockApi.auditLogs(500, { target_id: 'HS01', action: 'HOSTEL_ENTRY' });
    const entry = trail[0];

    // For a scan these are two different people, which is the whole point of the
    // record — the actor is the volunteer, the participant is who went in.
    const row = screen.getByText('Entered the block').closest('li') as HTMLElement;
    expect(within(row).getByText(entry.actor_id)).toBeInTheDocument();
    expect(within(row).getByText(String(entry.details?.participant_id))).toBeInTheDocument();
  });

  it('shows a block with only an entry and no exit', async () => {
    renderAt('/staff/admin/audit-logs/hostels/HS17');

    expect(await screen.findByText('Entered the block')).toBeInTheDocument();
    // No exit recorded, so no Exits figure at all rather than a misleading zero.
    expect(screen.queryByRole('group', { name: 'Exits' })).not.toBeInTheDocument();
  });

  /* ---------------------------------------------------------------- mess --- */

  it('shows a mess hall’s meal scans with the meal and the day', async () => {
    renderAt('/staff/admin/audit-logs/mess/MS01');

    expect(await screen.findByText(/Himalaya/)).toBeInTheDocument();

    // Meal and day are recorded nowhere else in the system.
    expect(screen.getAllByText('Meal served').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Breakfast').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lunch').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Day 1').length).toBeGreaterThan(0);

    const scans = await mockApi.auditLogs(500, { target_id: 'MS01', action: 'MESS_SCAN' });
    expect(statCard('Meals Served')).toHaveTextContent(String(scans.length));
  });

  it('includes the hall’s own lifecycle, not just its scans', async () => {
    renderAt('/staff/admin/audit-logs/mess/MS01');
    await screen.findByText(/Himalaya/);

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Team member assigned')).toBeInTheDocument();
  });

  /* -------------------------------------------------------------- events --- */

  it('merges an event’s attendance scans with its audit trail', async () => {
    renderAt('/staff/admin/audit-logs/events/22');

    // From the audit trail…
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();

    // …and from event_logs, which the audit trail never sees. Without the new
    // GET /events/{id}/logs endpoint these rows were unreachable.
    const scans = await mockApi.eventLogs('22');
    expect(scans.logs.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Attendance scanned')).toHaveLength(scans.logs.length);
    expect(statCard('Attendance')).toHaveTextContent(String(scans.logs.length));
  });

  /* ----------------------------------------------------------- workshops --- */

  it('shows a workshop’s bookings and how each attendee got in', async () => {
    renderAt('/staff/admin/audit-logs/workshops/workshop-02');

    expect(await screen.findByText('Booked a place')).toBeInTheDocument();
    expect(screen.getAllByText('Marked present').length).toBeGreaterThan(0);

    // scan_type is what separates a booked seat from a walk-up.
    expect(screen.getByText('Pre-registered')).toBeInTheDocument();
    expect(screen.getByText('On-spot')).toBeInTheDocument();
  });

  /* ------------------------------------------------------- find and page --- */

  it('narrows a log to one kind of record', async () => {
    renderAt('/staff/admin/audit-logs/hostels/HS01');
    await screen.findByText('Entered the block');

    await userEvent.selectOptions(screen.getByLabelText('Filter by kind'), 'exit');

    expect(await screen.findByText('Left the block')).toBeInTheDocument();
    expect(screen.queryByText('Entered the block')).not.toBeInTheDocument();
  });

  it('searches by participant', async () => {
    renderAt('/staff/admin/audit-logs/mess/MS01');
    await screen.findByText(/Himalaya/);

    await userEvent.type(screen.getByLabelText('Search these logs'), 'ES23F1000003');

    // Only that participant's meal remains.
    expect(await screen.findByText('Showing 1 to 1 of 1 records')).toBeInTheDocument();
  });

  it('reports how many records the entity has', async () => {
    renderAt('/staff/admin/audit-logs/mess/MS01');
    await screen.findByText(/Himalaya/);

    const trail = await mockApi.auditLogs(500, { target_id: 'MS01' });

    // The hall's own subtitle, and the footer, agree on the count.
    expect(screen.getByText(`Himalaya · ${trail.length} records`)).toBeInTheDocument();
    expect(
      screen.getByText(`Showing 1 to ${trail.length} of ${trail.length} records`),
    ).toBeInTheDocument();
  });

  it('says so when an entity has nothing recorded', async () => {
    // A real block from the catalogue that no seeded activity touches.
    renderAt('/staff/admin/audit-logs/hostels/HS05');

    expect(await screen.findByText('Nothing recorded yet')).toBeInTheDocument();
  });

  it('offers a CSV export of what is on screen', async () => {
    renderAt('/staff/admin/audit-logs/mess/MS01');
    await screen.findByText(/Himalaya/);

    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeEnabled();
  });

  /* ------------------------------------------------------------ bad input --- */

  it('sends an unknown section back to the trail', async () => {
    renderAt('/staff/admin/audit-logs/nonsense/MS01');

    // A domain that maps to no endpoint cannot be rendered, so it redirects
    // rather than showing a broken page.
    expect(await screen.findByText('Audit trail')).toBeInTheDocument();
  });

  it('denies a non-super-admin', async () => {
    const session = await mockApi.adminLogin({
      email: 'eventhead@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);

    renderAt('/staff/admin/audit-logs/mess/MS01');

    expect(await screen.findByText(/Only Super Admins can view audit logs/i)).toBeInTheDocument();
  });
});
