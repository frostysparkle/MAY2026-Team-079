import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuditLogsPage from './AuditLogsPage';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/**
 * The audit trail, and the way into any one entity's log.
 *
 * The trail itself is only part of the picture — event and workshop attendance
 * scans are recorded in their own collections and never reach it — so several of
 * these cases pin down that the page routes to the per-entity view rather than
 * pretending the trail is complete.
 */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.adminAuditLogs]}>
      <Routes>
        <Route path={ROUTES.adminAuditLogs} element={<AuditLogsPage />} />
        <Route path={ROUTES.adminEntityLogs} element={<EntityLogsStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Stands in for the real page so navigation can be asserted without its fetches. */
function EntityLogsStub() {
  return <div>Entity log page</div>;
}

describe('AuditLogsPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  async function signInAsSuperAdmin() {
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  }

  const statCard = (label: string) => screen.getByRole('group', { name: label });

  it('shows seeded audit log entries for a super admin', async () => {
    await signInAsSuperAdmin();
    renderPage();
    expect(await screen.findAllByText(/CREATE_EVENT/)).not.toHaveLength(0);
  });

  it('denies a non-super-admin', async () => {
    const session = await mockApi.adminLogin({
      email: 'eventhead@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
    renderPage();
    expect(await screen.findByText(/Only Super Admins can view audit logs/i)).toBeInTheDocument();
  });

  /* ------------------------------------------------------------- figures --- */

  it('breaks the trail down by section', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText(/CREATE_EVENT/);

    // Counted from the trail the API returns, not asserted in the page source.
    const trail = await mockApi.auditLogs(1000);
    expect(statCard('Recorded Actions')).toHaveTextContent(String(trail.length));

    const hostelEntries = trail.filter((l) => l.action.includes('HOSTEL')).length;
    expect(statCard('Hostels')).toHaveTextContent(String(hostelEntries));
  });

  /* -------------------------------------------------------- all activity --- */

  it('reads a scan record as words rather than as a raw action name', async () => {
    await signInAsSuperAdmin();
    renderPage();

    // The trail carries HOSTEL_ENTRY / HOSTEL_EXIT / MESS_SCAN; a reader gets the
    // plain-language label, with the raw action still shown beside it. Two blocks
    // were entered in the seed, so this is deliberately findAll.
    expect(await screen.findAllByText('Entered the block')).not.toHaveLength(0);
    expect(screen.getByText('Left the block')).toBeInTheDocument();
    expect(screen.getAllByText('Meal served').length).toBeGreaterThan(0);
    expect(screen.getAllByText('HOSTEL_ENTRY').length).toBeGreaterThan(0);
  });

  it('narrows the trail to one section', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');

    await userEvent.selectOptions(screen.getByLabelText('Filter by section'), 'mess');

    expect(await screen.findByText('Created')).toBeInTheDocument();
    // Nothing from the hostel blocks remains.
    expect(screen.queryAllByText('Entered the block')).toHaveLength(0);
  });

  it('narrows the trail to one kind of record', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');

    await userEvent.selectOptions(screen.getByLabelText('Filter by kind'), 'exit');

    expect(await screen.findByText('Left the block')).toBeInTheDocument();
    expect(screen.queryAllByText('Entered the block')).toHaveLength(0);
  });

  it('links a trail row to the entity it concerns', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');

    // Four seeded entries target HS01, so every one of them links to that block.
    const links = screen.getAllByRole('link', { name: 'HS01' });
    expect(links).not.toHaveLength(0);
    for (const l of links) {
      expect(l).toHaveAttribute('href', '/staff/admin/audit-logs/hostels/HS01');
    }

    await userEvent.click(links[0]);
    expect(await screen.findByText('Entity log page')).toBeInTheDocument();
  });

  /* ----------------------------------------------------------- by entity --- */

  it('browses every entity that can be drilled into', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');

    await userEvent.click(screen.getByRole('radio', { name: 'By entity' }));

    // Every event, workshop, hall, and block is reachable — not only the ones
    // with recorded activity.
    const [events, workshops, mess, hostels] = await Promise.all([
      mockApi.listEvents(),
      mockApi.listWorkshops(),
      mockApi.listMess(),
      mockApi.listHostels(),
    ]);
    const total = events.length + workshops.length + mess.length + hostels.length;

    expect(await screen.findByText(`Showing 1 to 20 of ${total} entities`)).toBeInTheDocument();
  });

  it('sorts the busiest entities first and marks the quiet ones', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');
    await userEvent.click(screen.getByRole('radio', { name: 'By entity' }));

    // MS01 has the most recorded against it in the seed, so it leads the list.
    const first = (await screen.findAllByRole('link', { name: /^Logs for / }))[0];
    expect(first).toHaveAccessibleName('Logs for Himalaya');

    const trail = await mockApi.auditLogs(1000, { target_id: 'MS01' });
    expect(within(first).getByText(`${trail.length} logged`)).toBeInTheDocument();
  });

  it('filters the browser to one section', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');
    await userEvent.click(screen.getByRole('radio', { name: 'By entity' }));

    const mess = await mockApi.listMess();
    await userEvent.click(screen.getByRole('button', { name: `Mess halls, ${mess.length}` }));

    expect(
      await screen.findByText(`Showing 1 to ${mess.length} of ${mess.length} entities`),
    ).toBeInTheDocument();
  });

  it('searches the browser by name or id', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');
    await userEvent.click(screen.getByRole('radio', { name: 'By entity' }));

    await userEvent.type(screen.getByLabelText('Search entities'), 'Alakananda');

    expect(await screen.findByText('Showing 1 to 1 of 1 entities')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Logs for Alakananda' })).toHaveAttribute(
      'href',
      '/staff/admin/audit-logs/hostels/HS01',
    );
  });

  it('is explicit that the trail does not include attendance scans', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findAllByText('Entered the block');
    await userEvent.click(screen.getByRole('radio', { name: 'By entity' }));

    // The counts are audit-only, and saying so is what stops them being read as
    // the complete picture.
    expect(await screen.findByText(/not part of the trail/i)).toBeInTheDocument();
  });
});
