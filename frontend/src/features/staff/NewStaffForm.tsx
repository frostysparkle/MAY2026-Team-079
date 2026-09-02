import { useState } from 'react';
import type { BackendTeamCreateRequest } from '@/api/types';
import { Button, Card, TextInput } from '@/components/ui';

/**
 * The "+ New Staff Account" form.
 *
 * It owns its own field state rather than lifting it to the page, so typing an
 * email does not re-render the account list behind it on every keystroke.
 * Unmounting it on cancel is also what forgets the draft, so there is no reset
 * logic to keep in sync with the fields.
 *
 * The same shape as `NewHostelForm` and `NewMessForm`: revealed by a button beside
 * its section heading rather than sitting open above the list it adds to.
 */
export function NewStaffForm({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (req: BackendTeamCreateRequest) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // `POST /backend_teams` only accepts `super_admin | admin | other | volunteer`
  // (backend/models.py) — 'staff' was never one of them, so leaving this field
  // untouched and clicking Create used to 422 on every submission. `'admin'` is
  // a real option and the least-surprising default for a role field.
  const [role, setRole] = useState('admin');
  const [department, setDepartment] = useState('');
  const [designation, setDesignation] = useState('');

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <TextInput
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="At least 8 characters."
        />
        <TextInput
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          hint="super_admin, admin, other, or volunteer"
        />
        <TextInput
          label="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          hint="technical, sports, culturals, uhc, hostels, mess, or workshops"
        />
        <TextInput
          label="Designation"
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
          placeholder="e.g. Fest Director"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          disabled={!email.trim() || password.length < 8}
          onClick={() =>
            onCreate({
              email: email.trim(),
              password,
              role: role.trim(),
              department: department.trim(),
              designation: designation.trim(),
            })
          }
        >
          Create account
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
