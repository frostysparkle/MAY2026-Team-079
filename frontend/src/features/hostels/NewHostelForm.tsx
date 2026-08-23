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
 *
 * Matches `HostelCreateRequest` (`backend/routers/hostels.py`) exactly: no
 * `hostel_id` box — the backend always generates the id itself and has no field
 * to accept one — no `coordinator`, which the backend does not model at all,
 * and `sharing` / `num_rooms` in their place, both required. `num_rooms *
 * sharing` must cover `capacity` or the backend 422s, so the ceiling is
 * validated here too rather than only client-side-optimistically.
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
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('100');
  // Starts unchosen so a block is never silently filed as men's. Allocation
  // matches this against a participant's own gender, so it has to be deliberate.
  const [gender, setGender] = useState('');
  const [sharing, setSharing] = useState('2');
  const [numRooms, setNumRooms] = useState('50');

  const capacityNum = Number(capacity) || 0;
  const sharingNum = Number(sharing) || 0;
  const numRoomsNum = Number(numRooms) || 0;
  const roomsCoverCapacity = numRoomsNum * sharingNum >= capacityNum;

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* No Hostel ID box: `POST /hostels` assigns the id itself. */}
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alakananda"
          autoFocus
        />
        <Select
          label="Gender"
          placeholder="Select"
          options={HOSTEL_GENDER_OPTIONS}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
        />
        <TextInput
          label="Capacity"
          type="number"
          min={0}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
        <TextInput
          label="Sharing"
          type="number"
          min={1}
          value={sharing}
          onChange={(e) => setSharing(e.target.value)}
          hint="Max occupants per room."
        />
        <TextInput
          label="Number of rooms"
          type="number"
          min={1}
          value={numRooms}
          onChange={(e) => setNumRooms(e.target.value)}
          hint="Rooms to pre-generate for this block."
          error={
            !roomsCoverCapacity
              ? `Rooms × sharing (${numRoomsNum * sharingNum}) must cover capacity (${capacityNum}).`
              : undefined
          }
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          // Gender joins the required set now that it starts unchosen: a block
          // with no gender is one allocation can never place anyone in. Rooms
          // must actually cover capacity, or the backend refuses the create.
          disabled={
            !name.trim() ||
            !gender ||
            capacityNum <= 0 ||
            sharingNum <= 0 ||
            numRoomsNum <= 0 ||
            !roomsCoverCapacity
          }
          onClick={() =>
            onCreate({
              name: name.trim(),
              capacity: capacityNum,
              gender,
              sharing: sharingNum,
              num_rooms: numRoomsNum,
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
