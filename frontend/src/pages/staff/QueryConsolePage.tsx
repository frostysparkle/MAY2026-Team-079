import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Inbox,
  MessagesSquare,
  RefreshCw,
  UserCheck,
  Users,
} from 'lucide-react';
import { ApiClientError } from '@/api';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  SectionHeading,
  Select,
  Spinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { currentStaff } from '@/stores/authStore';
import { QueryThread } from '@/features/queries/QueryThread';
import { useQueryQueue } from '@/features/queries/useQueryQueue';
import {
  ASSIGNABLE_STATUSES,
  categoryLabel,
  countQueries,
  isUnanswered,
  outstandingByCategory,
  statusLabel,
  type QueryStatusFilter,
} from '@/features/queries/queries';
import type { QueryRecord } from '@/api/types';

/**
 * The desk where participants' questions get answered — Stories 6.3 and 6.4.
 *
 * A duty route rather than an admin one, on the same terms as the mess menu desk
 * and the facility-issues console: `GET /queries` admits anybody named on a
 * block's, hall's, event's or workshop's team, and a Super Admin sees the whole
 * fest through this same screen. That is how Story 6.4 is delivered without
 * inventing a POR/POC role — the people already named on those teams *are* the
 * points of contact, and the backend authorises against exactly that.
 *
 * The queue is not filtered here. The server already scoped it, and re-deciding
 * who may see what in the browser would be a second implementation of a rule
 * that only means anything on the server.
 */
export default function QueryConsolePage() {
  const staff = currentStaff();
  const queue = useQueryQueue();
  const [statusFilter, setStatusFilter] = useState<QueryStatusFilter>('outstanding');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const counts = useMemo(() => countQueries(queue.queries), [queue.queries]);
  const byCategory = useMemo(() => outstandingByCategory(queue.queries), [queue.queries]);

  const visible = useMemo(() => {
    if (statusFilter === 'all') return queue.queries;
    if (statusFilter === 'outstanding') return queue.queries.filter((q) => q.status !== 'resolved');
    if (statusFilter === 'unanswered') return queue.queries.filter(isUnanswered);
    return queue.queries.filter((q) => q.status === statusFilter);
  }, [queue.queries, statusFilter]);

  async function act(query: QueryRecord, run: () => Promise<void>) {
    setBusyId(query.query_id);
    setActionError(null);
    try {
      await run();
    } catch (e) {
      setActionError(e instanceof ApiClientError ? e.message : 'Could not update that query.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <FestivalScreen
      title="Queries"
      eyebrow={staff?.designation ?? 'Fest team'}
      subtitle="Questions raised by participants for the blocks, halls, events, and workshops you are on."
      actions={
        <Button variant="secondary" onClick={queue.reload} loading={queue.loading}>
          <RefreshCw size={15} strokeWidth={2.5} /> Refresh
        </Button>
      }
    >
      {actionError && (
        <ResultBanner variant="error" title="Not saved">
          {actionError}
        </ResultBanner>
      )}

      {queue.error ? (
        <ErrorState
          title="Could not load the queue"
          description={queue.error}
          onRetry={queue.reload}
        />
      ) : queue.loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading the query queue" />
        </div>
      ) : queue.queries.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting on you"
          description="Questions raised about the blocks, halls, events, and workshops you are on a team for appear here. An empty queue is a quiet fest, not a broken screen."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={MessagesSquare} label="In your queue" value={counts.total} />
            <StatCard
              icon={Clock}
              label="Outstanding"
              value={counts.outstanding}
              tone="warning"
              footnote={
                counts.unanswered > 0
                  ? `${counts.unanswered} nobody has replied to`
                  : 'Every one has a reply'
              }
            />
            <StatCard icon={Users} label="Claimed" value={counts.assigned} tone="info" />
            <StatCard icon={CheckCircle2} label="Answered" value={counts.resolved} tone="success" />
          </div>

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
                    names={queue.names}
                    showAsker
                    onReply={(body) => queue.reply(query.query_id, body)}
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
                                queue.update(query.query_id, {
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
                                queue.update(query.query_id, {
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
        </>
      )}

      <p className="text-xs leading-relaxed text-muted">
        A query carries the asker&rsquo;s name and house and no phone number — the reply thread is
        how you reach them, and it is what they read back on their own screen. Taking a query keeps
        it in your queue even if you later come off that team&rsquo;s roster.
      </p>
    </FestivalScreen>
  );
}
