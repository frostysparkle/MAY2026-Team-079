import { useCallback, useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { IssueStatus, IssueUpdateRequest, StaffIssue } from '@/api/types';
import { sortForDuty } from './issues';

/**
 * The answering side of Story 5.4: the reports this staff account is responsible
 * for, and the one call that moves them along.
 *
 * No scoping happens here. `GET /issues` already returns exactly what this caller
 * may see — the blocks and halls whose team names them, or the whole fest for a
 * Super Admin — and re-filtering in the browser would either restate the server's
 * rule or quietly disagree with it. A staffer on no team gets `{count: 0}` rather
 * than a 403, so an empty list is a normal state and not an error to render.
 *
 * `names` is a lookup for turning `facility_id` into something printable. Both
 * catalogue reads are optional and are allowed to fail silently: a queue that
 * says `HSTL_07` is still a usable queue, where a queue that refused to load
 * because the hostel list was slow is not.
 *
 * Sorting is `sortForDuty` — unanswered first regardless of age. The API sorts
 * newest first, which is right for the reporter's own list and wrong for a work
 * queue.
 */
export interface DutyIssuesState {
  issues: StaffIssue[];
  /** `facility_id` → the facility's name, when it could be read. */
  names: Record<string, string>;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  reload: () => Promise<void>;
  update: (issueId: string, req: IssueUpdateRequest) => Promise<void>;
}

export function useDutyIssues(): DutyIssuesState {
  const [issues, setIssues] = useState<StaffIssue[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus((current) => (current === 'ready' ? current : 'loading'));
    setError(null);

    try {
      const list = await api.listIssues();

      const [hostels, messHalls] = await Promise.all([
        api.listHostels().catch(() => null),
        api.listMess().catch(() => null),
      ]);

      const lookup: Record<string, string> = {};
      for (const block of hostels ?? []) {
        if (block.hostel_id) lookup[block.hostel_id] = block.name ?? block.hostel_id;
      }
      for (const hall of messHalls ?? []) {
        if (hall.mess_id) lookup[hall.mess_id] = hall.name ?? hall.mess_id;
      }

      setIssues(sortForDuty(list.issues ?? []));
      setNames(lookup);
      setStatus('ready');
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not load reported issues.',
      );
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Send a status, a note, or both, then re-read the queue.
   *
   * Errors are rethrown rather than folded into `error`: the card that made the
   * call shows the failure next to its own note box, and blanking the whole
   * console because one update was refused would lose the rest of the queue.
   */
  const update = useCallback(
    async (issueId: string, req: { status?: IssueStatus; note?: string }) => {
      await api.updateIssue(issueId, req);
      const refreshed = await api.listIssues().catch(() => null);
      if (refreshed) setIssues(sortForDuty(refreshed.issues ?? []));
    },
    [],
  );

  return { issues, names, status, error, reload: load, update };
}
