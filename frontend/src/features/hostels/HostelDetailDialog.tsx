import { useEffect, useRef, useState } from 'react';
import {
  BedDouble,
  DoorOpen,
  Download,
  ScanLine,
  ToggleLeft,
  ToggleRight,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { HostelStatisticsResponse } from '@/api/types';
import {
  Button,
  EmptyState,
  ProgressRing,
  Select,
  Spinner,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import {
  HOSTEL_TEAM_ROLES,
  HOSTEL_VOLUNTEER_ROLE,
  hostelRoleLabel,
  type HostelTeamRole,
} from '@/features/stay/facilityTeam';
import { exportHostelRoster } from '@/features/staff/analyticsExport';
import { OCCUPANCY_STATUS, occupancyTone } from '@/features/occupancy';
import { type HostelRow } from './hostelOccupancy';

/**
 * Everything about one block, opened from the row's view action.
 *
 * The list used to carry this inline on every card — the team, the scan toggles,
 * the "add team member" field, a statistics button — which is why 22 blocks made
 * for a very long page and why none of the figures could be compared across
 * blocks. Management moved in here so the list itself can stay a table, and so
 * the roster of who is allotted where has somewhere to actually live.
 */
export function HostelDetailDialog({
  row,
  stat,
  loading,
  busy,
  onClose,
  onAssignTeam,
  onToggleScan,
  onOpenScanner,
}: {
  row: HostelRow;
  stat: HostelStatisticsResponse | undefined;
  /** Statistics are still being fetched for this block. */
  loading: boolean;
  /** An action is in flight; disables the controls that would race it. */
  busy: boolean;
  onClose: () => void;
  onAssignTeam: (userId: string, role: HostelTeamRole) => void;
  onToggleScan: (userId: string, logging: boolean) => void;
  onOpenScanner: () => void;
}) {
  const [teamUserId, setTeamUserId] = useState('');
  const [teamRole, setTeamRole] = useState<HostelTeamRole>(HOSTEL_VOLUNTEER_ROLE);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Same focus contract as ConfirmDialog: focus moves in on open and returns to
  // whatever opened it on close, Escape cancels, and the page behind cannot scroll.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeyDown);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const team = row.hostel.hostel_team ?? [];
  const status = row.status ? OCCUPANCY_STATUS[row.status] : null;

  return (
    <div
      className="fixed inset-0 z-70 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hostel-detail-title"
        className="animate-pop flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-surface shadow-lift ring-1 ring-black/[0.06] sm:rounded-3xl"
      >
        <header className="flex items-start gap-3 border-b border-line p-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="hostel-detail-title" className="text-lg font-black text-ink">
                {row.name}
              </h2>
              <StatusBadge tone={row.category === 'women' ? 'danger' : 'info'}>
                {row.categoryLabel}
              </StatusBadge>
              {status && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {row.id} · {row.capacity} beds
            </p>
          </div>
          {row.percent !== null && (
            <ProgressRing
              value={row.allocated ?? 0}
              max={row.capacity}
              size={52}
              thickness={5}
              tone={occupancyTone(row.status ?? 'empty')}
              label={`${row.name} occupancy`}
            />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-5 overflow-y-auto p-5">
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Allocated" value={row.allocated} />
            <Figure label="Available" value={row.available} tone="success" />
            <Figure label="Inside now" value={row.inside} />
          </dl>

          {/* ---- team ---- */}
          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
              <Users size={15} strokeWidth={2.25} aria-hidden /> Hostel team
            </h3>

            {team.length === 0 ? (
              <p className="text-sm text-muted">
                Nobody is assigned yet. A block needs at least one member with scanning on before
                entry and exit can be logged.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {team.map((member) => (
                  <li
                    key={member.user_id ?? member.name}
                    className="flex items-center justify-between gap-3 rounded-xl bg-surface-2/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {member.name ?? member.user_id}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {hostelRoleLabel(member.role)}
                        {member.phone ? ` · ${member.phone}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !member.user_id}
                      onClick={() => onToggleScan(member.user_id!, !member.attendance)}
                    >
                      {member.attendance ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                      {member.attendance ? 'Scanning on' : 'Scanning off'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2">
              <TextInput
                label="Add team member (staff ID)"
                value={teamUserId}
                onChange={(e) => setTeamUserId(e.target.value)}
                placeholder="e.g. BT1000000004"
              />
              {/* The backend's hostel-team role vocabulary
                  (`hostel_volunteer`/`guard`) is different from mess's
                  (`volunteer`/`other`) — see `HOSTEL_TEAM_ROLES`'s docstring. This
                  used to reuse the mess vocabulary here, so every assignment
                  through this dialog 422'd against the real API. */}
              <Select
                label="Role on this block"
                value={teamRole}
                onChange={(e) => setTeamRole(e.target.value as HostelTeamRole)}
                options={HOSTEL_TEAM_ROLES.map((r) => ({ value: r.value, label: r.label }))}
                hint={HOSTEL_TEAM_ROLES.find((r) => r.value === teamRole)?.blurb}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !teamUserId.trim()}
                  onClick={() => {
                    onAssignTeam(teamUserId.trim(), teamRole);
                    setTeamUserId('');
                  }}
                >
                  <UserPlus size={14} /> Assign
                </Button>
                <Button size="sm" variant="ghost" onClick={onOpenScanner}>
                  <ScanLine size={14} /> Open scanner
                </Button>
              </div>
            </div>
          </section>

          {/* ---- roster ---- */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
                <BedDouble size={15} strokeWidth={2.25} aria-hidden /> Allotted participants
              </h3>
              {/* Journey E.10 — includes the room each resident was given, which is
                  the column a warden actually needs on paper. */}
              {stat && stat.allotted_participants.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => exportHostelRoster(row.id, stat)}>
                  <Download size={14} /> Export CSV
                </Button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner label="Loading the roster" />
              </div>
            ) : !stat ? (
              <p className="text-sm text-muted">
                Occupancy for this block needs Super Admin access.
              </p>
            ) : stat.allotted_participants.length === 0 ? (
              <EmptyState
                title="Nobody allotted yet"
                description="Run “Allocate registered participants” to fill the block."
                icon={DoorOpen}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {stat.allotted_participants.map((p) => (
                  <li key={p.participant_id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {p.name ?? p.participant_id}
                      </p>
                      <p className="truncate text-xs text-muted">{p.email}</p>
                    </div>
                    <StatusBadge tone="neutral">Room {p.room ?? '—'}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** One figure in the header strip. An unreadable figure shows a dash, not a 0. */
function Figure({
  label,
  value,
  tone = 'ink',
}: {
  label: string;
  value: number | null;
  tone?: 'ink' | 'success';
}) {
  return (
    <div className="rounded-xl bg-surface-2/60 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd
        className={`text-lg font-black tabular-nums ${tone === 'success' ? 'text-success' : 'text-ink'}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}
