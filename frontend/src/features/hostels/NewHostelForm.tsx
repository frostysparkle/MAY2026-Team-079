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
              coordinator: {},
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
