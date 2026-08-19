import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminHostelsPage from './AdminHostelsPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/**
 * The hostels section: five headline figures over a sortable, paged table of
 * blocks. Creation stays behind "+ New Hostel" so the list is what the page
 * opens on, and per-block management lives in the row's detail dialog.
 *
 * Occupancy is not stored on a hostel — it is fetched per block from the
 * Super-Admin-only statistics endpoint — so these cases sign in as a Super Admin
 * and let the page join the two.
 */
describe('AdminHostelsPage', () => {
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
        <AdminHostelsPage />
      </MemoryRouter>,
    );
  }

  const newHostelButton = () => screen.getByRole('button', { name: /New Hostel/i });
  /** The create form's own Gender field, not the toolbar's gender filter. */
  const genderField = () => screen.getByLabelText('Gender');
  const table = () => screen.getByRole('table');

  it('opens on the hostel list, with the form collapsed', async () => {
    renderPage();

    expect(await screen.findByText('Alakananda')).toBeInTheDocument();
    expect(newHostelButton()).toBeInTheDocument();

    // None of the creation fields are on the page yet.
    expect(screen.queryByLabelText(/Hostel ID/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create hostel' })).not.toBeInTheDocument();
  });

  /* ------------------------------------------------------------- figures --- */

  it('reports the campus totals from the seeded inventory', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    // 22 blocks of 300: 16 men's (4800 beds), 6 women's (1800). Counted from the
    // API response, not asserted in the page source.
    // Each stat card is a named group, so it can be addressed as a unit.
    expect(screen.getByRole('group', { name: 'Total Hostels' })).toHaveTextContent('22');
    expect(screen.getByRole('group', { name: 'Total Beds' })).toHaveTextContent('6,600');
    expect(screen.getByRole('group', { name: "Men's Hostels" })).toHaveTextContent('4,800 beds');
    expect(screen.getByRole('group', { name: "Women's Hostels" })).toHaveTextContent('1,800 beds');

    // There is a card per category present and no card for one that is not: the
    // seeded campus files every block as men's or women's, so no "Unspecified".
    expect(screen.queryByRole('group', { name: 'Unspecified Hostels' })).not.toBeInTheDocument();
  });

  it('shows capacity and occupancy per block, with the beds still free', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    // Occupancy is not stored on the hostel, so the expected figures come from
    // the same statistics endpoint the page reads rather than from a literal.
    const stat = await mockApi.hostelStatistics('HS01');

    const row = screen.getByRole('row', { name: /Alakananda/ });
    expect(within(row).getByText('HS01')).toBeInTheDocument();
    expect(within(row).getByText('Men')).toBeInTheDocument();
    expect(within(row).getByText('300')).toBeInTheDocument();

    // The bar reports the real counts, not just a percentage, and the beds left
    // are shown as a number rather than left for the reader to subtract.
    expect(within(row).getByRole('progressbar', { name: 'Alakananda occupancy' })).toHaveAttribute(
      'aria-valuetext',
      `${stat.total_allocated} of ${stat.capacity}`,
    );
    expect(within(row).getByText(String(stat.capacity - stat.total_allocated))).toBeInTheDocument();
  });

  /* --------------------------------------------------- filter, sort, page --- */

  it('pages the 22 blocks ten at a time', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    expect(screen.getByText('Showing 1 to 10 of 22 hostels')).toBeInTheDocument();
    // Sorted by name to begin with, so the eleventh block is off page one.
    expect(screen.queryByText('Tunga')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }));

    expect(screen.getByText('Showing 21 to 22 of 22 hostels')).toBeInTheDocument();
    expect(screen.getByText('Tunga')).toBeInTheDocument();
  });

  it('narrows the list to the women’s blocks', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    await userEvent.selectOptions(screen.getByLabelText('Filter by gender'), 'women');

    // Six women's blocks, so they all fit on one page and no men's block remains.
    expect(await screen.findByText('Showing 1 to 6 of 6 hostels')).toBeInTheDocument();
    expect(screen.queryByText('Alakananda')).not.toBeInTheDocument();
    expect(screen.getByText('Bhadra')).toBeInTheDocument();
  });

  it('searches by name and by hostel id', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    await userEvent.type(screen.getByLabelText('Search hostels'), 'HS22');

    expect(await screen.findByText('Tunga')).toBeInTheDocument();
    expect(screen.queryByText('Alakananda')).not.toBeInTheDocument();
  });

  it('sorts by a column when its header is used', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    // Exactly "Hostel" — the column header, not the "+ New Hostel" action.
    const nameHeader = screen.getByRole('button', { name: 'Hostel' });
    expect(nameHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(nameHeader);

    expect(nameHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
    // Z→A now, so the last block by name leads the first page.
    const firstRow = within(table()).getAllByRole('row')[1];
    expect(within(firstRow).getByText('Tunga')).toBeInTheDocument();
  });

  /* -------------------------------------------------------------- detail --- */

  it('opens a block’s detail dialog from its view action', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    await userEvent.click(screen.getByRole('button', { name: 'View Alakananda' }));

    const dialog = screen.getByRole('dialog');
    // The team roster and the "add member" field moved off the list into here.
    expect(within(dialog).getByText('Hostel Volunteer')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Add team member/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Scanning on/ })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /* -------------------------------------------------------------- create --- */

  it('reveals the creation fields when asked', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    await userEvent.click(newHostelButton());

    expect(screen.getByLabelText(/Hostel ID/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Capacity/)).toBeInTheDocument();
    expect(genderField()).toBeInTheDocument();
    // The trigger steps aside; Cancel closes the form instead.
    expect(screen.queryByRole('button', { name: /New Hostel/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('offers gender as a dropdown of Male and Female', async () => {
    renderPage();
    await screen.findByText('Alakananda');
    await userEvent.click(newHostelButton());

    const field = genderField();
    expect(field.tagName).toBe('SELECT');
    // Blocks are men's or women's; "Other" belongs on a person, not a building.
    expect([...field.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Select',
      'Male',
      'Female',
    ]);

    // Unchosen to begin with, so a block is never silently filed as men's — and
    // never the old free-text "any", which allocation could never have matched.
    expect(field).toHaveValue('');
  });

  it('sends the chosen gender when creating', async () => {
    renderPage();
    await screen.findByText('Alakananda');
    await userEvent.click(newHostelButton());

    await userEvent.type(screen.getByLabelText(/Hostel ID/), 'HS91');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Nilgiri');
    await userEvent.selectOptions(genderField(), 'female');
    await userEvent.click(screen.getByRole('button', { name: 'Create hostel' }));

    expect(await screen.findByText('Showing 1 to 10 of 23 hostels')).toBeInTheDocument();
    const created = (await mockApi.listHostels()).find((h) => h.hostel_id === 'HS91');
    expect(created?.gender).toBe('female');
  });

  it('keeps the existing validation on the create button', async () => {
    renderPage();
    await screen.findByText('Alakananda');
    await userEvent.click(newHostelButton());

    const create = screen.getByRole('button', { name: 'Create hostel' });
    expect(create).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Hostel ID/), 'HS90');
    expect(create).toBeDisabled(); // still needs a name

    await userEvent.type(screen.getByLabelText(/^Name/), 'Nilgiri');
    expect(create).toBeDisabled(); // and a gender, now that it starts unchosen

    await userEvent.selectOptions(genderField(), 'male');
    expect(create).toBeEnabled();
  });

  it('closes the form and forgets what was typed when cancelled', async () => {
    renderPage();
    await screen.findByText('Alakananda');
    await userEvent.click(newHostelButton());

    await userEvent.type(screen.getByLabelText(/Hostel ID/), 'HS90');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Hostel ID/)).not.toBeInTheDocument();

    // Reopening starts clean rather than resuming the abandoned draft.
    await userEvent.click(newHostelButton());
    expect(screen.getByLabelText(/Hostel ID/)).toHaveValue('');
    expect(screen.getByLabelText(/Capacity/)).toHaveValue(100);
    expect(genderField()).toHaveValue('');
  });

  it('creates the hostel, closes the form, and refreshes the list', async () => {
    renderPage();
    await screen.findByText('Alakananda');
    expect(screen.getByText(/22 hostels/)).toBeInTheDocument();

    await userEvent.click(newHostelButton());
    await userEvent.type(screen.getByLabelText(/Hostel ID/), 'HS90');
    await userEvent.type(screen.getByLabelText(/^Name/), 'Nilgiri');
    await userEvent.selectOptions(genderField(), 'male');
    await userEvent.click(screen.getByRole('button', { name: 'Create hostel' }));

    // Refreshed list, and the form is gone. The new block sorts to the last page
    // by name, so the footer count is what confirms the list re-read itself —
    // finding the row by name is the search case's job, not this one's.
    expect(await screen.findByText(/23 hostels/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Hostel ID/)).not.toBeInTheDocument();
    expect(newHostelButton()).toBeInTheDocument();

    expect((await mockApi.listHostels()).some((h) => h.hostel_id === 'HS90')).toBe(true);
  });

  it('leaves the allocate action alone', async () => {
    renderPage();
    await screen.findByText('Alakananda');

    expect(
      screen.getByRole('button', { name: /Allocate registered participants/i }),
    ).toBeInTheDocument();
  });
});
