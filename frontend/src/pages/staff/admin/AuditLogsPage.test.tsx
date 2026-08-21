import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AuditLogEntry, AuditLogSummary, Event, Hostel, Mess, Workshop } from '@/api/types';

/**
 * Story 9.3's export half.
 *
 * The trail itself was already here; what was missing was a way to take it out of
 * the browser. These assert the two things an export can get wrong: the wrong
 * *rows* (the page rather than the filtered selection) and the wrong *columns*.
 */

const auditLogs = vi.fn<() => Promise<AuditLogEntry[]>>();
/** Exact fest-wide counts. The headline figures read these, not the fetched page. */
const auditLogSummary = vi.fn<() => Promise<AuditLogSummary>>();
const downloadCsv = vi.fn<(filename: string, csv: string) => void>();

vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    api: {
      auditLogs: () => auditLogs(),
      auditLogSummary: () => auditLogSummary(),
      listEvents: (): Promise<Event[]> => Promise.resolve([]),
      listWorkshops: (): Promise<Workshop[]> => Promise.resolve([]),
      listMess: (): Promise<Mess[]> => Promise.resolve([]),
      listHostels: (): Promise<Hostel[]> => Promise.resolve([]),
    },
  };
});

function summary(over: Partial<AuditLogSummary> = {}): AuditLogSummary {
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

vi.mock('@/lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv')>();
  return {
    ...actual,
    // `toCsv` is left real so the assertions below are about the actual text a
    // spreadsheet would open, not about a call shape.
    downloadCsv: (filename: string, csv: string) => downloadCsv(filename, csv),
  };
});

const { default: AuditLogsPage } = await import('./AuditLogsPage');

function log(over: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    actor_id: 'BT1000000001',
    action: 'MESS_SCAN',
    target_id: 'MESS_A',
    details: { participant_id: 'DS23F1000001', slot: 'breakfast', day: 1 },
    timestamp: '2026-06-10T07:30:00',
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditLogsPage />
    </MemoryRouter>,
  );
}

/** The CSV body as lines, header excluded. */
function exportedRows(): string[] {
  const [, csv] = downloadCsv.mock.calls[0];
  return csv.split('\n').slice(1);
}

describe('AuditLogsPage export', () => {
  beforeEach(() => {
    downloadCsv.mockClear();
    auditLogs.mockResolvedValue([
      log(),
      log({ action: 'HOSTEL_ENTRY', target_id: 'HST_A', timestamp: '2026-06-10T08:00:00' }),
      log({ action: 'HOSTEL_EXIT', target_id: 'HST_A', timestamp: '2026-06-10T09:00:00' }),
    ]);
    // Deliberately far larger than the three rows above: the headline figures must
    // report the fest, and the export must report the rows.
    auditLogSummary.mockResolvedValue(
      summary({
        total: 4820,
        by_action: { MESS_SCAN: 3000, HOSTEL_ENTRY: 900, HOSTEL_EXIT: 800, CREATE_EVENT: 120 },
        distinct_actors: 14,
      }),
    );
  });

  it('exports every recorded action when nothing is filtered', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));

    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv.mock.calls[0][0]).toBe('audit-logs.csv');
    expect(exportedRows()).toHaveLength(3);
  });

  it('names every column a reader needs to identify a row', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));

    const [header] = downloadCsv.mock.calls[0][1].split('\n');
    // `target_id` matters here and not on the per-entity sheet: this export spans
    // every entity, so without it a row cannot be traced back to a place.
    //
    // Names sit beside the ids rather than replacing them: the sheet has to be
    // readable without a second lookup, and an id is still what one row is joined
    // to another system by.
    expect(header).toBe(
      'timestamp,action,kind,domain,summary,actor_name,actor_id,target_name,target_id,' +
        'participant_name,participant_id,details,source',
    );
  });

  it('exports the filtered selection, not just the page on screen', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/Search the trail/), 'HOSTEL_ENTRY');
    await user.click(screen.getByRole('button', { name: /Export CSV/ }));

    const rows = exportedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('HOSTEL_ENTRY');
    expect(rows[0]).not.toContain('MESS_SCAN');
  });

  it('flattens a record\u2019s details onto one line', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /Export CSV/ }));

    // One record must stay one CSV row, or every downstream reader miscounts.
    expect(exportedRows()).toHaveLength(3);
    expect(downloadCsv.mock.calls[0][1]).not.toMatch(/\n\s*\n/);
  });

  it('offers nothing to export when the trail is empty', async () => {
    auditLogs.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByRole('button', { name: /Export CSV/ })).toBeDisabled();
  });

  /**
   * The headline figures describe the fest; the table describes the fetch.
   *
   * "Recorded Actions" used to be `trail.length`, so a trail longer than the
   * 1,000-row fetch reported exactly 1,000 — the most authoritative-looking number
   * on the screen was the one certain to be wrong. The per-domain cards had the
   * same defect. The fixture here holds three rows against a summary describing
   * 4,820, so anything still counting rows fails.
   */
  it('reports fest-wide action totals rather than the size of the fetched page', async () => {
    renderPage();

    const recorded = await screen.findByRole('group', { name: 'Recorded Actions' });
    expect(within(recorded).getByText('4820')).toBeInTheDocument();
    expect(within(recorded).getByText('across the whole fest')).toBeInTheDocument();

    // 900 HOSTEL_ENTRY + 800 HOSTEL_EXIT, from `by_action` rather than the 2 rows
    // of hostel activity the table happens to hold.
    const hostels = screen.getByRole('group', { name: 'Hostels' });
    expect(within(hostels).getByText('1700')).toBeInTheDocument();
  });

  it('falls back to the fetched page when the summary cannot be read', async () => {
    auditLogSummary.mockRejectedValue(new Error('boom'));
    renderPage();

    const recorded = await screen.findByRole('group', { name: 'Recorded Actions' });
    expect(within(recorded).getByText('3')).toBeInTheDocument();
    // No fest-wide claim, because there is no longer anything backing one.
    expect(within(recorded).queryByText('across the whole fest')).not.toBeInTheDocument();
  });

  it('does not offer a trail export while browsing the entity directory', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('radio', { name: 'By entity' }));
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument();
  });
});
