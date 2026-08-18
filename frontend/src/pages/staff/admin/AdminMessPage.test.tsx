import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminMessPage from './AdminMessPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/**
 * The mess section: headline seat figures over a sortable, paged table of halls.
 * Creation stays behind "+ New Mess" so the list is what the page opens on, and
 * per-hall management lives in the row's detail dialog.
 *
 * A hall is described on two independent axes — the dietary type allocation
 * groups on, and the regional menu it cooks — so several of these cases exist to
 * pin down that the table keeps them apart.
 */
describe('AdminMessPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <AdminMessPage />
      </MemoryRouter>,
    );
  }

  const newMessButton = () => screen.getByRole('button', { name: /New Mess/i });
  /** The create form's own Preference field, not the toolbar's type filter. */
  const preferenceField = () => screen.getByLabelText('Preference');
  const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) });
  const table = () => screen.getByRole('table');

  it('opens on the hall list, with the form collapsed', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Mess', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText('Himalaya')).toBeInTheDocument();
    expect(newMessButton()).toBeInTheDocument();

    // None of the creation fields are on the page yet.
    expect(screen.queryByLabelText(/Mess ID/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Preference')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create mess hall' })).not.toBeInTheDocument();
  });

  /* ------------------------------------------------------------- figures --- */

  it('reports the seat totals and how they split by dietary type', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    // Counted from the API response, not asserted in the page source.
    const halls = await mockApi.listMess();
    const seats = halls.reduce((sum, h) => sum + h.capacity, 0);
    const vegSeats = halls
      .filter((h) => h.preference === 'veg')
      .reduce((sum, h) => sum + h.capacity, 0);

    // Each stat card is a named group, so it can be addressed as a unit.
    const statCard = (label: string) => screen.getByRole('group', { name: label });

    expect(statCard('Total Halls')).toHaveTextContent(String(halls.length));
    expect(statCard('Total Seats')).toHaveTextContent(seats.toLocaleString());

    expect(statCard('Veg Seats')).toHaveTextContent(vegSeats.toLocaleString());
    expect(statCard('Veg Seats')).toHaveTextContent(`${Math.round((vegSeats / seats) * 100)}%`);
  });

  it('reports a card for every dietary type present, so the shares add up', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    const halls = await mockApi.listMess();
    const present = new Set(halls.map((h) => h.preference));

    // The seeded catalogue covers all three, and jain must not be dropped just
    // because the reference design only drew veg and non-veg.
    expect(present).toEqual(new Set(['veg', 'non_veg', 'jain']));
    expect(screen.getByText('Veg Seats')).toBeInTheDocument();
    expect(screen.getByText('Non-Veg Seats')).toBeInTheDocument();
    expect(screen.getByText('Jain Seats')).toBeInTheDocument();
  });

  it('counts the halls and their seats in the header', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    const halls = await mockApi.listMess();
    const seats = halls.reduce((sum, h) => sum + h.capacity, 0);

    expect(
      screen.getByText(`${halls.length} halls · ${seats.toLocaleString()} total seats`),
    ).toBeInTheDocument();
  });

  /* --------------------------------------------------------- the two axes --- */

  it('shows the dietary type and the regional menu in separate columns', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    // Himalaya is North Indian only, Vindhya South Indian only.
    expect(within(row('Himalaya')).getByText('North Indian')).toBeInTheDocument();
    expect(within(row('Himalaya')).queryByText('South Indian')).not.toBeInTheDocument();

    expect(within(row('Vindhya')).getByText('South Indian')).toBeInTheDocument();
    expect(within(row('Vindhya')).queryByText('North Indian')).not.toBeInTheDocument();

    // Nilgiri serves both, which is why the region column holds a list.
    expect(within(row('Nilgiri')).getByText('North Indian')).toBeInTheDocument();
    expect(within(row('Nilgiri')).getByText('South Indian')).toBeInTheDocument();

    // And the dietary type is its own badge, labelled rather than raw.
    expect(within(row('Himalaya')).getByText('Veg')).toBeInTheDocument();
    expect(within(row('Vindhya')).getByText('Non-Veg')).toBeInTheDocument();
    expect(within(row('Nilgiri')).getByText('Jain')).toBeInTheDocument();
  });

  it('shows capacity and occupancy per hall, with the seats still free', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    // Occupancy is not stored on the hall, so the expected figures come from the
    // same statistics endpoint the page reads rather than from a literal. Himalaya
    // is the hall the seeded participants are allocated to, so capacity and
    // seats-free are different numbers here and can be told apart.
    const stat = await mockApi.messStatistics('MS01');
    expect(stat.total_allocated).toBeGreaterThan(0);

    const himalaya = row('Himalaya');
    expect(within(himalaya).getByText('MS01')).toBeInTheDocument();
    expect(within(himalaya).getByText(String(stat.capacity))).toBeInTheDocument();

    // The bar reports the real counts, not just a percentage, and the seats left
    // are shown as a number rather than left for the reader to subtract.
    expect(
      within(himalaya).getByRole('progressbar', { name: 'Himalaya occupancy' }),
    ).toHaveAttribute('aria-valuetext', `${stat.total_allocated} of ${stat.capacity}`);
    expect(
      within(himalaya).getByText(String(stat.capacity - stat.total_allocated)),
    ).toBeInTheDocument();
  });

  /* --------------------------------------------------- filter, sort, page --- */

  it('narrows the list to one dietary type', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.selectOptions(screen.getByLabelText('Filter by type'), 'jain');

    expect(await screen.findByText('Showing 1 to 1 of 1 mess halls')).toBeInTheDocument();
    expect(screen.getByText('Nilgiri')).toBeInTheDocument();
    expect(screen.queryByText('Himalaya')).not.toBeInTheDocument();
  });

  it('searches by name and by hall id', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.type(screen.getByLabelText('Search mess halls'), 'MS02');

    expect(await screen.findByText('Vindhya')).toBeInTheDocument();
    expect(screen.queryByText('Himalaya')).not.toBeInTheDocument();
  });

  it('sorts by a column when its header is used', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    // Exactly "Mess hall" — the column header, not the "+ New Mess" action.
    const nameHeader = screen.getByRole('button', { name: 'Mess hall' });
    expect(nameHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    expect(
      within(within(table()).getAllByRole('row')[1]).getByText('Himalaya'),
    ).toBeInTheDocument();

    await userEvent.click(nameHeader);

    expect(nameHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
    // Z→A now, so the last hall by name leads.
    const firstRow = within(table()).getAllByRole('row')[1];
    expect(within(firstRow).getByText('Vindhya')).toBeInTheDocument();
  });

  it('reports its position in the footer', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    const halls = await mockApi.listMess();
    expect(
      screen.getByText(`Showing 1 to ${halls.length} of ${halls.length} mess halls`),
    ).toBeInTheDocument();
  });

  /* -------------------------------------------------------------- detail --- */

  it('opens a hall’s detail dialog from its view action', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.click(screen.getByRole('button', { name: 'View Himalaya' }));

    const dialog = screen.getByRole('dialog');
    // The team roster and the "add member" field moved off the list into here.
    expect(within(dialog).getByText('Mess Volunteer')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Add team member/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Scanning on/ })).toBeInTheDocument();
    // The menu is spelled out here rather than badged.
    expect(within(dialog).getByText('Serves North Indian')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // And a hall that cooks both reads as a list, not as two separate claims.
    await userEvent.click(screen.getByRole('button', { name: 'View Nilgiri' }));
    expect(
      within(screen.getByRole('dialog')).getByText('Serves North Indian and South Indian'),
    ).toBeInTheDocument();
  });

  it('says so when a hall has no regional menu declared', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.click(newMessButton());
    await userEvent.type(screen.getByLabelText(/Mess ID/), 'MS05');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Kaveri');
    await userEvent.click(screen.getByRole('button', { name: 'Create mess hall' }));

    await screen.findByText('Kaveri');
    // An em dash in the table rather than a blank cell, which would read as a
    // rendering failure.
    expect(within(row('Kaveri')).getByTitle('No regional menu declared')).toBeInTheDocument();
  });

  /* -------------------------------------------------------------- create --- */

  it('reveals the creation fields when asked', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.click(newMessButton());

    expect(screen.getByLabelText(/Mess ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Capacity/)).toBeInTheDocument();
    expect(preferenceField()).toBeInTheDocument();
    // The trigger steps aside; Cancel closes the form instead.
    expect(screen.queryByRole('button', { name: /New Mess/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('records the cuisines chosen when creating a hall', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    await userEvent.click(newMessButton());
    await userEvent.type(screen.getByLabelText(/Mess ID/), 'MS04');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Sahyadri');
    // Checkboxes rather than a dropdown, so both menus can be picked at once.
    await userEvent.click(screen.getByRole('checkbox', { name: 'North Indian' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'South Indian' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create mess hall' }));

    await screen.findByText('Sahyadri');
    const created = (await mockApi.listMess()).find((h) => h.mess_id === 'MS04');
    expect(created?.cuisines).toEqual(['north_indian', 'south_indian']);
  });

  it('creates a mess hall, closes the form, and refreshes the list', async () => {
    renderPage();
    await screen.findByText('Himalaya');
    expect(screen.getByText(/of 3 mess halls/)).toBeInTheDocument();

    await userEvent.click(newMessButton());
    await userEvent.type(screen.getByLabelText(/Mess ID/), 'MS09');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Sahyadri');
    await userEvent.click(screen.getByRole('button', { name: 'Create mess hall' }));

    expect(await screen.findByText('Sahyadri')).toBeInTheDocument();
    expect(await screen.findByText(/of 4 mess halls/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Mess ID/)).not.toBeInTheDocument();
    expect(newMessButton()).toBeInTheDocument();
  });

  it('closes the form and forgets what was typed when cancelled', async () => {
    renderPage();
    await screen.findByText('Himalaya');
    await userEvent.click(newMessButton());

    await userEvent.type(screen.getByLabelText(/Mess ID/), 'MS09');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Mess ID/)).not.toBeInTheDocument();

    // Reopening starts clean rather than resuming the abandoned draft.
    await userEvent.click(newMessButton());
    expect(screen.getByLabelText(/Mess ID/)).toHaveValue('');
    expect(screen.getByLabelText(/Capacity/)).toHaveValue(100);
  });

  it('keeps the create button unavailable until the hall is named', async () => {
    renderPage();
    await screen.findByText('Himalaya');
    await userEvent.click(newMessButton());

    expect(screen.getByRole('button', { name: 'Create mess hall' })).toBeDisabled();
  });

  it('leaves the allocate action alone', async () => {
    renderPage();
    await screen.findByText('Himalaya');

    expect(
      screen.getByRole('button', { name: /Allocate unassigned participants/i }),
    ).toBeInTheDocument();
  });
});
