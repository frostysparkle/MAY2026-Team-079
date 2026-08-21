import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  BackendTeamMember,
  StaffLoginResponse,
  Workshop,
  WorkshopLogsResponse,
  WorkshopParticipationResponse,
  WorkshopParticipationRow,
} from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { ApiClientError } from '@/api';

/**
 * The workshop desk is only delivered if the people who staff it can read and
 * correct their own room, so these assert the rendered screen for each kind of
 * caller. The derivation behind it is covered by `workshopRoster.test.ts`.
 *
 * The three callers that matter:
 *   * an assigned volunteer, for whom `GET /workshops/{id}/participation` now
 *     answers — names, levels, and the attendance override;
 *   * a staff account the roster route refuses with 403, which is the server
 *     saying they are not on this team;
 *   * anybody at all when that route fails for some *other* reason, where the
 *     counts must survive and the screen must say what is missing.
 */

const WORKSHOP_ID = 'workshop-02';
const VOLUNTEER = 'BT1000000003';

const listWorkshops = vi.fn<() => Promise<Workshop[]>>();
const workshopLogs = vi.fn<() => Promise<WorkshopLogsResponse>>();
const workshopParticipation = vi.fn<() => Promise<WorkshopParticipationResponse>>();
const updateWorkshopParticipant =
  vi.fn<() => Promise<{ message: string; participant_id: string }>>();
const listBackendTeams = vi.fn<() => Promise<BackendTeamMember[]>>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      listWorkshops: () => listWorkshops(),
      workshopLogs: () => workshopLogs(),
      workshopParticipation: () => workshopParticipation(),
      updateWorkshopParticipant: () => updateWorkshopParticipant(),
      listBackendTeams: () => listBackendTeams(),
    },
  };
});

const { default: WorkshopManagePage } = await import('./WorkshopManagePage');

function makeWorkshop(withTeam: boolean): Workshop {
  return {
    workshop_id: WORKSHOP_ID,
    slot_id: '2026-06-12-afternoon',
    name: 'Ethics of AI',
    venue: 'CRC - 101',
    capacity: 100,
    instructions: 'Bring a laptop.',
    // 8 seats gone (7 bookings + 1 on-spot), 6 people present.
    registration_count: 8,
    participant_count: 6,
    ...(withTeam
      ? { workshop_team: [{ user_id: VOLUNTEER, role: 'workshop_volunteer', attendance: true }] }
      : {}),
  };
}

function makeRow(partial: Partial<WorkshopParticipationRow>): WorkshopParticipationRow {
  return {
    participant_id: 'DS23F3000001',
    name: null,
    email: null,
    phone: null,
    house: null,
    gender: null,
    program: null,
    course_stage: null,
    academic_level: null,
    academic_level_number: null,
    degree: null,
    entry_year: null,
    booking_type: 'pre-registered',
    attended: false,
    slot_id: '2026-06-12-afternoon',
    ...partial,
  };
}

/** Five booked-and-present, two absentees, one walk-in — across all three levels. */
const ROSTER: WorkshopParticipationResponse = {
  workshop_id: WORKSHOP_ID,
  name: 'Ethics of AI',
  venue: 'CRC - 101',
  slot_id: '2026-06-12-afternoon',
  capacity: 100,
  registration_count: 8,
  participant_count: 6,
  count: 8,
  attended_count: 6,
  absent_count: 2,
  on_spot_count: 1,
  workshop_team: [
    {
      user_id: VOLUNTEER,
      role: 'workshop_manager',
      attendance: true,
      name: 'Meera Raghavan',
      phone: '+91 90000 00009',
    },
  ],
  participants: [
    makeRow({
      participant_id: 'DS23F3000001',
      name: 'Ananya Iyer',
      email: 'ananya@ds.study.iitm.ac.in',
      program: 'DS',
      course_stage: 'diploma',
      academic_level: 'Diploma',
      attended: true,
    }),
    makeRow({ participant_id: 'DS23F3000002', course_stage: 'diploma', attended: true }),
    makeRow({ participant_id: 'DS21F3000003', course_stage: 'degree', attended: true }),
    makeRow({ participant_id: 'ES24F1000004', course_stage: 'foundational', attended: true }),
    makeRow({ participant_id: 'MS26F1000005', course_stage: 'foundational', attended: true }),
    makeRow({ participant_id: 'DS23F3000006', name: 'Rohan Das', course_stage: 'degree' }),
    makeRow({ participant_id: 'DS23F3000007', course_stage: null }),
    makeRow({
      participant_id: 'AE26F2000008',
      course_stage: 'foundational',
      booking_type: 'on-spot',
      attended: true,
    }),
  ],
};

