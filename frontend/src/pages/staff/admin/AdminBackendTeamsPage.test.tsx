import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdminBackendTeamsPage from './AdminBackendTeamsPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminBackendTeamsPage />
    </MemoryRouter>,
  );
}

describe('AdminBackendTeamsPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
  });

  it('shows a 403 for a non-super-admin staff session', async () => {
    const session = await mockApi.adminLogin({
      email: 'eventhead@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
    renderPage();
    expect(
      await screen.findByText(/Only Super Admins can view backend teams/i),
    ).toBeInTheDocument();
  });

  async function signInAsSuperAdmin() {
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  }

  const newStaffButton = () => screen.getByRole('button', { name: /New Staff Account/i });
  /** One summary card, addressed by its label. */
  const statCard = (label: string) => screen.getByRole('group', { name: label });

  it('opens on the account list, with the form collapsed', async () => {
    await signInAsSuperAdmin();
    renderPage();

    expect(await screen.findByText('eventhead@paradox.dev')).toBeInTheDocument();

    // The trigger shares a row with the "Accounts" heading rather than sitting
    // above a form that is always open.
    const heading = screen.getByRole('heading', { name: 'Accounts' });
    expect(newStaffButton().parentElement).toContainElement(heading);

    // And the form itself is not on the page until it is asked for.

    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).not.toBeInTheDocument();
  });

  it('reveals the creation fields when asked', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('eventhead@paradox.dev');

    await userEvent.click(newStaffButton());

    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Role/)).toBeInTheDocument();
    // The trigger steps aside; Cancel closes the form instead.
    expect(screen.queryByRole('button', { name: /New Staff Account/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('lists staff and creates a new member as super admin', async () => {
    await signInAsSuperAdmin();
    renderPage();

    expect(await screen.findByText('eventhead@paradox.dev')).toBeInTheDocument();

    await userEvent.click(newStaffButton());
    await userEvent.type(screen.getByLabelText(/^Email/), 'newstaff@paradox.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('newstaff@paradox.dev')).toBeInTheDocument();
    // The form closes on success and the trigger comes back.
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    expect(newStaffButton()).toBeInTheDocument();
  });

  it('closes the form and forgets what was typed when cancelled', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('eventhead@paradox.dev');

    await userEvent.click(newStaffButton());
    await userEvent.type(screen.getByLabelText(/^Email/), 'draft@paradox.dev');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument();

    // Reopening starts clean rather than resuming the abandoned draft.
    await userEvent.click(newStaffButton());
    expect(screen.getByLabelText(/^Email/)).toHaveValue('');
  });

  /* ------------------------------------------------------------- figures --- */

  it('reports the account count, the privilege count, and the departments', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    // Counted from the API response, not asserted in the page source.
    const team = await mockApi.listBackendTeams();
    const superAdmins = team.filter((m) => m.role === 'super_admin').length;
    const departments = [...new Set(team.map((m) => m.department).filter(Boolean))].sort();

    // Each stat card is a named group, so it can be addressed as a unit.
    expect(statCard('Total Accounts')).toHaveTextContent(String(team.length));
    expect(statCard('Super Admins')).toHaveTextContent(String(superAdmins));

    // The department card names them rather than only counting them.
    expect(statCard('Departments')).toHaveTextContent(String(departments.length));
    expect(statCard('Departments')).toHaveTextContent(departments.join(', '));
  });

  it('reports that nothing needs detail when every record is complete', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    // Zero is a real answer here, unlike an unreadable occupancy figure, so the
    // card states it rather than hiding.
    expect(statCard('Needs Detail')).toHaveTextContent('0');
    expect(statCard('Needs Detail')).toHaveTextContent('Every record complete');
  });

  it('counts an account created without a department as needing detail', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    await userEvent.click(newStaffButton());
    await userEvent.type(screen.getByLabelText(/^Email/), 'nodept@paradox.dev');
    await userEvent.type(screen.getByLabelText(/^Password/), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByText('nodept@paradox.dev');
    expect(statCard('Needs Detail')).toHaveTextContent('1');
  });

  /* -------------------------------------------------------- find and sort --- */

  it('narrows the list to one department', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    // Options come from the data, since department is a free string on the backend.
    await userEvent.selectOptions(screen.getByLabelText('Filter by department'), 'workshops');

    expect(await screen.findByText('Showing 1 to 1 of 1 accounts')).toBeInTheDocument();
    expect(screen.getByText('workshopvolunteer@paradox.dev')).toBeInTheDocument();
    expect(screen.queryByText('superadmin@paradox.dev')).not.toBeInTheDocument();
  });

  it('narrows the list to the super admins', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('eventhead@paradox.dev');

    await userEvent.selectOptions(screen.getByLabelText('Filter by role'), 'super_admin');

    expect(await screen.findByText('Showing 1 to 1 of 1 accounts')).toBeInTheDocument();
    expect(screen.getByText('superadmin@paradox.dev')).toBeInTheDocument();
    expect(screen.queryByText('eventhead@paradox.dev')).not.toBeInTheDocument();
  });

  it('searches by paradox id as well as by email', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    const team = await mockApi.listBackendTeams();
    const target = team.find((m) => m.email === 'hostelvolunteer@paradox.dev')!;

    await userEvent.type(screen.getByLabelText('Search accounts'), target.paradox_id);

    expect(await screen.findByText('Showing 1 to 1 of 1 accounts')).toBeInTheDocument();
    expect(screen.getByText(target.email)).toBeInTheDocument();
  });

  it('reports its position in the footer', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    const team = await mockApi.listBackendTeams();
    expect(
      screen.getByText(`Showing 1 to ${team.length} of ${team.length} accounts`),
    ).toBeInTheDocument();
  });

  /* ----------------------------------------------------------------- view --- */

  it('opens on the cards and offers a sortable table behind the toggle', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('superadmin@paradox.dev');

    // Cards by default: a staff account is four short strings, so there is no
    // column of figures for a table to make comparable.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Table view' }));

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Department/ })).toBeInTheDocument();

    // Sorted by email A→Z to begin with, so the first row is the alphabetical first.
    const emailHeader = screen.getByRole('button', { name: 'Member' });
    expect(emailHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(emailHeader);
    expect(emailHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');

    const firstRow = within(table).getAllByRole('row')[1];
    expect(within(firstRow).getByText('workshopvolunteer@paradox.dev')).toBeInTheDocument();
  });

  /* --------------------------------------------------------------- remove --- */

  it('asks before removing an account', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('eventhead@paradox.dev');

    await userEvent.click(
      screen.getByRole('button', { name: 'Actions for eventhead@paradox.dev' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Remove eventhead@paradox.dev?');

    await userEvent.click(screen.getByRole('button', { name: 'Remove staff' }));

    await waitFor(() =>
      expect(screen.queryByText('eventhead@paradox.dev')).not.toBeInTheDocument(),
    );
  });

  it('keeps the create button unavailable until the account can be made', async () => {
    await signInAsSuperAdmin();
    renderPage();
    await screen.findByText('eventhead@paradox.dev');
    await userEvent.click(newStaffButton());

    const create = screen.getByRole('button', { name: 'Create account' });
    expect(create).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Email/), 'newstaff@paradox.dev');
    expect(create).toBeDisabled(); // still needs a password of at least 8 characters

    await userEvent.type(screen.getByLabelText(/^Password/), 'short');
    expect(create).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Password/), '1234');
    expect(create).toBeEnabled();
  });
});
