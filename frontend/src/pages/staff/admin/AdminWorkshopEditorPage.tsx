import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { WorkshopTeamPanel } from '@/features/workshops/WorkshopTeamPanel';
import {
  Button,
  Card,
  ErrorState,
  FieldErrors,
  ResultBanner,
  Select,
  Spinner,
  TextInput,
} from '@/components/ui';
import type { FieldError } from '@/api/errors';
import {
  formatSlotId,
  parseSlotId,
  shiftLabel,
  WORKSHOP_SHIFTS,
  type WorkshopShift,
} from '@/features/workshops/workshopSlot';
import { workshopPosterPaths, WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { serverGeneratedIdPlaceholder } from '@/lib/serverGeneratedId';

/**
 * Super Admin workshop authoring — create a new workshop or edit an existing
 * one. Mirrors `AdminEventEditorPage`.
 *
 * The day and shift are stored in `slot_id`, which is the backend's own
 * time-slot field: two workshops sharing a slot genuinely clash, and the
 * register endpoint already refuses a second booking in the same slot. The
 * flyer is not stored at all — it is derived from the workshop id by
 * convention, so a flyer named for the id picks it up automatically. Since the
 * server assigns that id, the flyer can only be dropped in after the workshop
 * exists; the Artwork card says as much on create.
 */
export default function AdminWorkshopEditorPage() {
  const navigate = useNavigate();
  const { workshopId } = useParams<{ workshopId?: string }>();
  const isEdit = Boolean(workshopId);

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * The stored record, kept alongside the form fields for the team panel below —
   * `workshop_team` is not editable here, it is assigned through its own routes.
   * Refreshing it after a team change deliberately does *not* re-hydrate the
   * form, so an unsaved edit survives assigning a volunteer.
   */
  const [record, setRecord] = useState<Workshop | null>(null);

  /**
   * The workshop's id. Not an editable field — `POST /workshops` assigns it. It
   * is held because the flyer path is derived from it, which the Artwork card
   * previews once the workshop exists.
   */
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [capacity, setCapacity] = useState(30);
  const [instructions, setInstructions] = useState('');
  const [date, setDate] = useState('');
  const [shift, setShift] = useState<WorkshopShift>('morning');
  /** Kept verbatim when the existing slot id is not a day/shift pair. */
  const [rawSlot, setRawSlot] = useState<string | null>(null);

  useEffect(() => {
    if (!workshopId) return;
    api
      .listWorkshops()
      .then((all) => {
        const found = all.find((w) => w.workshop_id === workshopId);
        if (!found) {
          setLoadError('That workshop no longer exists.');
          return;
        }
        hydrate(found);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the workshop.'),
      )
      .finally(() => setLoading(false));

    function hydrate(workshop: Workshop) {
      const slot = parseSlotId(workshop.slot_id);
      setRecord(workshop);
      setId(workshop.workshop_id);
      setName(workshop.name);
      setVenue(workshop.venue);
      setCapacity(workshop.capacity);
      setInstructions(workshop.instructions ?? '');
      if (slot.date && slot.shift) {
        setDate(slot.date);
        setShift(slot.shift);
        setRawSlot(null);
      } else {
        // A hand-written slot id is preserved rather than silently rewritten.
        setRawSlot(workshop.slot_id);
      }
    }
  }, [workshopId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setBusy(true);

    const slotId = rawSlot ?? formatSlotId(date, shift);

    try {
      if (isEdit && workshopId) {
        // The backend's update schema covers name/venue/capacity/instructions
        // only — `slot_id` is fixed once created, since participants' bookings
        // reference it.
        await api.updateWorkshop(workshopId, {
          name: name.trim(),
          venue: venue.trim(),
          capacity,
          instructions: instructions.trim(),
        });
      } else {
        await api.createWorkshop({
          // Required by the schema, ignored by the handler, which generates the
          // real id. See `serverGeneratedIdPlaceholder`.
          workshop_id: serverGeneratedIdPlaceholder(name),
          slot_id: slotId,
          name: name.trim(),
          venue: venue.trim(),
          capacity,
          instructions: instructions.trim(),
        });
      }
      navigate(ROUTES.adminWorkshops);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : 'Could not save the workshop.');
      setSaveFieldErrors(err instanceof ApiClientError ? err.fieldErrors : []);
    } finally {
      setBusy(false);
    }
  }

  /** Re-reads the record only — the form keeps whatever is typed into it. */
  function refreshRecord() {
    if (!workshopId) return;
    api
      .listWorkshops()
      .then((all) => setRecord(all.find((w) => w.workshop_id === workshopId) ?? null))
      .catch(() => undefined);
  }

  const back = { label: 'Workshops', onClick: () => navigate(ROUTES.adminWorkshops) };

  if (loadError) {
    return (
      <FestivalScreen title="Edit workshop" back={back}>
        <ErrorState title="Could not load workshop" description={loadError} />
      </FestivalScreen>
    );
  }

  if (loading) {
    return (
      <FestivalScreen title="Edit workshop" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }

  const preview = workshopPosterPaths(id || 'workshop');

  return (
    <FestivalScreen
      title={isEdit ? 'Edit workshop' : 'New workshop'}
      subtitle={
        isEdit
          ? `${name || 'This workshop'} — changes show on the public page as soon as you save.`
          : 'A new workshop appears in the public catalogue as soon as you create it.'
      }
      back={back}
    >
      <form onSubmit={save} className="flex flex-col gap-5">
        {saveError && (
          <ResultBanner variant="error" title="Could not save">
            <div className="flex flex-col gap-2">
              <p>{saveError}</p>
              <FieldErrors errors={saveFieldErrors} />
            </div>
          </ResultBanner>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-black tracking-tight text-ink">Basics</h2>
              <p className="text-xs text-muted">What the workshop is and where it runs.</p>
            </div>

            <TextInput
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Intro to Embedded Rust"
            />
            <TextInput
              label="Venue"
              required
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. CRC 102"
            />
            <TextInput
              label="Capacity"
              type="number"
              min={1}
              required
              value={String(capacity)}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))}
            />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Instructions</span>
              <textarea
                rows={5}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="What to bring, prerequisites, anything a participant needs to know."
                className="w-full rounded-lg border border-input bg-surface p-3 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>
          </Card>

          <div className="flex flex-col gap-5">
            <Card className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-black tracking-tight text-ink">Time slot</h2>
                <p className="text-xs text-muted">
                  A participant can book only one workshop per shift per day. Two workshops in the
                  same slot count as a clash.
                </p>
              </div>

              {rawSlot !== null ? (
                <ResultBanner variant="warning" title="Custom slot id">
                  This workshop uses <code>{rawSlot}</code>, which is not a day/shift pair. It is
                  kept as-is; clear it below to switch to a day and shift.
                  <span className="mt-2 block">
                    <Button type="button" variant="secondary" onClick={() => setRawSlot(null)}>
                      Use a day and shift
                    </Button>
                  </span>
                </ResultBanner>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <TextInput
                    label="Day"
                    type="date"
                    required={!isEdit}
                    disabled={isEdit}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <Select
                    label="Shift"
                    value={shift}
                    disabled={isEdit}
                    onChange={(e) => setShift(e.target.value as WorkshopShift)}
                    options={WORKSHOP_SHIFTS.map((s) => ({ value: s, label: shiftLabel(s) }))}
                  />
                </div>
              )}

              {isEdit && (
                <p className="text-xs text-muted">
                  The slot is fixed after creation — participants' bookings reference it.
                </p>
              )}
            </Card>

            <Card className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-black tracking-tight text-ink">Artwork</h2>
                {isEdit ? (
                  <p className="text-xs text-muted">
                    The flyer is not uploaded — it is looked up from the workshop id. Drop
                    <code className="mx-1">{`${id}.avif`}</code> and
                    <code className="mx-1">{`${id}-full.avif`}</code> into
                    <code className="ml-1">public/images/workshops/</code>. Without them the
                    catalogue artwork is used.
                  </p>
                ) : (
                  <p className="text-xs text-muted">
                    The flyer is not uploaded — it is looked up from the workshop id, which is
                    assigned when you create the workshop. Once it exists, reopen it here to see the
                    two filenames to drop into
                    <code className="ml-1">public/images/workshops/</code>. Until then the catalogue
                    artwork is used.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
                  <img
                    src={preview.poster}
                    alt=""
                    onError={(e) => {
                      if (!e.currentTarget.src.endsWith(WORKSHOP_COVER)) {
                        e.currentTarget.src = WORKSHOP_COVER;
                      }
                    }}
                    className="h-full w-full object-cover"
                  />
                </div>
                <p className="break-all text-xs text-muted">{preview.poster}</p>
              </div>
            </Card>
          </div>
        </div>

        <div className="sticky bottom-0 flex gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
          <Button type="submit" loading={busy}>
            {isEdit ? 'Save changes' : 'Create workshop'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(ROUTES.adminWorkshops)}>
            Cancel
          </Button>
        </div>
      </form>

      {/* Outside the form on purpose: these are immediate writes to their own
          routes, not part of the workshop's draft, and a submit button in a form
          would save the workshop as a side effect of assigning a volunteer.
          Only on edit — a workshop must exist before anybody can be put on it. */}
      {isEdit && workshopId && (
        <div className="mt-8 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Volunteers and workshop managers assigned here get the two scanners and the workshop
            desk for this workshop — the attendance figures, the attendee and absentee lists, and
            the exports.
          </p>
          {/* `GET /workshops` carries the team but no names for it, so the members
              are widened to the panel's shape with the name left null. The desk
              gets the named version from the participation route instead. */}
          <WorkshopTeamPanel
            workshopId={workshopId}
            team={record?.workshop_team?.map((member) => ({
              user_id: member.user_id,
              role: member.role,
              attendance: member.attendance,
              name: null,
              phone: null,
            }))}
            canManage
            onChanged={refreshRecord}
          />
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate(path(ROUTES.workshopManage, { workshopId }))}
            >
              Open the workshop desk
            </Button>
          </div>
        </div>
      )}
    </FestivalScreen>
  );
}