function signIn(role: string, id = VOLUNTEER) {
  const session: StaffLoginResponse = {
    id,
    email: `${id.toLowerCase()}@paradox.in`,
    access_token: 't',
    token_type: 'staff',
    role,
    department: 'workshops',
    designation: 'Workshop Volunteer',
  };
  useAuthStore.getState().setStaffSession(session);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[path(ROUTES.workshopManage, { workshopId: WORKSHOP_ID })]}>
      <Routes>
        <Route path={ROUTES.workshopManage} element={<WorkshopManagePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WorkshopManagePage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clear();
    listBackendTeams.mockResolvedValue([]);
    listWorkshops.mockResolvedValue([makeWorkshop(false)]);
    workshopParticipation.mockResolvedValue(ROSTER);
    // The Super Admin-only log; a volunteer gets this 403 and keeps everything else.
    workshopLogs.mockRejectedValue(new ApiClientError(403, 'Only Super Admins can view logs'));
    updateWorkshopParticipant.mockResolvedValue({
      message: 'Participant record updated',
      participant_id: 'DS23F3000007',
    });
  });

  it('gives an assigned volunteer the counts, the lists and the exports', async () => {
    signIn('volunteer');
    renderPage();

    const registered = await screen.findByRole('group', { name: /registered/i });
    expect(registered).toHaveTextContent('8');
    expect(screen.getByRole('group', { name: /^attended$/i })).toHaveTextContent('6');
    expect(screen.getByRole('group', { name: /not attended/i })).toHaveTextContent('2');
    expect(screen.getByRole('group', { name: /on-spot admitted/i })).toHaveTextContent('1');
    expect(screen.getByText(/9 of 10 on-spot places left/i)).toBeInTheDocument();

    // Names, not just ids — the roster route is what makes this possible.
    expect(screen.getByText('Ananya Iyer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attended (5)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Not attended (2)' }));
    expect(screen.getByText('Rohan Das')).toBeInTheDocument();
    expect(screen.getByText('DS23F3000007')).toBeInTheDocument();
    expect(screen.queryByText('Ananya Iyer')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'On-spot (1)' }));
    expect(screen.getByText('AE26F2000008')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /On-spot registrations \(1\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Registered students who attended \(5\)/i }),
    ).toBeInTheDocument();

    // No "this device only" caveat: the roster came from the server.
    expect(
      screen.queryByText(/Names below are the scans made on this device/i),
    ).not.toBeInTheDocument();
  });

  it('charts interest by real academic level', async () => {
    signIn('volunteer');
    renderPage();

    const chart = await screen.findByRole('img', { name: /interest by academic level/i });
    // Foundation 3, Diploma 2, Degree 2, and one profile-less registrant excluded.
    expect(chart).toHaveAccessibleName(/Foundation 3/);
    expect(chart).toHaveAccessibleName(/Diploma 2/);
    expect(chart).toHaveAccessibleName(/Degree 2/);
    expect(screen.getByText(/1 of them have no completed profile/i)).toBeInTheDocument();

    // The cohort approximation is gone once a real level is available.
    expect(screen.queryByRole('img', { name: /entry cohort/i })).not.toBeInTheDocument();
  });

  it('lets a volunteer correct attendance by hand', async () => {
    signIn('volunteer');
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Not attended (2)' }));
    const rows = screen.getAllByRole('button', { name: 'Mark present' });
    expect(rows).toHaveLength(2);

    await userEvent.click(rows[0]);
    expect(updateWorkshopParticipant).toHaveBeenCalledTimes(1);
    // The reload re-reads the roster, so the screen follows the server.
    expect(workshopParticipation).toHaveBeenCalledTimes(2);
  });

  it('hides the override when scanning is switched off for this volunteer', async () => {
    signIn('volunteer');
    workshopParticipation.mockResolvedValue({
      ...ROSTER,
      workshop_team: [{ ...ROSTER.workshop_team[0], attendance: false }],
    });
    renderPage();

    expect(await screen.findByText(/Your scanning is switched off/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark present' })).not.toBeInTheDocument();
  });

  it('refuses a staff account the roster route refuses', async () => {
    signIn('volunteer', 'BT9999999999');
    workshopParticipation.mockRejectedValue(
      new ApiClientError(403, "Not authorized to view this workshop's participation"),
    );
    renderPage();

    expect(await screen.findByText(/You are not on this workshop’s team/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Not authorized to view this workshop's participation/i),
    ).toBeInTheDocument();
  });

  it('keeps the counts and falls back to this device when the roster route breaks', async () => {
    signIn('volunteer');
    // Not a 403: a 500 says nothing about authority, so the page stays open.
    workshopParticipation.mockRejectedValue(new ApiClientError(500, 'Internal Server Error'));
    renderPage();

    expect(await screen.findByRole('group', { name: /registered/i })).toHaveTextContent('8');
    expect(screen.getByRole('group', { name: /^attended$/i })).toHaveTextContent('6');
    expect(screen.getByText(/Names below are the scans made on this device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attended (0)' })).toBeInTheDocument();
    // With no level anywhere, the chart says cohort and not level.
    expect(
      screen.queryByRole('img', { name: /interest by academic level/i }),
    ).not.toBeInTheDocument();
  });

  it('shows a Super Admin the team with names and the log’s timestamps', async () => {
    signIn('super_admin', 'BT1000000001');
    listWorkshops.mockResolvedValue([makeWorkshop(true)]);
    workshopLogs.mockResolvedValue({
      logs: [
        {
          workshop_id: 'w',
          action: 'registration',
          participant_id: 'DS23F3000001',
          timestamp: '2026-06-12T04:00:00',
        },
        {
          workshop_id: 'w',
          action: 'attendance',
          scan_type: 'pre-registered',
          participant_id: 'DS23F3000001',
          scanned_by: VOLUNTEER,
          timestamp: '2026-06-12T08:30:00',
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('Meera Raghavan')).toBeInTheDocument();
    expect(screen.getByText(/booked .* · scanned /i)).toBeInTheDocument();
    // Assignment controls are Super Admin-only.
    expect(screen.getByRole('button', { name: /Create new staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
  });
});
