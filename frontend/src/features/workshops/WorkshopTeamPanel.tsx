import { useEffect, useState } from 'react';
import { ShieldCheck, ToggleLeft, ToggleRight, UserMinus, UserPlus, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { BackendTeamMember, WorkshopTeamMemberDetail } from '@/api/types';
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
  isWorkshopManager,
  WORKSHOP_ROLES,
  WORKSHOP_VOLUNTEER_ROLE,
  workshopRoleLabel,
} from './workshopTeam';

/**
 * A workshop's staff: who is on the door, what they are designated as, and
 * whether their scanner is live.
 *
 * Assignment is Super Admin work — `POST /workshops/{id}/volunteers` and
 * `PUT /workshops/{id}/volunteers/{uid}/toggle_scan` both refuse anybody else —
 * so `canManage` drives whether the controls render at all. A workshop manager
 * still sees the panel read-only, which is the point of the designation: the
 * person running the room can tell at a glance that a volunteer's scanner is off.
 *
 * Two API shapes are worth knowing here:
 *
 *   - `workshop_team` is projected out of `GET /workshops` for every caller but a
 *     Super Admin, so `team === undefined` means "not readable", not "empty".
 *   - There is no route that removes a member. Switching scanning off is the only
 *     way to stand somebody down, so the panel says so rather than offering a
 *     delete that would 404.
 */
