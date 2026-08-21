import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Phone,
  Send,
  UtensilsCrossed,
} from 'lucide-react';
import { ApiClientError } from '@/api';
import type { IssueStatus, StaffIssue } from '@/api/types';
import { currentStaff, isSuperAdmin } from '@/stores/authStore';
import { telHref } from '@/features/stay/dutyContacts';
import { useDutyIssues } from '@/features/issues/useDutyIssues';
import { IssueTimeline } from '@/features/issues/IssueTimeline';
import {
  categoryLabel,
  countIssues,
  formatIssueTime,
  reporterLine,
  statusLabel,
  statusTone,
} from '@/features/issues/issues';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ResultBanner,
  Select,
  SectionHeading,
  Skeleton,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * The duty console for reported hostel and mess faults — the answering half of
 * Story 5.4.
 *
 * A duty route rather than an admin one, in the same shape as the mess menu desk:
 * `GET /issues` and `PATCH /issues/{issue_id}` admit anybody named on the
 * facility's own `hostel_team` or `mess_team`, so the volunteer who is actually
 * on the block can close the report about the block. A Super Admin sees the whole
 * fest through the same screen, because the endpoint already gives them that and a
 * second screen would drift from this one.
 *
 * No scoping happens here. The endpoint returns exactly what this caller may see,
 * and re-filtering in the browser would either duplicate the server's rule or
 * quietly disagree with it. A staffer on no team gets an empty list rather than an
 * error, which is why the empty state says "nothing is assigned to you" rather
 * than claiming the fest has no problems.
 *
 * Unanswered reports sort to the top regardless of age — `sortForDuty` — because
 * this is a queue, and a resolved report from an hour ago is not more urgent than
 * an open one from yesterday.
 */
