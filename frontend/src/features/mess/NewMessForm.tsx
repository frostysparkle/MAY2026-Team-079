import { useState } from 'react';
import type { MessCreateRequest } from '@/api/types';
import { Button, Card, Select, TextInput } from '@/components/ui';
import { MESS_PREFERENCE_TYPE_OPTIONS, MESS_PREFERENCE_TYPES } from '@/config/constants';
import { serverGeneratedIdPlaceholder } from '@/lib/serverGeneratedId';

/**
 * The "+ New Mess" form.
 *
 * It owns its own field state rather than lifting it to the page, so typing a
 * name does not re-render the table, its progress rings, and the summary cards
 * behind it on every keystroke. Unmounting it on cancel is also what forgets the
 * draft, so there is no reset logic to keep in sync with the fields.
 *
 * A single "Type" dropdown, not a diet select plus cuisine checkboxes: the
 * backend's `MessCreateRequest.type` (`backend/routers/mess.py`) is one field —
 * `"{cuisine}__{diet}"` (e.g. `"north_indian__veg"`) or the standalone `"jain"` —
 * validated as one closed set, not two independently-checked axes. There used to
 * be a separate `preference` + `cuisines` pair here, which the backend has no
 * fields for at all: `POST /mess` would silently drop both and 422 on the
 * missing `type`.
 */
export function NewMessForm({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (req: MessCreateRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('100');
  const [type, setType] = useState<string>(MESS_PREFERENCE_TYPES[0]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* No Mess ID box: `POST /mess` assigns the id itself. */}
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sahyadri"
          autoFocus
        />
        <TextInput
          label="Capacity"
          type="number"
          min={0}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
        <Select
          label="Type"
          options={MESS_PREFERENCE_TYPE_OPTIONS}
          value={type}
          onChange={(e) => setType(e.target.value)}
          hint="Cuisine and diet together — the exact value auto-allocation matches against a participant's meal preference."
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          disabled={!name.trim()}
          onClick={() =>
            onCreate({
              mess_id: serverGeneratedIdPlaceholder(name),
              name: name.trim(),
              capacity: Number(capacity) || 0,
              type,
            })
          }
        >
          Create mess hall
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
