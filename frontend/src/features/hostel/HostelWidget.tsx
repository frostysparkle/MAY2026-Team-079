import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home, Phone } from 'lucide-react';
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
import { contactCountLabel, hostelContacts, telHref } from '@/features/stay/dutyContacts';

/** Rows shown inline before deferring the rest to Accommodation & Mess. */
const MAX_CONTACTS = 3;

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
    const contacts = hostelContacts(data);
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

        {/* The block's duty contacts, on the dashboard.
            `GET /hostels/my_hostel` masks these server-side to a name and a phone
            before they leave the backend, so what is shown here is already the
            disclosure the API decided on — and a resident who needs the warden at
            2am should not have to find a second screen first. Read through
            `hostelContacts`, which drops the rows the backend filled with the role
            word and the literal "N/A". Capped at three, with the rest on the Stay
            screen, so a large team cannot push the panel off the dashboard. */}
        {contacts.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
            {contacts.slice(0, MAX_CONTACTS).map((contact) => (
              <li key={`${contact.name}-${contact.phone}`} className="flex items-center gap-2">
                <Phone size={12} strokeWidth={2.5} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {contact.name}
                </span>
                {contact.phone && (
                  <a
                    href={telHref(contact.phone)}
                    className="shrink-0 text-xs font-semibold text-brand underline"
                  >
                    {contact.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {contacts.length === 0
              ? 'No duty contacts published for this block yet'
              : contacts.length > MAX_CONTACTS
                ? `${contacts.length - MAX_CONTACTS} more on duty`
                : contactCountLabel(contacts.length)}
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
