import { useState } from 'react';
import type { BackendTeamMember, BackendTeamUpdateRequest } from '@/api/types';
import { Button, Card, ResultBanner, TextInput } from '@/components/ui';

/**
 * Amend one staff account — `PUT /backend_teams/{paradox_id}`.
 *
 * This route has been in the client since the beginning with nothing calling it,
 * so the only way to correct a role, department or designation was to delete the
 * account and make a new one — which changes the `paradox_id`, and therefore
 * silently drops the person off every mess, hostel, event and workshop team they
 * were named on. That is a large consequence for fixing a typo.
 *
 * Three editable fields, which is exactly what `BackendTeamUpdateRequest` allows.
 * Email and password are not among them: the backend's update schema has no place
 * for either, and pretending otherwise would show a change that is discarded.
 *
 * `department` is load-bearing, not cosmetic — a Domain Admin's oversight is
 * granted by `backend_teams.department` matching an `event.event_type`, and UHC by
 * `department == "uhc"` — so the hint says so rather than treating it as a label.
 */
export function EditStaffForm({
  member,
  busy,
  onSave,
  onCancel,
}: {
  member: BackendTeamMember;
  busy: boolean;
  onSave: (req: BackendTeamUpdateRequest) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(member.role ?? '');
  const [department, setDepartment] = useState(member.department ?? '');
  const [designation, setDesignation] = useState(member.designation ?? '');

  const changed =
    role.trim() !== (member.role ?? '') ||
    department.trim() !== (member.department ?? '') ||
    designation.trim() !== (member.designation ?? '');

  // Losing `super_admin` is the one edit here that can lock the fest out of its
  // own admin screens, so it is called out before it is made rather than
  // discovered afterwards.
  const droppingSuperAdmin = member.role === 'super_admin' && role.trim() !== 'super_admin';

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-ink">{member.email}</p>
        <p className="text-xs text-muted">
          {member.paradox_id}
          {/* The link to a participant document, which `POST /backend_teams` sets
              by looking the email up and the update route cannot change. Shown
              because it decides whether this account can be recognised as an event
              team member when its holder registers as a participant. */}
          {member.admin_id
            ? ' · linked to a participant record'
            : ' · no participant record linked'}
        </p>
      </div>

      {droppingSuperAdmin && (
        <ResultBanner variant="warning" title="This removes Super Admin access">
          They will lose the admin screens, staff management, and every create, update and delete
          route. Make sure another Super Admin account exists first.
        </ResultBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          autoFocus
          hint="super_admin is the only value the backend privileges."
        />
        <TextInput
          label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          hint="Matching an event's type grants oversight of it; uhc grants house-scoped visibility."
        />
        <TextInput
          label="Designation"
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="e.g. Fest Director"
          hint="Shown beside their name on team lists."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          disabled={!changed || busy}
          onClick={() =>
            onSave({
              role: role.trim(),
              department: department.trim(),
              designation: designation.trim(),
            })
          }
        >
          Save changes
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
