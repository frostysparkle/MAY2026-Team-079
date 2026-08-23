import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { reportApiError } from '@/api/report';
import type { WorkshopSlot } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FieldErrors,
  ResultBanner,
  Skeleton,
  TextInput,
} from '@/components/ui';
import type { FieldError } from '@/api/errors';

/** `HH:MM` on `<input type="datetime-local">` truncates seconds; ISO needs them back. */
function toIso(localValue: string): string {
  if (!localValue) return '';
  // `datetime-local` gives "2026-06-13T10:00"; the backend parses any ISO 8601
  // string, and appending "Z" is consistent with how the rest of the app sends
  // timestamps (see `useLiveQr.ts`) — treated as UTC by both sides.
  return `${localValue}:00Z`;
}

/** The reverse of `toIso`, for hydrating the input from a stored value. */
function fromIso(value: string | null | undefined): string {
  if (!value) return '';
  // Accepts a trailing "Z" or an offset; `datetime-local` wants neither, and
  // wants exactly `YYYY-MM-DDTHH:MM`.
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value.trim());
  return match ? match[1] : '';
}

/**
 * Slot id must match `^D\d+S\d+$` — the same pattern the backend's
 * `WorkshopSlotCreateRequest` validates (`backend/models.py`). Checked here so
 * a mistyped id is caught before the request round-trips, not just relayed
 * back as a 422.
 */
const SLOT_ID_PATTERN = /^D\d+S\d+$/;

/**
 * The workshop-slot catalogue — Super Admin management of the `D<day>S<shift>`
 * time blocks workshops are scheduled against.
 *
 * This is a real backend capability (`GET/POST/PUT/DELETE /workshop-slots`,
 * `backend/routers/workshop_slots.py`) that had no frontend surface at all: a
 * workshop's `slot_id` must reference an existing slot document or
 * `POST /workshops` 404s ("Workshop slot not found. Create it via
 * POST /workshop-slots first."), and until this screen existed there was no
 * way to create one through the UI.
 *
 * Deleting a slot cascades: every workshop scheduled against it is deleted too,
 * along with participants' bookings for those workshops. `ConfirmDialog` says
 * so before it runs.
 */
export default function AdminWorkshopSlotsPage() {
  const navigate = useNavigate();
  const [slots, setSlots] = useState<WorkshopSlot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [slotId, setSlotId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<FieldError[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<WorkshopSlot | null>(null);

  function load() {
    api
      .listWorkshopSlots()
      .then((all) => {
        setSlots(
          [...all].sort((a, b) => a.slot_id.localeCompare(b.slot_id, undefined, { numeric: true })),
        );
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshop slots.'),
      );
  }
  useEffect(load, []);

  async function create() {
    setCreateError(null);
    setCreateFieldErrors([]);
    if (!SLOT_ID_PATTERN.test(slotId.trim())) {
      setCreateError('Slot id must match D<day>S<shift>, e.g. D1S1.');
      return;
    }
    setBusy(true);
    try {
      await api.createWorkshopSlot({
        slot_id: slotId.trim(),
        start_time: toIso(startTime),
        end_time: toIso(endTime),
      });
      setShowCreate(false);
      setSlotId('');
      setStartTime('');
      setEndTime('');
      load();
    } catch (e) {
      setCreateError(e instanceof ApiClientError ? e.message : 'Could not create the slot.');
      setCreateFieldErrors(e instanceof ApiClientError ? e.fieldErrors : []);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(slot: WorkshopSlot) {
    setEditingId(slot.slot_id);
    setEditStart(fromIso(slot.start_time));
    setEditEnd(fromIso(slot.end_time));
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true);
    setEditError(null);
    try {
      const res = await api.updateWorkshopSlot(editingId, {
        start_time: editStart ? toIso(editStart) : undefined,
        end_time: editEnd ? toIso(editEnd) : undefined,
      });
      setEditingId(null);
      if (res.workshops_updated > 0) {
        setActionError(
          `Slot updated. This shifted the scan window of ${res.workshops_updated} workshop${
            res.workshops_updated === 1 ? '' : 's'
          } scheduled against it.`,
        );
      }
      load();
    } catch (e) {
      setEditError(e instanceof ApiClientError ? e.message : 'Could not update the slot.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.deleteWorkshopSlot(pendingDelete.slot_id);
      setPendingDelete(null);
      if (res.workshops_deleted > 0) {
        setActionError(
          `Slot deleted, along with ${res.workshops_deleted} workshop${
            res.workshops_deleted === 1 ? '' : 's'
          } scheduled against it and their bookings.`,
        );
      }
      load();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not delete the slot.'));
    } finally {
      setBusy(false);
    }
  }

  const back = { label: 'Workshops', onClick: () => navigate(ROUTES.adminWorkshops) };

  if (loadError) {
    return (
      <FestivalScreen title="Workshop slots" back={back}>
        <ErrorState title="Could not load workshop slots" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="Workshop slots"
      subtitle="The D<day>S<shift> time blocks a workshop is scheduled against. Create one here before scheduling a workshop into it."
      back={back}
      actions={
        !showCreate && (
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus size={15} strokeWidth={2.5} /> New slot
          </Button>
        )
      }
    >
      {actionError && (
        <ResultBanner variant="warning" title="Notice">
          {actionError}
        </ResultBanner>
      )}

      {showCreate && (
        <Card className="flex flex-col gap-3">
          {createError && (
            <ResultBanner variant="error" title="Could not create slot">
              <div className="flex flex-col gap-2">
                <p>{createError}</p>
                <FieldErrors errors={createFieldErrors} />
              </div>
            </ResultBanner>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <TextInput
              label="Slot id"
              required
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
              placeholder="e.g. D1S1"
              hint="Day and shift number: D<day>S<shift>."
              autoFocus
            />
            <TextInput
              label="Start time"
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <TextInput
              label="End time"
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="w-fit"
              loading={busy}
              disabled={!slotId.trim() || !startTime || !endTime}
              onClick={() => void create()}
            >
              Create slot
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setShowCreate(false);
                setCreateError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {slots === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <EmptyState
          title="No workshop slots yet"
          description="Create one before scheduling a workshop into it."
          icon={Plus}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <li key={slot.slot_id}>
              <Card className="flex flex-col gap-3">
                {editingId === slot.slot_id ? (
                  <>
                    {editError && (
                      <ResultBanner variant="error" title="Could not update slot">
                        {editError}
                      </ResultBanner>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <p className="flex items-center text-sm font-semibold text-ink">
                        {slot.slot_id}
                      </p>
                      <TextInput
                        label="Start time"
                        type="datetime-local"
                        value={editStart}
                        onChange={(e) => setEditStart(e.target.value)}
                      />
                      <TextInput
                        label="End time"
                        type="datetime-local"
                        value={editEnd}
                        onChange={(e) => setEditEnd(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-muted">
                      Editing the start time shifts the scan window of every workshop scheduled
                      against this slot.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="w-fit"
                        loading={busy}
                        onClick={() => void saveEdit()}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{slot.slot_id}</p>
                      <p className="text-xs text-muted">
                        {slot.start_time} &ndash; {slot.end_time}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => startEdit(slot)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:bg-danger-bg"
                        onClick={() => setPendingDelete(slot)}
                      >
                        <Trash2 size={14} strokeWidth={2.25} />
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete slot "${pendingDelete?.slot_id}"?`}
        description="This also deletes every workshop scheduled against this slot, and every participant's booking for those workshops. This cannot be undone."
        confirmLabel="Delete slot"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </FestivalScreen>
  );
}
