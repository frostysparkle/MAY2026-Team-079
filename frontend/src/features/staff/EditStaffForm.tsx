import { useState } from 'react';
import type { BackendTeamMember, BackendTeamUpdateRequest } from '@/api/types';
import { Button, Card, StatusBadge, TextInput } from '@/components/ui';

/**
 * Amend one staff account — `PUT /backend_teams/{paradox_id}`.
 *
 * Only `designation` and `name` are editable, which is exactly what the
 * backend's real `BackendTeamUpdateRequest` allows (`backend/models.py`).
 * `role` and `department` used to be offered here too, with a warning banner
 * implying that changing away from `super_admin` had a real effect — but the
 * backend's update model has no fields for either: both drive the `paradox_id`
 * prefix assigned at creation and are immutable by design, so a `PUT` naming
 * them changed nothing while still returning `200 "success"`. The route
 * documents this explicitly: changing role or department means deleting the
 * account and creating a new one, not patching this one — which is also a
 * bigger, deliberate decision (it drops the person off every mess, hostel,
 * event and workshop team they were named on) and not something this form
 * should invite as a side effect of fixing a typo.
 *
 * Email and password are likewise absent: the backend's update schema has no
 * place for either.
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
  const [designation, setDesignation] = useState(member.designation ?? '');
  const [name, setName] = useState(member.name ?? '');

  const changed =
    designation.trim() !== (member.designation ?? '') || name.trim() !== (member.name ?? '');

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
        {/* Read-only: role and department are immutable after creation — see
            this form's docstring for why they are not editable here. */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <StatusBadge tone="neutral">{member.role}</StatusBadge>
          <StatusBadge tone="neutral">{member.department}</StatusBadge>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="e.g. Anitha Raman"
          hint="Shown on team lists and in the audit trail's name lookups."
        />
        <TextInput
          label="Designation"
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="e.g. Fest Director"
          hint="Shown beside their name on team lists."
        />
      </div>
      <p className="text-xs text-muted">
        Role and department cannot be changed here — they are fixed at creation. To change either,
        delete this account and create a new one; note that doing so removes them from every mess,
        hostel, event and workshop team they are named on.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          disabled={!changed || busy}
          onClick={() =>
            onSave({
              designation: designation.trim(),
              name: name.trim(),
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
