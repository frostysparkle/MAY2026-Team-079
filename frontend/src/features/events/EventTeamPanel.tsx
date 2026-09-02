import { useEffect, useState } from 'react';
import { Crown, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { BackendTeamMember, EventTeamMember } from '@/api/types';
import {
  Button,
  Card,
  ConfirmDialog,
  ResultBanner,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  EVENT_TEAM_ROLES,
  EVENT_VOLUNTEER_ROLE,
  departmentForEvent,
  eventTeamRoleLabel,
  isEventHeadRole,
  type EventTeamRole,
} from './eventTeam';

/**
 * An event's staff: who runs it, who works the gate, and — crucially — who holds
 * the Event Head role.
 *
 * This panel is the only way in the app to populate `event_team`, and that array
 * is what three other screens read to decide what to offer:
 *
 *   - `EventTeamsPage` gates team allocation and participant-team edits on
 *     `role === "event_head"`, matching the backend.
 *   - `EventScannerPage` admits any member of `event_team` to the scanner.
 *   - `EventRegistrationForm` refuses to let a member register as a participant
 *     for their own event, because the backend does.
 *
 * Assignment is Super Admin work — `POST /events/{id}/team` answers everybody
 * else with `403 "Only Super Admins can assign event teams"` — so `canManage`
 * drives whether the write controls render at all.
 *
 * Two API shapes worth knowing:
 *
 *   - The backend `$push`es without checking for an existing entry, so assigning
 *     the same person twice creates a duplicate member. The picker therefore
 *     excludes anybody already on the team, and `assign()` refuses a duplicate id
 *     before it reaches the network.
 *   - Events have no per-member scanning switch — every team member can scan
 *     attendance from the moment they are assigned, and that cannot be revoked
 *     independently of the role itself. `PATCH .../team/{user_id}` changes a
 *     member's role and `DELETE .../team/{user_id}` removes them outright, both
 *     of which this panel now offers alongside assignment.
 *
 * One dropdown, not two fields. Staffing somebody used to ask for a role on the
 * event *and* a free-text "Designation on record" for their staff account, the
 * second pre-filled from the first. The scopes really do differ — `event_team[].role`
 * is per-event and enforced by the backend, `backend_teams.designation` is one
 * unenforced display string per account — but this panel only ever creates an
 * account for this event, so the two always agreed and the labels read as
 * synonyms. The role now supplies both, and `EditStaffForm` under Staff is where a
 * designation gets a title broader than one event's role.
 */
export function EventTeamPanel({
  eventId,
  team,
  eventType,
  canManage,
  onChanged,
}: {
  eventId: string;
  /**
   * `undefined` while the event is still loading. Members carry a name and phone
   * when the list came from `GET /events/{id}/participation`, and not when it
   * came from `event_team` on the `GET /events` record — which is only
   * `{ user_id, role }`.
   */
  team: EventTeamMember[] | undefined;
  /** The event's `event_type`, used to pick a valid `department` for new staff accounts. */
  eventType?: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [staffAccounts, setStaffAccounts] = useState<BackendTeamMember[] | null>(null);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<EventTeamRole>(EVENT_VOLUNTEER_ROLE);
  /** `existing` picks somebody out of the staff directory; `new` creates them. */
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Whose role is being re-picked inline, or `null` when nobody's is. */
  const [reroling, setReroling] = useState<string | null>(null);
  const [reroleValue, setReroleValue] = useState<EventTeamRole>(EVENT_VOLUNTEER_ROLE);
  const [pendingRemove, setPendingRemove] = useState<EventTeamMember | null>(null);

  // The staff directory turns "type a BT id" into "pick a person". Super
  // Admin-only, like this panel's write side, and never blocking: a failed fetch
  // falls back to the free-text field below.
  useEffect(() => {
    if (!canManage) return;
    api
      .listBackendTeams()
      .then(setStaffAccounts)
      .catch(() => setStaffAccounts([]));
  }, [canManage]);

  const members = team ?? [];
  const headCount = members.filter((member) => isEventHeadRole(member.role)).length;

  /** Runs one write, reports it, and refreshes the record. `true` on success. */
  async function run(
    action: () => Promise<unknown>,
    failure: string,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function assign() {
    const id = userId.trim();
    if (!id) return;
    // The backend pushes blind, so a second assignment of the same person would
    // silently duplicate them on the team. Caught here because no status code
    // comes back to react to.
    if (members.some((member) => member.user_id === id)) {
      setNotice(null);
      setError(`${id} is already on this event's team. Assign somebody else.`);
      return;
    }
    const ok = await run(
      () => api.assignEventTeam(eventId, { user_id: id, role }),
      'Could not assign this member.',
      `${id} assigned as ${eventTeamRoleLabel(role)}`,
    );
    // The field is cleared only once the assignment landed, so a failed attempt
    // can be retried without retyping the id.
    if (ok) setUserId('');
  }

  async function saveRerole(member: EventTeamMember) {
    const ok = await run(
      () => api.updateEventTeamRole(eventId, member.user_id, { role: reroleValue }),
      'Could not update this member’s role.',
      `${member.name || member.user_id} is now ${eventTeamRoleLabel(reroleValue)}`,
    );
    if (ok) setReroling(null);
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    const ok = await run(
      () => api.removeEventTeamMember(eventId, pendingRemove.user_id),
      'Could not remove this member.',
      `${pendingRemove.name || pendingRemove.user_id} removed from this event's team`,
    );
    if (ok) setPendingRemove(null);
  }

  /**
   * Create a staff login and put it on this event in one go — two calls, because
   * that is how the API is shaped: `POST /backend_teams` mints the account and
   * hands back its `paradox_id`, and `POST /events/{id}/team` is what actually
   * grants the event.
   *
   * If the second call fails the first has still happened, so the error names the
   * new id rather than pretending nothing occurred: the account exists and can be
   * attached from the picker without being created twice.
   */
  async function createAndAssign() {
    const label = eventTeamRoleLabel(role);
    setBusy(true);
    setError(null);
    setNotice(null);

    let newId: string | null = null;
    try {
      const created = await api.createBackendTeam({
        email: email.trim(),
        password,
        // `backend_teams.role` is the account's fest-wide role, a separate
        // vocabulary from the per-event role chosen in the dropdown. "other" is
        // the non-privileged value an event staffer needs: "volunteer" would
        // have the backend demand a registered participant with this email
        // (`POST /backend_teams` 400s otherwise) — event staff usually have no
        // participant record — and "super_admin"/"admin" would hand out far
        // more than this panel is for. An Event Head's authority comes from
        // being named on `event_team`, not from the account's role; this is
        // also exactly what `seed_staff.py` uses for its event members.
        role: 'other',
        // `POST /backend_teams` validates `department` against the closed set in
        // `models.BACKEND_TEAM_DEPARTMENTS`, and "events" is not one of the seven
        // allowed values — so every "Create and assign" from this panel failed
        // with `422 Input should be 'technical', 'sports', …` and no event head
        // or volunteer could ever be created. Use the event's own category (the
        // participation route compares a staff account's department directly
        // against `event.event_type`, and the paradox_id prefix encodes it),
        // falling back to "technical" for "others" events, which have no matching
        // department. Mirrors `WorkshopTeamPanel`, which posts "workshops".
        department: departmentForEvent(eventType),
        // Derived from the role dropdown rather than collected separately. This
        // used to be a free-text "Designation on record" box sitting directly
        // under that dropdown, pre-filled with this same label — two fields whose
        // values matched in every ordinary case, and whose names read as synonyms.
        //
        // The two are genuinely different in scope: `role` above is per-event and
        // the backend enforces it, while `designation` is one string on the account
        // that nothing checks, shown in the staff directory, on the staffer's own
        // dashboard, beside announcements they post, and as the audit trail's name
        // fallback. But that difference never justified a second input here, since
        // this panel only ever creates an account *for this event*. A designation
        // that should say something broader — "Technicals Core", or the right title
        // for somebody who works several events — is an edit to the account, and
        // `EditStaffForm` under Staff already does that through
        // `PUT /backend_teams/{paradox_id}`.
        designation: label,
      });
      newId = created.paradox_id;
      await api.assignEventTeam(eventId, { user_id: created.paradox_id, role });
      setNotice(`${email.trim()} created as ${label} (${created.paradox_id})`);
      setEmail('');
      setPassword('');
      // Refresh the directory too, so the new account shows in the picker.
      api
        .listBackendTeams()
        .then(setStaffAccounts)
        .catch(() => undefined);
      onChanged();
    } catch (e) {
      const detail = e instanceof ApiClientError ? e.message : 'Could not create the account.';
      setError(
        newId
          ? `Account ${newId} was created but could not be assigned to this event: ${detail}`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  }

  const assignable = (staffAccounts ?? []).filter(
    (account) => !members.some((member) => member.user_id === account.paradox_id),
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Event team"
        meta={team === undefined ? undefined : `${members.length} assigned`}
      />

      {error && (
        <ResultBanner variant="error" title="Action failed">
          {error}
        </ResultBanner>
      )}
      {notice && <ResultBanner variant="success" title={notice} />}

      {/* An event with no head is the failure this panel exists to prevent:
          nobody can allocate teams, and a Super Admin cannot do it for them. */}
      {team !== undefined && members.length > 0 && headCount === 0 && (
        <ResultBanner variant="warning" title="This event has no Event Head">
          Team allocation and participant-team edits are restricted to an Event Head, and a Super
          Admin cannot run them instead. Assign one below.
        </ResultBanner>
      )}

      {team === undefined ? (
        <Card>
          <p className="text-sm text-muted">Loading this event’s team…</p>
        </Card>
      ) : members.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nobody is assigned yet. An event needs an Event Head before teams can be allocated, and
            at least one team member before anybody can scan attendance at the gate.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={`${member.user_id}-${member.role}`}>
              <Card className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    isEventHeadRole(member.role)
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-surface-2 text-muted',
                  )}
                >
                  {isEventHeadRole(member.role) ? (
                    <Crown size={16} strokeWidth={2.25} />
                  ) : (
                    <Users size={16} strokeWidth={2.25} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {member.name || member.user_id}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[member.name ? member.user_id : null, member.phone]
                      .filter(Boolean)
                      .join(' · ') || 'No contact details on this record'}
                  </p>
                </div>

                {canManage && reroling === member.user_id ? (
                  <div className="flex items-center gap-2">
                    <Select
                      label="Role"
                      className="sr-only"
                      value={reroleValue}
                      onChange={(e) => setReroleValue(e.target.value as EventTeamRole)}
                      options={EVENT_TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy}
                      onClick={() => void saveRerole(member)}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setReroling(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <StatusBadge tone={isEventHeadRole(member.role) ? 'info' : 'neutral'}>
                      {eventTeamRoleLabel(member.role)}
                    </StatusBadge>
                    {canManage && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setReroling(member.user_id);
                            setReroleValue(member.role as EventTeamRole);
                          }}
                        >
                          Change role
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger-bg"
                          aria-label={`Remove ${member.name || member.user_id} from this event's team`}
                          onClick={() => setPendingRemove(member)}
                        >
                          <Trash2 size={14} strokeWidth={2.25} />
                        </Button>
                      </>
                    )}
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title={`Remove ${pendingRemove?.name || pendingRemove?.user_id} from this event's team?`}
        description="They will lose the scanner and roster access this event's team grants, and can be assigned to a different event afterwards."
        confirmLabel="Remove"
        loading={busy}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />

      {canManage && (
        <Card className="flex flex-col gap-3">
          {/* Staffing an event is either "somebody who already has a login" or
              "somebody who does not yet" — the second is a new account plus an
              assignment, and doing it here rather than sending the admin to the
              Staff screen and back is the whole point of the panel. */}
          <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
            {(
              [
                { key: 'existing', label: 'Assign existing staff' },
                { key: 'new', label: 'Create new staff' },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setMode(option.key);
                  setError(null);
                  setNotice(null);
                }}
                aria-pressed={mode === option.key}
                className={cn(
                  'tap flex-1 rounded-lg py-2 text-sm font-semibold',
                  mode === option.key ? 'bg-surface text-brand shadow-card' : 'text-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* The one field that decides both what this person may do on the event
              and how they are labelled on their staff record — see
              `createAndAssign`. It sits above the mode-specific fields because it
              applies to both: assigning an existing account and creating a new one
              each need a role on this event. */}
          <Select
            label="Role on this event"
            value={role}
            onChange={(e) => setRole(e.target.value as EventTeamRole)}
            options={EVENT_TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))}
            hint={EVENT_TEAM_ROLES.find((r) => r.value === role)?.blurb}
          />

          {mode === 'existing' ? (
            <>
              {assignable.length > 0 ? (
                <Select
                  label="Staff account"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="Choose a staff account"
                  options={assignable.map((account) => ({
                    value: account.paradox_id,
                    label: `${account.email} · ${account.designation || account.role || 'staff'}`,
                  }))}
                />
              ) : (
                <TextInput
                  label="Staff ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="e.g. BT1000000003"
                  hint={
                    staffAccounts === null
                      ? 'The paradox_id of an account created under Staff.'
                      : 'Every staff account is already on this team — create a new one, or use the Staff screen.'
                  }
                />
              )}

              <Button
                type="button"
                size="sm"
                className="w-fit"
                loading={busy}
                disabled={busy || !userId.trim()}
                onClick={() => void assign()}
              >
                <UserPlus size={14} /> Assign
              </Button>
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="head@paradox.in"
                  hint="They sign in at /admin/login with this."
                />
                <TextInput
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  hint="At least 8 characters."
                />
                {/* No designation box: the role dropdown above is the whole
                    answer, and `createAndAssign` writes its label to the account.
                    Change it afterwards under Staff if the person needs a title
                    broader than one event's role. */}
              </div>

              <Button
                type="button"
                size="sm"
                className="w-fit"
                loading={busy}
                disabled={busy || !email.trim() || password.length < 8}
                onClick={() => void createAndAssign()}
              >
                <UserPlus size={14} /> Create and assign
              </Button>
            </>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} className="mt-px shrink-0" strokeWidth={2.25} />
            <span>
              Every member can scan attendance for this event from the moment they are assigned;
              events have no per-member scanning switch. A new account is recorded with the role
              above as its designation, which you can change later under Staff.
            </span>
          </p>
        </Card>
      )}
    </section>
  );
}
