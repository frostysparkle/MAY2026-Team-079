import { useMemo, useState } from 'react';
import {
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
import { isSuperAdmin } from '@/stores/authStore';
import { telHref } from '@/features/stay/dutyContacts';
import type { DutyIssuesState } from '@/features/issues/useDutyIssues';
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
  StatusBadge,
} from '@/components/ui';

/**
 * The Faults tab of the staff Support desk — the answering half of Story 5.4.
 *
 * This was `FacilityIssuesPage`, and it is a move rather than a rewrite:
 * `useDutyIssues`, `IssueTimeline` and `features/issues/issues.ts` are untouched,
 * and `GET /issues` / `PATCH /issues/{issue_id}` still admit exactly whoever is
 * named on the facility's own `hostel_team` or `mess_team`, with a Super Admin
 * seeing the fest.
 *
 * The queue is loaded by the section rather than by this panel, so the figures
 * above the tabs can count it together with the questions queue. The panel's own
 * three `StatCard`s are gone with nothing lost: open and resolved are in that
 * shared row, and `Being worked on` moved onto the Show selector, which now
 * carries a count per option the way the Questions tab's always did.
 *
 * No scoping happens here either. The endpoint returns exactly what this caller
 * may see, and re-filtering in the browser would either duplicate the server's
 * rule or quietly disagree with it. A staffer on no team gets an empty list rather
 * than an error, which is why the empty state says nothing is assigned to them
 * rather than claiming the fest has no problems.
 *
 * Unanswered reports sort to the top regardless of age — `sortForDuty`, applied in
 * the hook — because this is a queue, and a resolved report from an hour ago is
 * not more urgent than an open one from yesterday.
 */
export function FaultsPanel({ state }: { state: DutyIssuesState }) {
  const { issues, names, status, error, reload, update } = state;
  const [filter, setFilter] = useState<'outstanding' | IssueStatus | 'all'>('outstanding');

  const counts = useMemo(() => countIssues(issues), [issues]);
  const visible = useMemo(() => {
    if (filter === 'all') return issues;
    if (filter === 'outstanding') return issues.filter((i) => i.status !== 'resolved');
    return issues.filter((i) => i.status === filter);
  }, [issues, filter]);

  if (status === 'loading') {
    return (
      <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Could not load reported issues"
        description={error ?? undefined}
        onRetry={() => void reload()}
      />
    );
  }

  if (issues.length === 0) {
    return (
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
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading title="Queue" meta={`${visible.length} of ${counts.total} shown`} />
        <div className="w-full sm:w-56">
          <Select
            label="Show"
            value={filter}
            hint="Filtered on this device — the server already decided which reports are yours."
            options={[
              { value: 'outstanding', label: `Still outstanding (${counts.outstanding})` },
              { value: 'open', label: `Open only (${counts.open})` },
              { value: 'in_progress', label: `Being worked on (${counts.in_progress})` },
              { value: 'resolved', label: `Resolved (${counts.resolved})` },
              { value: 'all', label: `Everything (${counts.total})` },
            ]}
            onChange={(e) => setFilter(e.target.value as 'outstanding' | IssueStatus | 'all')}
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
 *
 * The phone number and the Call link are the deliberate difference between this
 * card and a `QueryThread`, and the reason the two tabs do not share one row
 * component. `GET /issues` returns the reporter's number because a duty team that
 * cannot ring somebody back cannot fix a burst pipe; `GET /queries` refuses to,
 * because a block's team cannot read `/hostels/{id}/statistics` and a query row
 * must not become the back door to contact details. Folding these into one row
 * would flatten that distinction by accident.
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
