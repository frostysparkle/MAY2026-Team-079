import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Pencil, ScanLine, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { ConfirmDialog, type ActionMenuItem } from '@/components/ui';

/**
 * What a Super Admin does to a workshop — edit it, scan attendance, open its
 * public page, delete it — in one place, so the dashboard grid offers the same
 * menu wherever it is reused. Mirrors `features/events/adminEventActions.tsx`.
 *
 * Deleting is confirmed: it drops the workshop and its registrations, which the
 * backend cannot undo.
 */
export function useAdminWorkshopActions({
  onDeleted,
}: {
  /** The workshop is gone; the grid reloads. */
  onDeleted?: (workshop: Workshop) => void;
} = {}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Workshop | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setBusy(true);
    setError(null);
    try {
      await api.deleteWorkshop(target.workshop_id);
      setPendingDelete(null);
      onDeleted?.(target);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not delete the workshop.');
    } finally {
      setBusy(false);
    }
  }

  function itemsFor(workshop: Workshop): ActionMenuItem[] {
    return [
      {
        label: 'Edit',
        icon: Pencil,
        onSelect: () =>
          navigate(path(ROUTES.adminWorkshopEdit, { workshopId: workshop.workshop_id })),
      },
      {
        label: 'Scan attendance',
        icon: ScanLine,
        onSelect: () => navigate(path(ROUTES.scanWorkshop, { workshopId: workshop.workshop_id })),
      },
      {
        label: 'View public page',
        icon: ExternalLink,
        onSelect: () =>
          navigate(path(ROUTES.publicWorkshopDetail, { workshopId: workshop.workshop_id })),
      },
      {
        label: 'Delete',
        icon: Trash2,
        tone: 'danger',
        onSelect: () => setPendingDelete(workshop),
        disabled: busy,
      },
    ];
  }

  const dialog = (
    <ConfirmDialog
      open={pendingDelete !== null}
      title={`Delete "${pendingDelete?.name}"?`}
      description="This also removes every participant's booking for this workshop. This cannot be undone."
      confirmLabel="Delete workshop"
      loading={busy}
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );

  return { itemsFor, dialog, error, busy };
}
