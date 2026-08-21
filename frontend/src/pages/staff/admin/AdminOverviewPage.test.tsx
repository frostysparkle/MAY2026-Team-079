import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  AuditLogSummary,
  BackendTeamMember,
  ParticipantStatisticsResponse,
} from '@/api/types';
import type { AuditFeeds, FestSnapshot } from '@/features/overview/useFestSnapshot';

/**
 * The Fest Control Board's pulse row.
 *
 * The board makes roughly eighty requests, so this mocks `useFestSnapshot` rather
 * than the network: what is under test is how the four headline figures are
 * *derived* from a snapshot, not the fetching, which the hook owns and the pure
 * modules beside it already cover.
 *
 * Every assertion here is about a figure that used to be computed from the wrong
 * thing — a capped feed, or a denominator drawn from a different population than
 * its numerator.
 */

const useFestSnapshot = vi.fn<() => FestSnapshot>();

vi.mock('@/features/overview/useFestSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/overview/useFestSnapshot')>();
  return { ...actual, useFestSnapshot: () => useFestSnapshot() };
});

const { default: AdminOverviewPage } = await import('./AdminOverviewPage');

function auditSummary(over: Partial<AuditLogSummary> = {}): AuditLogSummary {
  return {
    total: 0,
    by_action: {},
    distinct_actors: 0,
    actor_ids: [],
    meals: null,
    window: { since: null, until: null },
    ...over,
  };
}

function feeds(over: Partial<AuditFeeds> = {}): AuditFeeds {
  return {
    messScans: [],
    hostelEntry: [],
    hostelExit: [],
    accommodation: [],
    eventRegistrations: [],
    recent: [],
    pulse: [],
    today: null,
    trail: null,
    truncated: [],
    ...over,
  };
}

/**
 * Fest-wide participant counts.
 *
 * `currently_on_campus` is deliberately far below `total_registered` and only a
 * little below `hostel_allotted`: 180 of 200 residents is a nearly full campus,
 * while 180 of 2,483 registered reads as a nearly empty one. Which denominator the
 * card picks is visible in the caption.
 */
function participantStats(
  over: Partial<ParticipantStatisticsResponse> = {},
): ParticipantStatisticsResponse {
  return {
    total_registered: 2483,
    profile_complete: 2481,
    profile_incomplete: 2,
    mess_registered: 524,
    mess_allotted: 524,
    hostel_registered: 210,
    hostel_allotted: 200,
    hostel_pending: 10,
    currently_on_campus: 180,
    with_event_registrations: 1625,
    with_workshop_registrations: 1410,
    by_house: {},
    by_program: {},
    by_course_stage: {},
    by_gender: {},
    signups_by_day: {},
    ...over,
  };
}

function staffMember(paradoxId: string): BackendTeamMember {
  return {
    paradox_id: paradoxId,
    email: `${paradoxId.toLowerCase()}@ds.study.iitm.ac.in`,
    role: 'event_head',
    department: 'technicals',
  } as BackendTeamMember;
}

function snapshot(over: Partial<FestSnapshot> = {}): FestSnapshot {
  return {
    participants: participantStats(),
    workshops: [],
    staff: [],
    audit: feeds(),
    queries: [],
    issues: [],
    mess: [],
    messStats: {},
    hostels: [],
    hostelStats: {},
    events: [],
    participation: {},
    tiers: {
      fast: { loading: false, updatedAt: new Date('2026-08-21T12:00:00Z'), error: null },
      medium: { loading: false, updatedAt: new Date('2026-08-21T12:00:00Z'), error: null },
      slow: { loading: false, updatedAt: new Date('2026-08-21T12:00:00Z'), error: null },
    },
    failedDomains: [],
    loading: false,
    refresh: vi.fn(),
    ...over,
  };
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <AdminOverviewPage />
    </MemoryRouter>,
  );
}

function kpi(label: string) {
  return within(screen.getByRole('group', { name: label }));
}

