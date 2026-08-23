import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BedDouble,
  Building2,
  ClipboardList,
  LifeBuoy,
  MessageSquarePlus,
  Phone,
  Send,
  UtensilsCrossed,
} from 'lucide-react';
import { ApiClientError } from '@/api';
import type { Issue } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { smsHref, telHref, type DutyContact } from '@/features/stay/dutyContacts';
import type { MyIssuesState } from '@/features/issues/useMyIssues';
import { IssueTimeline } from '@/features/issues/IssueTimeline';
import {
  BODY_MAX,
  EMPTY_DRAFT,
  ISSUE_CATEGORIES,
  MAX_OPEN_PER_FACILITY,
  SUBJECT_MAX,
  atReportLimit,
  categoryLabel,
  countIssues,
  draftSmsBody,
  facilityKey,
  findFacility,
  formatIssueTime,
  issueSmsBody,
  latestNote,
  outstandingFor,
  statusLabel,
  statusTone,
  validateDraft,
  type DraftErrors,
  type ReportDraft,
} from '@/features/issues/issues';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  Card,
  DetailPanel,
  EmptyState,
  ErrorState,
  ResultBanner,
  Select,
  Skeleton,
  StatusBadge,
  TextArea,
  TextInput,
} from '@/components/ui';

/**
 * Report a hostel or mess problem — Story 5.4, now the second tab of
 * Help & Support.
 *
 * Lifted whole out of the route it used to own, with `useMyIssues` and every
 * resolver in `features/issues/issues.ts` untouched. Two decisions from the
 * original screen still hold and are still visible:
 *
 * **Only the caller's own facilities are offered.** `POST /issues` refuses a
 * report against a block somebody is not allotted to, so a picker listing every
 * block would be a list of buttons that mostly 403.
 *
 * **The phone hand-off is kept, beside the ticket rather than instead of it.** A
 * ticket is the right way to get a broken desk replaced and the wrong way to
 * handle a gas smell.
 *
 * What is new is the third case. A participant with neither a bed nor a hall used
 * to reach a card that said "nothing to report against yet" and offered one link
 * out of the section — which, on the tab a student picks when something is wrong,
 * reads as the feature being broken. It now says which of the two reasons applies
 * and offers both real ways forward: book a stay, or ask the fest team, who can
 * act on a problem whether or not the reporter holds an allocation.
 */