export function WorkshopTeamPanel({
  workshopId,
  team,
  canManage,
  onChanged,
}: {
  workshopId: string;
  /**
   * `undefined` when neither source was readable. Members carry a name when the
   * list came from `GET /workshops/{id}/participation`, and not when it came from
   * `workshop_team` on the record.
   */
  team: WorkshopTeamMemberDetail[] | undefined;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [staffAccounts, setStaffAccounts] = useState<BackendTeamMember[] | null>(null);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState(WORKSHOP_VOLUNTEER_ROLE);
  /** `existing` picks somebody out of the staff directory; `new` creates them. */
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [designation, setDesignation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<WorkshopTeamMemberDetail | null>(null);

  // The staff directory turns "type a BT id" into "pick a person". Super
  // Admin-only, like this whole panel's write side, and never blocking: a failed
  // fetch falls back to the free-text field below.
  useEffect(() => {
    if (!canManage) return;
    api
      .listBackendTeams()
      .then(setStaffAccounts)
      .catch(() => setStaffAccounts([]));
  }, [canManage]);

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
    const ok = await run(
      () => api.assignWorkshopVolunteer(workshopId, { user_id: id, role, attendance: true }),
      'Could not assign this member.',
      `${id} assigned as ${workshopRoleLabel(role)}`,
    );
    // The field is cleared only once the assignment landed, so a failed attempt
    // can be retried without retyping the id.
    if (ok) setUserId('');
  }

  /**
   * Create a staff login and put it on this workshop in one go — two calls,
   * because that is how the API is shaped: `POST /backend_teams` mints the
   * account and hands back its `paradox_id`, and `POST /workshops/{id}/volunteers`
   * is what actually grants the scanners.
   *
   * If the second call fails the first has still happened, so the error names the
   * new id rather than pretending nothing occurred: the account exists and can be
   * attached from the picker without being created twice.
   */
  async function createAndAssign() {
    const label = workshopRoleLabel(role);
    setBusy(true);
    setError(null);
    setNotice(null);

    let newId: string | null = null;
    try {
      const created = await api.createBackendTeam({
        email: email.trim(),
        password,
        // `backend_teams.role` is the account's fest-wide role and is a separate
        // vocabulary from the per-workshop designation below; `volunteer` is the
        // non-privileged value, which is what a door role should be.
        role: 'volunteer',
        department: 'workshops',
        designation: designation.trim() || label,
      });
      newId = created.paradox_id;
      await api.assignWorkshopVolunteer(workshopId, {
        user_id: created.paradox_id,
        role,
        attendance: true,
      });
      setNotice(`${email.trim()} created as ${label} (${created.paradox_id})`);
      setEmail('');
      setPassword('');
      setDesignation('');
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
          ? `Account ${newId} was created but could not be assigned to this workshop: ${detail}`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  }

  const assignable = (staffAccounts ?? []).filter(
    (member) => !(team ?? []).some((t) => t.user_id === member.paradox_id),
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading
        title="Workshop team"
        meta={team === undefined ? undefined : `${team.length} assigned`}
      />

      {error && (
        <ResultBanner variant="error" title="Action failed">
          {error}
        </ResultBanner>
      )}
      {notice && <ResultBanner variant="success" title={notice} />}

      {team === undefined ? (
        <Card>
          <p className="text-sm text-muted">
            This workshop’s team is only returned to a Super Admin, so it cannot be listed from this
            account. Scanning permission is still enforced server-side on every scan.
          </p>
        </Card>
      ) : team.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nobody is assigned yet. A workshop needs at least one volunteer or manager with scanning
            switched on before anyone can be marked present.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {team.map((member) => (
            <li key={member.user_id}>
              <Card className="flex flex-wrap items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"
                >
                  {isWorkshopManager(member) ? (
                    <ShieldCheck size={16} strokeWidth={2.25} />
                  ) : (
                    <Users size={16} strokeWidth={2.25} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {member.name || member.user_id}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[
                      member.name ? member.user_id : null,
                      workshopRoleLabel(member.role),
                      member.phone,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <StatusBadge tone={member.attendance ? 'success' : 'neutral'}>
                  {member.attendance ? 'Scanning on' : 'Scanning off'}
                </StatusBadge>
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api.toggleWorkshopScan(workshopId, member.user_id, !member.attendance),
                          'Could not change scanning for this member.',
                          member.attendance
                            ? `Scanning switched off for ${member.user_id}`
                            : `Scanning switched on for ${member.user_id}`,
                        )
                      }
                    >
                      {member.attendance ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {member.attendance ? 'Switch off' : 'Switch on'}
                    </Button>
                    {/* Confirmed, because it is the one destructive action here:
                        the person loses both scanners and the desk immediately.
                        Their scans stay in the log — removal ends a shift, it does
                        not rewrite attendance history. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setPendingRemoval(member)}
                    >
                      <UserMinus size={14} /> Remove
                    </Button>
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <Card className="flex flex-col gap-3">
          {/* Staffing a workshop is either "somebody who already has a login" or
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

          <Select
            label="Designation on this workshop"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            options={WORKSHOP_ROLES.map((r) => ({ value: r.value, label: r.label }))}
            hint={WORKSHOP_ROLES.find((r) => r.value === role)?.blurb}
          />

          {mode === 'existing' ? (
            <>
              {assignable.length > 0 ? (
                <Select
                  label="Staff account"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="Choose a staff account"
                  options={assignable.map((member) => ({
                    value: member.paradox_id,
                    label: `${member.email} · ${member.designation || member.role || 'staff'}`,
                  }))}
                />
              ) : (
                <TextInput
                  label="Staff ID"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="e.g. BT1000000003"
                  hint="The paradox_id of an account created under Staff."
                />
              )}

              <Button
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
                  placeholder="volunteer@paradox.in"
                  hint="They sign in at /admin/login with this."
                />
                <TextInput
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  hint="At least 8 characters."
                />
                <TextInput
                  label="Designation on record"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  placeholder={workshopRoleLabel(role)}
                  hint="Shown on the staff directory. Defaults to the designation above."
                />
              </div>

              <Button
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

          <p className="text-xs text-muted">
            Scanning is on from the moment somebody is assigned. Switch it off to stand a volunteer
            down for a shift, or remove them to take them off this workshop entirely.
          </p>
        </Card>
      )}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title={`Remove ${pendingRemoval?.name || pendingRemoval?.user_id} from this workshop?`}
        description="They lose both scanners and the workshop desk straight away. The scans they have already made stay in the workshop's log."
        confirmLabel="Remove from team"
        loading={busy}
        onConfirm={() => {
          const member = pendingRemoval;
          if (!member) return;
          void run(
            () => api.removeWorkshopVolunteer(workshopId, member.user_id),
            'Could not remove this member.',
            `${member.name || member.user_id} removed from this workshop`,
          ).then((ok) => {
            if (ok) setPendingRemoval(null);
          });
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </section>
  );
}
