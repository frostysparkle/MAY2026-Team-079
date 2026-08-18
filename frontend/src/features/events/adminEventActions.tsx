import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LockOpen, Pencil, Trash2, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { ConfirmDialog, type ActionMenuItem } from '@/components/ui';

/**
 * The four things a Super Admin does to an event — edit it, look at who
 * registered, open or close registration, delete it — in one place, so the
 * dashboard grid and the event page offer exactly the same menu.
 *
 * Deleting is confirmed: it also drops every participant's registration, which
 * the backend cannot undo.
 */
export function useAdminEventActions({
  onChanged,
  onDeleted,
}: {
  /** Registration was opened or closed; re-read the event(s). */
  onChanged?: () => void;
  /** The event is gone. The grid reloads, an event page navigates away. */
  onDeleted?: (event: Event) => void;
} = {}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Event | null>(null);

  async function toggleOpen(event: Event) {
    setBusy(true);
    setError(null);
    try {
      await api.updateEvent(event.event_id, { open: !event.open });
      onChanged?.();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update the event.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setBusy(true);
    setError(null);
    try {
      await api.deleteEvent(target.event_id);
      setPendingDelete(null);
      onDeleted?.(target);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not delete the event.');
    } finally {
      setBusy(false);
    }
  }

  function itemsFor(event: Event): ActionMenuItem[] {
    return [
      {
        label: 'Edit',
        icon: Pencil,
        onSelect: () => navigate(path(ROUTES.adminEventEdit, { eventId: event.event_id })),
      },
      {
        label: 'View participants',
        icon: Users,
        onSelect: () => navigate(path(ROUTES.eventParticipation, { eventId: event.event_id })),
      },
      {
        label: event.open ? 'Close' : 'Reopen',
        icon: event.open ? Lock : LockOpen,
        onSelect: () => toggleOpen(event),
        disabled: busy,
      },
      {
        label: 'Delete',
        icon: Trash2,
        tone: 'danger',
        onSelect: () => setPendingDelete(event),
      },
    ];
  }

  const dialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Delete "${pendingDelete?.name}"?`}
      description="This also removes every participant's registration for this event. It cannot be undone."
      confirmLabel="Delete event"
      loading={busy}
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );

  return { itemsFor, toggleOpen, busy, error, dialog };
}
