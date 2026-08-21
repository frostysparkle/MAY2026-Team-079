import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { QueryRecord, StaffIssue } from '@/api/types';
import { SupportPanel } from './SupportPanel';
import type { TierState } from '../useFestSnapshot';

/**
 * Story 9.1's two missing panels.
 *
 * The board's one rule is that a partial total must never look complete, so most
 * of these assert what the panel does when a read fails: a dash and a named
 * failure rather than a confident zero.
 */

const READY: TierState = {
  loading: false,
  updatedAt: new Date('2026-08-20T12:00:00Z'),
  error: null,
};
const FIRST_LOAD: TierState = { loading: true, updatedAt: null, error: null };

function query(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS1',
    participant_name: 'Asha N',
    participant_house: 'Nilgiri',
    category: 'hostel',
    target_id: 'GANGA',
    subject: 'Early check-in?',
    body: '…',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    resolved_at: null,
    ...overrides,
  };
}

function issue(overrides: Partial<StaffIssue> = {}): StaffIssue {
  return {
    issue_id: 'ISS1',
    facility_type: 'hostel',
    facility_id: 'GANGA',
    category: 'water',
    subject: 'No supply',
    body: '…',
    room: '214',
    status: 'open',
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    updates: [],
    reporter: { participant_id: 'DS1', name: 'Asha N', phone: '9000000000', room: '214' },
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof SupportPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SupportPanel queries={[]} issues={[]} tier={READY} {...props} />
    </MemoryRouter>,
  );
}

describe('SupportPanel', () => {
  it('says nothing is waiting when both queues are clear', () => {
    renderPanel();
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('counts open queries and open faults separately', () => {
    renderPanel({
      queries: [query(), query({ query_id: 'B', status: 'resolved' })],
      issues: [issue(), issue({ issue_id: 'ISS2', status: 'in_progress' })],
    });

    const panel = screen.getByRole('region', { name: 'Support' });
    expect(within(panel).getByText('3 waiting')).toBeInTheDocument();
    expect(within(panel).getByText('2 queries · 2 reported faults')).toBeInTheDocument();
  });

  it('surfaces the claimed-and-forgotten query, which a status column cannot', () => {
    renderPanel({
      queries: [query({ status: 'assigned', assigned_to: 'BT1' })],
    });
    // Outstanding is 1 and unanswered is also 1 — somebody holds it and has said
    // nothing.
    const panel = screen.getByRole('region', { name: 'Support' });
    expect(within(panel).getByText('nobody has written back')).toBeInTheDocument();
    expect(within(panel).getByText('1 waiting')).toBeInTheDocument();
  });

  it('does not count a resolved query or a fixed fault as waiting', () => {
    renderPanel({
      queries: [query({ status: 'resolved' })],
      issues: [issue({ status: 'resolved' })],
    });
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('shows a dash and names the failure rather than a confident zero', () => {
    renderPanel({ queries: null, issues: [issue()] });
    const panel = screen.getByRole('region', { name: 'Support' });
    expect(within(panel).getByText('Could not read queries')).toBeInTheDocument();
    expect(within(panel).getByText('Partial')).toBeInTheDocument();
    expect(within(panel).getByText('Queries could not be read')).toBeInTheDocument();
  });

  it('names both failures when neither could be read', () => {
    renderPanel({ queries: null, issues: null });
    expect(screen.getByText('Could not read queries or reported faults')).toBeInTheDocument();
  });

  it('breaks open queries down by area', () => {
    renderPanel({
      queries: [
        query({ query_id: 'A', category: 'hostel' }),
        query({ query_id: 'B', category: 'hostel' }),
        query({ query_id: 'C', category: 'event', target_id: 'EV1' }),
      ],
    });
    expect(screen.getByText('My hostel block')).toBeInTheDocument();
    expect(screen.getByText('An event')).toBeInTheDocument();
  });

  it('names the place a fault was reported against, not just its category', () => {
    renderPanel({ issues: [issue()] });
    expect(screen.getByText('Water · GANGA')).toBeInTheDocument();
  });

  it('leaves resolved faults out of the breakdown', () => {
    renderPanel({ issues: [issue({ status: 'resolved' })] });
    expect(screen.getByText('Nothing reported')).toBeInTheDocument();
  });

  it('hands off to both consoles', () => {
    renderPanel();
    expect(screen.getByRole('link', { name: /Open the query desk/ })).toHaveAttribute(
      'href',
      '/staff/queries',
    );
    expect(screen.getByRole('link', { name: 'issues desk' })).toHaveAttribute(
      'href',
      '/staff/issues',
    );
  });

  it('shows skeletons on the very first load only', () => {
    const { container } = renderPanel({ tier: FIRST_LOAD });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
