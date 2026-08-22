import { useMemo, useState } from 'react';
import { CheckCircle2, Inbox, UserCheck } from 'lucide-react';
import { reportApiError } from '@/api/report';
import type { QueryRecord } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionHeading,
  Select,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { currentStaff } from '@/stores/authStore';
import { QueryThread } from '@/features/queries/QueryThread';
import type { QueryQueueState } from '@/features/queries/useQueryQueue';
import {
  ASSIGNABLE_STATUSES,
  categoryLabel,
  countQueries,
  isUnanswered,
  outstandingByCategory,
  statusLabel,
  type QueryStatusFilter,
} from '@/features/queries/queries';

/**
 * The Questions tab of the staff Support desk — Stories 6.3 and 6.4.
 *
 * This was `QueryConsolePage`, and it is a move rather than a rewrite:
 * `useQueryQueue`, `QueryThread` and `features/queries/queries.ts` are all
 * untouched, and every rule about who may answer what still lives on the server.
 *
 * Two things changed on the way in. The queue is loaded by the section rather
 * than by this panel, because the figures above the tabs count it together with
 * the faults queue and a second copy of the hook would mean a second fetch and a
 * second answer. And the panel's own four `StatCard`s are gone: `Outstanding` and
 * `Answered` are in that shared row now, and `In your queue` and `Claimed`
 * already appear as counts on the Show selector below, so nothing was dropped —
 * only stopped being said twice on one screen.
 *
 * The queue is still not filtered here. The server already scoped it, and
 * re-deciding who may see what in the browser would be a second implementation of
 * a rule that only means anything on the server.
 */
export function QuestionsPanel({ state }: { state: QueryQueueState }) {
  const staff = currentStaff();
  const [statusFilter, setStatusFilter] = useState<QueryStatusFilter>('outstanding');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const counts = useMemo(() => countQueries(state.queries), [state.queries]);
  const byCategory = useMemo(() => outstandingByCategory(state.queries), [state.queries]);

  const visible = useMemo(() => {
    if (statusFilter === 'all') return state.queries;
    if (statusFilter === 'outstanding') return state.queries.filter((q) => q.status !== 'resolved');
    if (statusFilter === 'unanswered') return state.queries.filter(isUnanswered);
    return state.queries.filter((q) => q.status === statusFilter);
  }, [state.queries, statusFilter]);

  async function act(query: QueryRecord, run: () => Promise<void>) {
    setBusyId(query.query_id);
    setActionError(null);
    try {
      await run();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not update that query.'));
    } finally {
      setBusyId(null);
    }
  }

  if (state.error) {
    return (
      <ErrorState
        title="Could not load the queue"
        description={state.error}
        onRetry={state.reload}
      />
    );
  }

  if (state.loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner label="Loading the query queue" />
      </div>
    );
  }

  if (state.queries.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing waiting on you"
        description="Questions raised about the blocks, halls, events, and workshops you are on a team for appear here. An empty queue is a quiet fest, not a broken screen."
      />
    );
  }

  return (
    <>
      {actionError && (
        <ResultBanner variant="error" title="Not saved">
          {actionError}
        </ResultBanner>
      )}

      {Object.keys(byCategory).length > 0 && (
        <Card className="flex flex-col gap-3">
          <SectionHeading title="Outstanding by area" meta={`${counts.outstanding} open`} />
          <ul className="flex flex-wrap gap-2">
            {Object.entries(byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => (
                <li key={category}>
                  <StatusBadge tone="warning">
                    {categoryLabel(category)} · {count}
                  </StatusBadge>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card>
        <Select
          label="Show"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QueryStatusFilter)}
          hint="Filtered on this device — the server already decided which queries are yours."
          options={[
            { value: 'outstanding', label: `Still open (${counts.outstanding})` },
            { value: 'unanswered', label: `No reply yet (${counts.unanswered})` },
            { value: 'open', label: `Unclaimed (${counts.open})` },
            { value: 'assigned', label: `Claimed (${counts.assigned})` },
            { value: 'resolved', label: `Answered (${counts.resolved})` },
            { value: 'all', label: `Everything (${counts.total})` },
          ]}
        />
      </Card>

      {visible.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing under that filter"
          description="Switch the filter above to see the rest of your queue."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((query) => {
            const busy = busyId === query.query_id;
            const mine = staff?.id && query.assigned_to === staff.id;

            return (
              <QueryThread
                key={query.query_id}
                query={query}
                names={state.names}
                showAsker
                onReply={(body) => state.reply(query.query_id, body)}
                replyPlaceholder="Answer the participant…"
                actions={
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-40">
                      <Select
                        label="Status"
                        value={query.status}
                        disabled={busy}
                        onChange={(e) =>
                          void act(query, () =>
                            state.update(query.query_id, {
                              status: e.target.value as QueryRecord['status'],
                            }),
                          )
                        }
                        options={ASSIGNABLE_STATUSES.map((status) => ({
                          value: status,
                          label: statusLabel(status),
                        }))}
                      />
                    </div>

                    {!mine && (
                      <Button
                        variant="secondary"
                        loading={busy}
                        onClick={() =>
                          void act(query, () =>
                            state.update(query.query_id, {
                              assigned_to: staff?.id ?? '',
                              // A label for the humans reading the thread. The
                              // routing is already decided by the query's own
                              // category and target, so this grants nothing.
                              assigned_team: staff?.designation ?? 'Fest team',
                            }),
                          )
                        }
                      >
                        <UserCheck size={15} strokeWidth={2.5} /> Take this one
                      </Button>
                    )}

                    {mine && (
                      <StatusBadge tone="info">
                        <UserCheck size={12} strokeWidth={2.5} className="mr-1" /> Yours
                      </StatusBadge>
                    )}
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        A query carries the asker&rsquo;s name and house and no phone number — the reply thread is
        how you reach them, and it is what they read back on their own screen. Taking a query keeps
        it in your queue even if you later come off that team&rsquo;s roster.
      </p>
    </>
  );
}