describe('AdminOverviewPage pulse row', () => {
  describe('On campus now', () => {
    /**
     * `currently_on_campus` counts `accommodation.logged_in`, which only somebody
     * holding a hostel bed can set — it is written by the hostel entry scanner.
     * Measuring it against everyone registered put every day visitor in the
     * denominator with no way into the numerator, so the bar could never fill and
     * read far emptier than campus was.
     */
    it('measures residents scanned in against residents, not everyone registered', () => {
      useFestSnapshot.mockReturnValue(snapshot());
      renderBoard();

      const card = kpi('On campus now');
      expect(card.getByText('180')).toBeInTheDocument();
      expect(card.getByText('of 200 with a bed')).toBeInTheDocument();
      // The old denominator must be gone.
      expect(card.queryByText('of 2,483 registered')).not.toBeInTheDocument();
    });

    it('can reach a full campus when every resident is inside', () => {
      useFestSnapshot.mockReturnValue(
        snapshot({ participants: participantStats({ currently_on_campus: 200 }) }),
      );
      renderBoard();

      const card = kpi('On campus now');
      const bar = card.getByRole('progressbar');
      expect(bar).toHaveAttribute('aria-valuenow', '200');
      expect(bar).toHaveAttribute('aria-valuemax', '200');
    });

    it('falls back to a plain figure when nobody has a bed yet', () => {
      // 0 residents would make the ratio undefined, so no bar is drawn at all.
      useFestSnapshot.mockReturnValue(
        snapshot({
          participants: participantStats({ hostel_allotted: 0, currently_on_campus: 0 }),
        }),
      );
      renderBoard();

      const card = kpi('On campus now');
      expect(card.getByText('residents scanned into a hostel')).toBeInTheDocument();
      expect(card.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  describe('Meals today', () => {
    /**
     * The headline is meals, not card reads. `meals_served` de-duplicates to one
     * entry per (diner, day, slot) across the whole day, server-side — so the
     * figure is neither a scan count nor capped by the fetched feed.
     */
    it('reports meals served rather than the number of scans', () => {
      useFestSnapshot.mockReturnValue(
        snapshot({
          audit: feeds({
            today: auditSummary({
              meals: {
                scans: 1450,
                meals_served: 1200,
                duplicate_scans: 250,
                unique_diners: 900,
                unclassified: 0,
                by_slot: { breakfast: 400, lunch: 500, dinner: 300 },
                by_day: { '1': 1200 },
              },
            }),
          }),
        }),
      );
      renderBoard();

      const card = kpi('Meals today');
      expect(card.getByText('1,200')).toBeInTheDocument();
      // Not the raw scan count, which is what a row tally would have produced.
      expect(card.queryByText('1,450')).not.toBeInTheDocument();
      // Diners and discarded re-scans explain the gap to anyone tallying the trail.
      expect(card.getByText(/900 diners/)).toBeInTheDocument();
      expect(card.getByText(/250 re-scans ignored/)).toBeInTheDocument();
    });

    it('drops back to the fetched feed, and says so, without the summary', () => {
      useFestSnapshot.mockReturnValue(
        snapshot({ audit: feeds({ today: null, truncated: ['meal scans'] }) }),
      );
      renderBoard();

      const card = kpi('Meals today');
      expect(card.getByText('trail truncated — a floor')).toBeInTheDocument();
    });
  });

  describe('Staff active today', () => {
    /**
     * This used to be the actors appearing in the newest sixty unfiltered rows,
     * filtered to today — a floor that drifted further from the truth the busier
     * the fest got. `actor_ids` is the distinct set for the whole day.
     */
    it('counts staff from the day\u2019s distinct actors', () => {
      useFestSnapshot.mockReturnValue(
        snapshot({
          staff: [staffMember('BT1'), staffMember('BT2'), staffMember('BT3')],
          audit: feeds({
            today: auditSummary({
              // Includes a participant id and an unknown staffer: only the two
              // matching the roster may be counted.
              actor_ids: ['BT1', 'BT2', 'DS23F1000001', 'BT_GONE'],
              distinct_actors: 4,
            }),
          }),
        }),
      );
      renderBoard();

      const card = kpi('Staff active today');
      expect(card.getByText('2')).toBeInTheDocument();
      expect(card.getByText('of 3 accounts')).toBeInTheDocument();
      // Exact, so no "floor" caveat.
      expect(card.queryByText('from recent activity — a floor')).not.toBeInTheDocument();
    });

    it('marks the figure as a floor when it came from recent rows instead', () => {
      useFestSnapshot.mockReturnValue(
        snapshot({ staff: [staffMember('BT1')], audit: feeds({ today: null }) }),
      );
      renderBoard();

      expect(
        kpi('Staff active today').getByText('from recent activity — a floor'),
      ).toBeInTheDocument();
    });
  });
});
