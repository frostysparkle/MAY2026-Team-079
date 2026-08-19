import { useState } from 'react';
import type { MessCreateRequest } from '@/api/types';
import { Button, Card, Select, TextInput } from '@/components/ui';
import { MESS_CUISINE_OPTIONS, MESS_PREFERENCES } from '@/config/constants';

const PREF_OPTIONS = MESS_PREFERENCES.map((p) => ({ value: p, label: p }));

/**
 * The "+ New Mess" form.
 *
 * It owns its own field state rather than lifting it to the page, so typing a
 * name does not re-render the table, its progress rings, and the summary cards
 * behind it on every keystroke. Unmounting it on cancel is also what forgets the
 * draft, so there is no reset logic to keep in sync with the fields.
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
  const [messId, setMessId] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('100');
  const [preference, setPreference] = useState<string>(MESS_PREFERENCES[0]);
  // Which regional menus the hall cooks. A set rather than a single value: a hall
  // can serve both, as Nilgiri does.
  const [cuisines, setCuisines] = useState<string[]>([]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label="Mess ID"
          value={messId}
          onChange={(e) => setMessId(e.target.value)}
          // MS01–MS03 are the seeded catalogue, so the hint points past them.
          placeholder="e.g. MS04"
          autoFocus
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sahyadri"
        />
        <TextInput
          label="Capacity"
          type="number"
          min={0}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
        />
        <Select
          label="Preference"
          options={PREF_OPTIONS}
          value={preference}
          onChange={(e) => setPreference(e.target.value)}
        />
      </div>

      {/* Checkboxes, not a second dropdown: a hall can serve both menus. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Cuisines</legend>
        <div className="flex flex-wrap gap-4">
          {MESS_CUISINE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-ink"
            >
              <input
                type="checkbox"
                checked={cuisines.includes(option.value)}
                onChange={(e) =>
                  setCuisines((prev) =>
                    e.target.checked
                      ? [...prev, option.value]
                      : prev.filter((c) => c !== option.value),
                  )
                }
                className="h-4 w-4 rounded border-input accent-brand"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-muted">
        Auto-allocation groups participants by veg/non_veg/jain — anyone whose profile predates that
        vocabulary will not match a hall. Cuisine is recorded for the programme only; it does not
        affect who is placed where.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          className="w-fit"
          loading={busy}
          disabled={!messId.trim() || !name.trim()}
          onClick={() =>
            onCreate({
              mess_id: messId.trim(),
              name: name.trim(),
              capacity: Number(capacity) || 0,
              preference,
              cuisines,
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
