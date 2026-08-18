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
  const [role, setRole] = useState('staff');
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
          hint="technicals, sports, culturals, or UpperHouseCouncil"
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
