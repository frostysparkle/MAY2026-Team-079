import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminOverviewPage from './AdminOverviewPage';
import { useAuthStore } from '@/stores/authStore';
import { __resetMockApiForTests, mockApi } from '@/api/mock/mockApi';

/**
 * The Fest Control Board.
 *
 * Two properties matter more than any individual figure and are pinned here:
 * the board is **read-only** — nothing on it can change fest data — and it
 * **never renders an unreadable figure as zero**, since a partial total that
 * looks complete is the one failure mode a monitoring board must not have.
 */
describe('AdminOverviewPage', () => {
  beforeEach(async () => {
    useAuthStore.getState().clear();
    __resetMockApiForTests();
    const session = await mockApi.adminLogin({
      email: 'superadmin@paradox.dev',
      password: 'password123',
    });
    useAuthStore.getState().setStaffSession(session);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>,
    );
  }

  const panel = (name: RegExp) => screen.findByRole('region', { name });

  it('renders every domain panel', async () => {
    renderPage();
    expect(await panel(/^Hostels$/)).toBeInTheDocument();
    expect(await panel(/^Mess$/)).toBeInTheDocument();
    expect(await panel(/^Events$/)).toBeInTheDocument();
    expect(await panel(/^Workshops$/)).toBeInTheDocument();
    expect(await panel(/Staff & Volunteers/)).toBeInTheDocument();
    expect(await panel(/^Participants$/)).toBeInTheDocument();
    expect(await panel(/Finance & Payments/)).toBeInTheDocument();
    expect(await panel(/Live activity/)).toBeInTheDocument();
  });

  it('shows the fest health strip', async () => {
    renderPage();
    expect(await screen.findByRole('region', { name: /Fest health/i })).toBeInTheDocument();
  });

  it('leads the participants panel with the real registered total', async () => {
    const stats = await mockApi.participantStatistics();
    renderPage();

    const participants = await panel(/^Participants$/);
    expect(
      await within(participants).findByText(/Total registered participants/i),
    ).toBeInTheDocument();
    // The figure comes from `/participants/statistics`, not from summing rosters.
    expect(
      within(participants).getAllByText(stats.total_registered.toLocaleString()).length,
    ).toBeGreaterThan(0);
  });

  it('labels the finance panel as demo data', async () => {
    renderPage();
    const finance = await panel(/Finance & Payments/);
    expect(await within(finance).findByText(/Demo data/i)).toBeInTheDocument();
    expect(await within(finance).findByText(/the API records no payments/i)).toBeInTheDocument();
  });

  it('offers no control that could change fest data', async () => {
    renderPage();
    await panel(/^Hostels$/);

    // The board hands off; it never acts. "Refresh all" is the only button, and
    // it re-reads. Anything matching an allocate/create/delete verb here would
    // mean a mutation had crept onto a read-only screen.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Refresh/i)]),
    );
    for (const button of buttons) {
      expect(button.textContent ?? '').not.toMatch(
        /allocate|create|new |delete|remove|assign|save|edit/i,
      );
    }
  });

  it('renders a dash rather than a zero when statistics cannot be read', async () => {
    // Hostel occupancy is Super-Admin-only and fails per block. "Nobody is
    // allocated" and "we could not find out" must not look the same.
    vi.spyOn(mockApi, 'hostelStatistics').mockRejectedValue(new Error('nope'));
    renderPage();

    const hostels = await panel(/^Hostels$/);
    const allotted = await within(hostels).findByText(/^Allotted$/i);
    const figure = allotted.parentElement;
    expect(figure?.textContent).toContain('—');
    expect(figure?.textContent).not.toMatch(/Allotted\s*0\b/);
  });

  it('raises a partial-data notice when a section fails to load', async () => {
    vi.spyOn(mockApi, 'listEvents').mockRejectedValue(new Error('nope'));
    renderPage();

    const health = await screen.findByRole('region', { name: /Fest health/i });
    expect(await within(health).findByText(/Some figures are incomplete/i)).toBeInTheDocument();
  });

  it('links each panel to the section that owns it', async () => {
    renderPage();

    const hostels = await panel(/^Hostels$/);
    expect(within(hostels).getByRole('link', { name: /Manage hostels/i })).toHaveAttribute(
      'href',
      '/staff/admin/hostels',
    );

    const workshops = await panel(/^Workshops$/);
    expect(within(workshops).getByRole('link', { name: /Manage workshops/i })).toHaveAttribute(
      'href',
      '/staff/admin/workshops',
    );
  });
});