export default function FacilityIssuesPage() {
  const staff = currentStaff();
  const { issues, names, status, error, reload, update } = useDutyIssues();
  const [filter, setFilter] = useState<'outstanding' | IssueStatus | 'all'>('outstanding');

  const counts = useMemo(() => countIssues(issues), [issues]);
  const visible = useMemo(() => {
    if (filter === 'all') return issues;
    if (filter === 'outstanding') return issues.filter((i) => i.status !== 'resolved');
    return issues.filter((i) => i.status === filter);
  }, [issues, filter]);

  return (
    <FestivalScreen
      title="Reported issues"
      eyebrow={staff?.designation ?? 'Staff'}
      subtitle={
        isSuperAdmin()
          ? 'Every hostel and mess fault reported across the fest.'
          : 'Faults reported at the blocks and halls you are on the team for.'
      }
      actions={
        <Button variant="secondary" onClick={() => void reload()} disabled={status === 'loading'}>
          Refresh
        </Button>
      }
    >
      {status === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {status === 'error' && (
        <ErrorState
          title="Could not load reported issues"
          description={error ?? undefined}
          onRetry={() => void reload()}
        />
      )}

      {status === 'ready' && (
        <>
          {issues.length === 0 ? (
            <Card>
              <EmptyState
                icon={ClipboardCheck}
                title="Nothing reported to you"
                description={
                  isSuperAdmin()
                    ? 'No hostel or mess faults have been reported anywhere in the fest yet.'
                    : 'Reports reach whoever is named on a block or hall team. Nothing is outstanding for the ones you are on — and if you expected some, ask an admin to check you are on that team.'
                }
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  icon={AlertCircle}
                  label="Open"
                  value={counts.open}
                  tone={counts.open > 0 ? 'warning' : 'brand'}
                  footnote="Nobody has picked these up yet"
                />
                <StatCard
                  icon={Loader2}
                  label="Being worked on"
                  value={counts.in_progress}
                  tone="info"
                  footnote="Somebody is on it"
                />
                <StatCard
                  icon={CheckCircle2}
                  label="Resolved"
                  value={counts.resolved}
                  tone="success"
                  footnote="Closed by the duty team"
                />
              </div>

              <Card className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeading
                    title="Queue"
                    meta={`${visible.length} of ${counts.total} shown`}
                  />
                  <div className="w-full sm:w-56">
                    <Select
                      label="Show"
                      value={filter}
                      options={[
                        { value: 'outstanding', label: 'Still outstanding' },
                        { value: 'open', label: 'Open only' },
                        { value: 'in_progress', label: 'Being worked on' },
                        { value: 'resolved', label: 'Resolved' },
                        { value: 'all', label: 'Everything' },
                      ]}
                      onChange={(e) =>
                        setFilter(e.target.value as 'outstanding' | IssueStatus | 'all')
                      }
                    />
                  </div>
                </div>

                {visible.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="Nothing in this view"
                    description="Change the filter above to see the rest."
                  />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {visible.map((issue) => (
                      <DutyIssueCard
                        key={issue.issue_id}
                        issue={issue}
                        facilityName={names[issue.facility_id] ?? issue.facility_id}
                        onUpdate={update}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </FestivalScreen>
  );
}

/**
 * One report, with the two things a volunteer needs: a way to reach the person
 * who filed it, and a way to say what is happening.
 *
 * The note box and the status buttons are one action, not two. `PATCH` accepts a
 * status, a note, or both, and splitting them into separate controls invites the
 * commonest mistake — marking something resolved and forgetting to say what was
 * done, which is exactly the report the participant then chases.
 */
function DutyIssueCard({
  issue,
  facilityName,
  onUpdate,
}: {
  issue: StaffIssue;
  facilityName: string;
  onUpdate: (issueId: string, req: { status?: IssueStatus; note?: string }) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const phone = issue.reporter.phone?.trim() || null;

  async function send(status?: IssueStatus) {
    setFailure(null);
    const trimmed = note.trim();
    if (!status && !trimmed) {
      setFailure('Write a note, or pick a status.');
      return;
    }
    setBusy(true);
    try {
      await onUpdate(issue.issue_id, {
        ...(status ? { status } : {}),
        ...(trimmed ? { note: trimmed } : {}),
      });
      setNote('');
    } catch (e) {
      setFailure(e instanceof ApiClientError ? e.message : 'Could not update this report.');
    } finally {
      setBusy(false);
    }
  }

  const FacilityIcon = issue.facility_type === 'hostel' ? Building2 : UtensilsCrossed;

  return (
    <li className="rounded-2xl bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{issue.subject}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <FacilityIcon size={12} strokeWidth={2.5} aria-hidden className="shrink-0" />
            {facilityName}
            {issue.room ? ` · room ${issue.room}` : ''} ·{' '}
            {categoryLabel(issue.facility_type, issue.category)} ·{' '}
            <span className="tabular-nums">{formatIssueTime(issue.created_at)}</span>
          </p>
        </div>
        <StatusBadge tone={statusTone(issue.status)}>{statusLabel(issue.status)}</StatusBadge>
      </div>

      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{issue.body}</p>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span>Reported by {reporterLine(issue)}</span>
        {phone && (
          <a
            href={telHref(phone)}
            className="tap inline-flex items-center gap-1 font-semibold text-brand hover:underline"
            aria-label={`Call ${issue.reporter.name ?? issue.reporter.participant_id}`}
          >
            <Phone size={12} strokeWidth={2.5} aria-hidden />
            Call
          </a>
        )}
      </p>

      {issue.updates.length > 0 && (
        <IssueTimeline updates={issue.updates} showAuthor className="mt-3 flex flex-col" />
      )}

      {failure && (
        <ResultBanner variant="error" title="Not updated" className="mt-3">
          {failure}
        </ResultBanner>
      )}

      <div className="mt-3 flex flex-col gap-2">
        <label htmlFor={`note-${issue.issue_id}`} className="sr-only">
          Note for report {issue.issue_id}
        </label>
        <textarea
          id={`note-${issue.issue_id}`}
          rows={2}
          maxLength={2000}
          placeholder="What is happening? The person who reported it reads this."
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setFailure(null);
          }}
          className="w-full rounded-lg border border-input px-3 py-2 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <div className="flex flex-wrap gap-2">
          {issue.status !== 'in_progress' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void send('in_progress')}
              className="gap-1.5"
            >
              <Loader2 size={13} /> Working on it
            </Button>
          )}
          {issue.status !== 'resolved' && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void send('resolved')}
              className="gap-1.5"
            >
              <CheckCircle2 size={13} /> Resolve
            </Button>
          )}
          {issue.status === 'resolved' && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void send('open')}>
              Reopen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || note.trim().length === 0}
            onClick={() => void send()}
            className="gap-1.5"
          >
            <Send size={13} /> Add note only
          </Button>
        </div>
      </div>
    </li>
  );
}