export function ReportPanel({
  state,
  onAskInstead,
  onFindContacts,
}: {
  state: MyIssuesState;
  /** Switches to the Ask tab — the way through when there is no allocation. */
  onAskInstead: () => void;
  /** Switches to the Contacts tab. */
  onFindContacts: () => void;
}) {
  const { facilities, issues, contacts, status, error, reload, report } = state;

  const [draft, setDraft] = useState<ReportDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [filed, setFiled] = useState<string | null>(null);

  /**
   * Which facility the form is really about.
   *
   * One facility is the common case — a participant who took a bed *and* a hall
   * has two, everybody else has one — so the first is preselected rather than
   * making them state the obvious. Derived rather than written into state by an
   * effect: the facilities arrive asynchronously, so an effect would mean an
   * extra render pass and a frame where a one-facility participant sees "choose
   * one". `draft.facilityKey` stays the record of an explicit choice, and this is
   * that choice reconciled against what is actually available.
   */
  const activeKey = useMemo(() => {
    if (findFacility(facilities, draft.facilityKey)) return draft.facilityKey;
    return facilities.length > 0 ? facilityKey(facilities[0]) : '';
  }, [facilities, draft.facilityKey]);

  /** The draft as it would be submitted, with the resolved facility in place. */
  const effective = useMemo<ReportDraft>(
    () => ({ ...draft, facilityKey: activeKey }),
    [draft, activeKey],
  );

  const facility = findFacility(facilities, activeKey);
  const categories = facility ? ISSUE_CATEGORIES[facility.type] : [];
  const chosenCategory = categories.find((c) => c.value === draft.category) ?? null;
  const outstanding = facility ? outstandingFor(issues, facility) : 0;
  const blocked = facility ? atReportLimit(issues, facility) : false;
  const reachable = facility ? (contacts[activeKey] ?? []).filter((c) => c.phone !== null) : [];
  const counts = useMemo(() => countIssues(issues), [issues]);

  function set<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    // Clear only the field being corrected, so the other messages stay put
    // rather than flickering away as soon as any key is pressed.
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setFiled(null);

    const found = validateDraft(effective, facilities);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const issueId = await report(effective);
      setFiled(issueId);
      // Keep the facility so a second report about the same place needs no
      // reselection; clear everything that described the first problem.
      setDraft({ ...EMPTY_DRAFT, facilityKey: activeKey });
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not file your report.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <ErrorState
        title="Reports unavailable"
        description={error ?? undefined}
        onRetry={() => void reload()}
      />
    );
  }

  return (
    <>
      {filed && (
        <ResultBanner variant="success" title="Report filed">
          Your reference is <span className="font-semibold tabular-nums">{filed}</span>. The team on
          duty can see it now, and anything they say about it appears under Your reports below.
        </ResultBanner>
      )}

      {submitError && (
        <ResultBanner variant="error" title="Could not file your report">
          {submitError}
        </ResultBanner>
      )}

      {facilities.length === 0 ? (
        <Card className="flex flex-col gap-4">
          <EmptyState
            icon={LifeBuoy}
            title="Nothing to report against yet"
            description="A maintenance report goes to the duty team of the block or hall you are placed in, so there has to be one. That is the server's rule, not this screen's — and it is the only thing missing here."
          />
          {/* Three ways on, in the order they are likely to apply, rather than
              the single link out of the section this used to offer.

              `WayOut` rather than three copies of the same block: they were
              `Card`s nested inside this `Card`, which meant each carried the outer
              card's shadow and ring over the outer card's own surface — a raised
              white box on a raised white box. They are tinted panels now, which is
              what every other nested block in the participant area is. */}
          <div className="flex flex-col gap-3">
            <WayOut
              title="Have a problem right now?"
              body="Ask the fest team instead. A question reaches the core team whether or not you hold an allocation, and they can put a fault in front of the right people."
              action={
                <Button onClick={onAskInstead}>
                  <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Ask the fest team
                </Button>
              }
            />
            <WayOut
              title="Booked a bed or a mess hall?"
              body="Once your accommodation or mess allocation lands, this form opens on its own."
              action={
                <Link to={ROUTES.accommodation}>
                  <Button variant="secondary">
                    <BedDouble size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Manage my
                    stay
                  </Button>
                </Link>
              }
            />
            <WayOut
              title="Need somebody on the phone?"
              body="The coordinators on duty across every block and hall are one tab away."
              action={
                <Button variant="secondary" onClick={onFindContacts}>
                  <Phone size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Who to call
                </Button>
              }
            />
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          {/* Both halves are `DetailPanel`s now — they were `Card` + `SectionHeading`,
              which is the shared panel minus its `sm:p-5` step. */}
          <DetailPanel title="New report">
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              {facilities.length > 1 ? (
                <Select
                  label="Where is the problem?"
                  required
                  value={activeKey}
                  error={errors.facilityKey}
                  options={facilities.map((f) => ({
                    value: facilityKey(f),
                    label: f.type === 'hostel' ? `${f.name} (block)` : `${f.name} (mess)`,
                  }))}
                  onChange={(e) => {
                    // A hostel category is not a mess category, so a stale one
                    // would be refused by the backend. Clear it.
                    setDraft((current) => ({
                      ...current,
                      facilityKey: e.target.value,
                      category: '',
                    }));
                    setErrors({});
                  }}
                />
              ) : (
                facility && (
                  <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3.5 py-3">
                    {facility.type === 'hostel' ? (
                      <Building2 size={16} strokeWidth={2.5} aria-hidden className="text-brand" />
                    ) : (
                      <UtensilsCrossed
                        size={16}
                        strokeWidth={2.5}
                        aria-hidden
                        className="text-brand"
                      />
                    )}
                    <span className="text-sm text-muted">
                      Reporting about{' '}
                      <span className="font-semibold text-ink">{facility.name}</span>
                      {facility.room && (
                        <>
                          , room <span className="font-semibold text-ink">{facility.room}</span>
                        </>
                      )}
                    </span>
                  </div>
                )
              )}

              <Select
                label="What kind of problem?"
                required
                value={draft.category}
                error={errors.category}
                hint={chosenCategory?.hint}
                placeholder="Choose one"
                options={categories.map((c) => ({ value: c.value, label: c.label }))}
                onChange={(e) => set('category', e.target.value)}
              />

              <TextInput
                label="Short title"
                required
                maxLength={SUBJECT_MAX}
                placeholder="No hot water on the second floor"
                value={draft.subject}
                error={errors.subject}
                onChange={(e) => set('subject', e.target.value)}
              />

              {/* The shared `TextArea` — this was hand-rolled with template-string
                  class interpolation where the `TextInput`s around it use `cn`, and
                  without the `resize-y` its counterpart on the Ask tab had. */}
              <TextArea
                id="issue-body"
                label="What is wrong?"
                required
                maxLength={BODY_MAX}
                placeholder="Since when, which room or counter, and anything the team should bring with them."
                value={draft.body}
                error={errors.body}
                hint={`${draft.body.trim().length} of ${BODY_MAX} characters. The more specific, the faster it gets fixed.`}
                onChange={(e) => set('body', e.target.value)}
              />

              <TextInput
                label="Room or place"
                hint={
                  facility?.type === 'mess'
                    ? 'Optional — which counter or which sitting, if it matters.'
                    : facility?.room
                      ? `Optional. Left blank, this goes down as room ${facility.room}.`
                      : 'Optional — where in the block this is.'
                }
                placeholder={facility?.room ?? 'Common bathroom, 2nd floor'}
                value={draft.room}
                onChange={(e) => set('room', e.target.value)}
              />

              {blocked && (
                <ResultBanner variant="warning" title="You have reached the limit here">
                  You already have {MAX_OPEN_PER_FACILITY} unresolved reports for {facility?.name}.
                  The team has to close one before you can file another — this is the server&apos;s
                  rule, not this screen&apos;s.
                </ResultBanner>
              )}

              {/* At the cap the form is dead, so it says what to do instead of
                  just refusing. */}
              {blocked ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled>
                    <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> File this report
                  </Button>
                  <Button type="button" variant="secondary" onClick={onAskInstead}>
                    <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Ask the fest
                    team instead
                  </Button>
                </div>
              ) : (
                <Button type="submit" disabled={submitting}>
                  <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} />{' '}
                  {submitting ? 'Filing…' : 'File this report'}
                </Button>
              )}

              {!blocked && outstanding > 0 && facility && (
                <p className="text-xs text-muted">
                  You have {outstanding} unresolved {outstanding === 1 ? 'report' : 'reports'} for{' '}
                  {facility.name}, out of {MAX_OPEN_PER_FACILITY} allowed at a time.
                </p>
              )}
            </form>

            {reachable.length > 0 && facility && (
              <div className="rounded-2xl bg-warning-bg p-3.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <AlertTriangle size={15} strokeWidth={2.5} aria-hidden />
                  Urgent, or a safety risk?
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink">
                  A report reaches the team the next time they open their board. For anything that
                  cannot wait, call the people on duty at {facility.name} — the details you typed
                  above travel with the message.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {reachable.map((contact) => (
                    <li key={`${contact.name}-${contact.phone}`} className="flex gap-1.5">
                      <a
                        href={telHref(contact.phone as string)}
                        className="tap inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-brand shadow-card"
                      >
                        <Phone size={12} strokeWidth={2.5} aria-hidden />
                        {contact.name}
                      </a>
                      <a
                        href={smsHref(contact.phone as string, draftSmsBody(effective, facility))}
                        className="tap inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-card"
                        aria-label={`Text this report to ${contact.name}`}
                      >
                        <MessageSquarePlus size={12} strokeWidth={2.5} aria-hidden />
                        Text
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </DetailPanel>

          <DetailPanel
            title="Your reports"
            meta={
              counts.total > 0
                ? `${counts.outstanding} open · ${counts.resolved} resolved`
                : undefined
            }
          >
            {issues.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="You have not reported anything"
                description="Anything you file appears here with whatever the team says about it. The form beside this one is where it starts."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {issues.map((issue) => (
                  <MyIssueCard
                    key={issue.issue_id}
                    issue={issue}
                    facilityName={
                      facilities.find(
                        (f) => f.type === issue.facility_type && f.id === issue.facility_id,
                      )?.name ?? issue.facility_id
                    }
                    contacts={contacts[`${issue.facility_type}:${issue.facility_id}`] ?? []}
                  />
                ))}
              </ul>
            )}
          </DetailPanel>
        </div>
      )}
    </>
  );
}

/**
 * One of the three routes out of a report form that cannot be used yet: a line
 * saying which case applies, and the control that acts on it.
 *
 * A tinted `bg-surface-2` block on the same 20px radius and 16px padding as every
 * other nested block in the participant area — the meal-preference field on Stay,
 * the fee breakdown on the picker, the duty-contacts list. Three inline copies of
 * this markup is how the middle one ends up a step out of line with the other two.
 */
function WayOut({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * One of the participant's own reports.
 *
 * Collapsed by default down to the status, the title, and the last thing the team
 * actually *said* — `latestNote` rather than `latestUpdate`, because a bare
 * "Resolved" with nothing under it is not an answer to somebody waiting for one.
 * The full timeline is one click away rather than always open, so a list of six
 * reports stays a list.
 */
function MyIssueCard({
  issue,
  facilityName,
  contacts,
}: {
  issue: Issue;
  facilityName: string;
  contacts: readonly DutyContact[];
}) {
  const [open, setOpen] = useState(false);
  const note = latestNote(issue);
  // Chasing a report is a real thing people do, and the reference number is the
  // one detail that makes it answerable — so the message carries it rather than
  // making somebody read it off the screen and retype it.
  const chase = contacts.find((c) => c.phone !== null) ?? null;

  return (
    <li className="rounded-2xl bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{issue.subject}</p>
          <p className="mt-0.5 text-xs text-muted">
            {facilityName}
            {issue.room ? ` · room ${issue.room}` : ''} ·{' '}
            {categoryLabel(issue.facility_type, issue.category)} · filed{' '}
            {formatIssueTime(issue.created_at)}
          </p>
        </div>
        <StatusBadge tone={statusTone(issue.status)}>{statusLabel(issue.status)}</StatusBadge>
      </div>

      {note && !open && (
        <p className="mt-2 border-l-2 border-line pl-2.5 text-sm leading-relaxed text-ink">
          {note.note}
        </p>
      )}

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{issue.body}</p>
          {issue.updates.length > 0 ? (
            <IssueTimeline updates={issue.updates} className="mt-1 flex flex-col" />
          ) : (
            <p className="text-xs italic text-muted">
              Nobody has picked this up yet. Reference {issue.issue_id}.
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="tap text-xs font-semibold text-brand hover:underline"
        >
          {open
            ? 'Hide details'
            : issue.updates.length > 0
              ? `Show all ${issue.updates.length} ${issue.updates.length === 1 ? 'update' : 'updates'}`
              : 'Show details'}
        </button>

        {chase && issue.status !== 'resolved' && (
          <a
            href={smsHref(chase.phone as string, issueSmsBody(issue, facilityName))}
            className="tap inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink hover:underline"
            aria-label={`Text ${chase.name} about report ${issue.issue_id}`}
          >
            <MessageSquarePlus size={12} strokeWidth={2.5} aria-hidden />
            Chase it up
          </a>
        )}
      </div>
    </li>
  );
}
