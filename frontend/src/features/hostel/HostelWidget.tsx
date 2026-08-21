import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { MyHostelResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  Card,
  IconTile,
  Skeleton,
  StatusBadge,
} from '@/components/ui';

/**
 * Hostel panel for the participant dashboard.
 *
 * Covers the three states accommodation actually has, which the backend keeps on
 * two separate fields: not requested, requested but not yet allocated, and
 * allotted. Allocation itself is a batch the organisers run
 * (`POST /hostels/allocate`), and it only considers participants who have opted
 * in.
 *
 * Read-only on purpose. Opting in used to happen right here, on a button, but a
 * bed now costs a fee that has to be settled first, so the request is made once
 * on Accommodation & Mess and this panel reports it. Two places that can both
 * start a booking is two places that can disagree about whether one is paid for.
 *
 * Same surface and header vocabulary as `MessWidget` and as the admin panels, so
 * the dashboard reads as one set of panels rather than a pile of unlike cards.
 */
export function HostelWidget() {
  const [data, setData] = useState<MyHostelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (error) return <PanelNote>{error}</PanelNote>;

  if (data?.assigned_hostel) {
    return (
      // `Card`, as in `MessWidget` — both used to retype `Card`'s own surface.
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <IconTile icon={Home} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{data.assigned_hostel}</p>
            <p className="text-xs text-muted">Room {data.room ?? '—'}</p>
          </div>
          <StatusBadge tone={data.logged_in ? 'success' : 'neutral'}>
            {data.logged_in ? 'Inside' : 'Outside'}
          </StatusBadge>
        </div>

        {/* Count only. `volunteers` carries names and phone numbers, and this panel
            has never shown them; surfacing staff contact details is a disclosure
            decision, not a styling one — Accommodation & Mess is where the block's
            details belong. */}
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {data.volunteers.length} contact{data.volunteers.length === 1 ? '' : 's'} on duty
          </p>
          <Link to={ROUTES.accommodation} className="w-fit">
            <Button variant="ghost" size="sm">
              Details
              <ChevronRight size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} />
            </Button>
          </Link>
        </div>
      </Card>
    );
  }

  const requested = data?.registered ?? false;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={Home} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
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

      <div className="border-t border-line pt-3">
        <Link to={ROUTES.accommodation} className="w-fit">
          <Button variant={requested ? 'ghost' : 'primary'} size="sm">
            {requested ? 'View or change' : 'Book accommodation'}
            <ChevronRight size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} />
          </Button>
        </Link>
      </div>
    </Card>
  );
}

/** A panel-shaped line for the cases with no figures to show. */
function PanelNote({ children }: { children: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">{children}</p>
    </Card>
  );
}
