import { useEffect, useState } from 'react';
import { Home } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { MyHostelResponse } from '@/api/types';
import { Button, IconTile, Skeleton, StatusBadge } from '@/components/ui';

/**
 * Hostel panel for the participant dashboard.
 *
 * Covers the three states accommodation actually has, which the backend keeps on
 * two separate fields: not requested, requested but not yet allocated, and
 * allotted. Allocation itself is a batch the organisers run
 * (`POST /hostels/allocate`), and it only considers participants who have opted
 * in — so asking for a place is the participant's half of that, and this panel
 * is where it happens.
 *
 * Same surface and header vocabulary as `MessWidget` and as the admin panels, so
 * the dashboard reads as one set of panels rather than a pile of unlike cards.
 */
export function HostelWidget() {
  const [data, setData] = useState<MyHostelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .myHostel()
      .then((res) => !cancelled && setData(res))
      .catch(
        (e) =>
          !cancelled &&
          setError(e instanceof ApiClientError ? e.message : 'Could not load hostel status.'),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      // Re-read rather than patching local state: allocation may have run
      // between load and click, and the server's answer is the real one.
      setData(await api.myHostel());
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.message : 'Could not update your accommodation request.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (error) return <PanelNote>{error}</PanelNote>;

  if (data?.assigned_hostel) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <div className="flex items-center gap-3">
          <IconTile icon={Home} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-ink">{data.assigned_hostel}</p>
            <p className="text-xs text-muted">Room {data.room ?? '—'}</p>
          </div>
          <StatusBadge tone={data.logged_in ? 'success' : 'neutral'}>
            {data.logged_in ? 'Inside' : 'Outside'}
          </StatusBadge>
        </div>

        {/* Count only. `volunteers` carries names and phone numbers, and this panel
            has never shown them; surfacing staff contact details is a disclosure
            decision, not a styling one. */}
        <p className="border-t border-line pt-3 text-xs text-muted">
          {data.volunteers.length} contact{data.volunteers.length === 1 ? '' : 's'} on duty
        </p>
      </div>
    );
  }

  const requested = data?.registered ?? false;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
      <div className="flex items-center gap-3">
        <IconTile icon={Home} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">
            {requested ? 'Accommodation requested' : 'Stay on campus'}
          </p>
          <p className="text-xs text-muted">
            {requested
              ? 'Your room appears here once the organisers run allocation.'
              : 'Book a hostel place for the days of Paradox.'}
          </p>
        </div>
        {requested && <StatusBadge tone="warning">Pending</StatusBadge>}
      </div>

      {actionError && <p className="text-xs font-medium text-danger">{actionError}</p>}

      <div className="border-t border-line pt-3">
        {requested ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => api.cancelAccommodationRequest())}
          >
            {busy ? 'Working…' : 'Withdraw request'}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => api.registerForAccommodation())}
          >
            {busy ? 'Requesting…' : 'Book accommodation'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A panel-shaped line for the cases with no figures to show. */
function PanelNote({ children }: { children: string }) {
  return (
    <p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-card ring-1 ring-black/[0.03]">
      {children}
    </p>
  );
}
