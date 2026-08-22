import { useState } from 'react';
import { Button, Card, Select, TextInput } from '@/components/ui';
import { HOSTEL_GENDER_OPTIONS } from '@/config/constants';
import type { HostelCreateRequest } from '@/api/types';

/**
 * The "+ New Hostel" form.
 *
 * It owns its own field state rather than lifting it to the page, so typing a
 * name does not re-render the table, its progress rings, and the summary cards
 * behind it on every keystroke. Unmounting it on cancel is also what forgets the
 * draft, so there is no reset logic to keep in sync with the fields.
 */
export function NewHostelForm({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (req: HostelCreateRequest) => void;
  onCancel: () => void;
}) {
  const [hostelId, setHostelId] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('100');
  // Starts unchosen so a block is never silently filed as men's. Allocation
  // matches this against a participant's own gender, so it has to be deliberate.
  const [gender, setGender] = useState('');
  /**
   * The block's coordinator — who a resident rings first.
   *
   * `coordinator` used to be sent as a hardcoded `{}`, with no inputs for it
   * anywhere, so the "Coordinator" line on a participant's Accommodation & Mess
   * screen (`dutyContacts.coordinatorContact`, reading `coordinator.name` and
   * `coordinator.phone`) was permanently blank for every block created here.
   * Optional, because the backend types it as a free map and a block can be set up
   * before its coordinator is decided.
   */
  const [coordinatorName, setCoordinatorName] = useState('');
  const [coordinatorPhone, setCoordinatorPhone] = useState('');

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Hostel ID"
          value={hostelId}
          onChange={(e) => setHostelId(e.target.value)}
          placeholder="e.g. HS01"
          autoFocus
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alakananda"
        />
        <TextInput
          label="Capacity"
          type="number"
          min={0}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
        <Select
          label="Gender"
          placeholder="Select"
          options={HOSTEL_GENDER_OPTIONS}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
        />
        <TextInput
          label="Coordinator name"
          value={coordinatorName}
          onChange={(e) => setCoordinatorName(e.target.value)}
          placeholder="e.g. Anitha Raman"
          hint="Optional. Shown to residents as this block's first point of contact."
        />
        <TextInput
          label="Coordinator phone"
          type="tel"
          value={coordinatorPhone}
          onChange={(e) => setCoordinatorPhone(e.target.value)}
          placeholder="e.g. 9876543210"
          hint="Optional. Offered to residents as a tap-to-call link."
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          // Gender joins the required set now that it starts unchosen: a block
          // with no gender is one allocation can never place anyone in.
          disabled={!hostelId.trim() || !name.trim() || !gender}
          onClick={() =>
            onCreate({
              hostel_id: hostelId.trim(),
              name: name.trim(),
              capacity: Number(capacity) || 0,
              gender,
              // Only the keys actually filled in. `coordinatorContact` treats a
              // blank string as absent anyway, but storing one would make the
              // record claim a contact it does not have.
              coordinator: {
                ...(coordinatorName.trim() ? { name: coordinatorName.trim() } : {}),
                ...(coordinatorPhone.trim() ? { phone: coordinatorPhone.trim() } : {}),
              },
            })
          }
        >
          Create hostel
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
