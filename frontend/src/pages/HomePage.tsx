import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarClock,
  CalendarDays,
  ChevronRight,
  QrCode,
  Ticket,
  User,
  Wrench,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, MyEventRegistration, Workshop } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import {
  Button,
  Card,
  IconTile,
  ResultBanner,
  SectionHeading,
  Skeleton,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { MessWidget } from '@/features/mess/MessWidget';
import { HostelWidget } from '@/features/hostel/HostelWidget';
import { useNow } from '@/features/schedule/useNow';

/**
 * Participant dashboard — the counterpart of `StaffHomePage`, built from the same
 * parts in the same order: a row of headline figures, then panels of rows that
 * flow into a CSS multi-column masonry on wide viewports and collapse to one
 * column below `md`.
 *
 * Section navigation is deliberately absent: `AppShell` renders the rail (and, on
 * a phone, the scrolling tab row) with the same links on every screen, so a panel
 * of them here would be a second copy that can only drift from the first. What
 * this page carries instead is *state* — what the participant is registered for,
 * what is next, and where their mess and hostel stand.
 */

/** One round of one event the participant is registered for. */
interface UpcomingRound {
  eventId: string;
  eventName: string;
  roundName: string;
  start: Date;
}

const timeFmt = (d: Date) =>
  d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

export default function HomePage() {
  const participant = currentParticipant();
  const navigate = useNavigate();
  const now = useNow();

  const [events, setEvents] = useState<Event[] | null>(null);
  const [registrations, setRegistrations] = useState<MyEventRegistration[] | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations(), api.listWorkshops()])
      .then(([allEvents, myRegistrations, allWorkshops]) => {
        setEvents(allEvents);
        setRegistrations(myRegistrations);
        setWorkshops(allWorkshops);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load your fest.'),
      );
  }
  useEffect(load, []);

  const loading = events === null || registrations === null;

  /** The events this participant holds a registration for. */
  const myEvents = useMemo(() => {
    if (!events || !registrations) return [];
    const registered = new Set(registrations.map((r) => r.event_id));
    return events.filter((e) => registered.has(e.event_id));
  }, [events, registrations]);

  /** Every future round across those events, soonest first. */
  const upcoming = useMemo<UpcomingRound[]>(() => {
    const rounds: UpcomingRound[] = [];
    for (const event of myEvents) {
      for (const round of event.schedule ?? []) {
        const start = new Date(round.start_time);
        if (Number.isNaN(start.getTime()) || start.getTime() < now) continue;
        rounds.push({
          eventId: event.event_id,
          eventName: event.name,
          roundName: round.name,
          start,
        });
      }
    }
    return rounds.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [myEvents, now]);

  const openCount = events?.filter((e) => e.open).length ?? 0;
  const seatsLeft =
    workshops?.reduce((sum, w) => sum + Math.max(0, w.capacity - w.registration_count), 0) ?? null;

  const firstName = participant?.full_name?.split(' ')[0] ?? null;

  return (
    <FestivalScreen
      title="Dashboard"
      // The house a participant belongs to is their equivalent of a staffer's
      // designation, which is what `StaffHomePage` puts here.
      eyebrow={participant?.house ?? 'Participant'}
      subtitle={firstName ? `Hi ${firstName} · ${participant?.email}` : participant?.email}
      actions={
        <>
          <Button onClick={() => navigate(ROUTES.myQr)} className="gap-1.5">
            <QrCode size={15} strokeWidth={2.5} /> My digital ID
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.events)} className="gap-1.5">
            <Ticket size={14} /> Browse events
          </Button>
        </>
      }
    >
      {/* Non-fatal on purpose: the mess and hostel panels below fetch separately
          and are still worth showing when the catalogue call is the one failing. */}
      {loadError && (
        <ResultBanner variant="warning" title="Some of your fest could not be loaded">
          {loadError}
        </ResultBanner>
      )}

      {/* ---- headline figures ---- */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Ticket}
            tone="brand"
            // Not "My Events": that is the heading of the panel listing them
            // below, and the same words twice on one screen read as one thing
            // said badly rather than as a figure and the list behind it.
            label="Events Registered"
            value={myEvents.length}
            footnote={
              myEvents.length === 0
                ? `${openCount} open to join`
                : `of ${events.length} on the programme`
            }
          />
          <StatCard
            icon={CalendarClock}
            tone="info"
            label="Rounds Ahead"
            value={upcoming.length}
            footnote={
              upcoming.length === 0 ? 'Nothing scheduled yet' : `Next ${timeFmt(upcoming[0].start)}`
            }
          />
          <StatCard
            icon={Wrench}
            tone="accent"
            label="Workshops"
            value={workshops?.length ?? '—'}
            footnote={
              seatsLeft === null
                ? 'Programme unavailable'
                : `${seatsLeft.toLocaleString()} seats left`
            }
          />
          <StatCard
            icon={QrCode}
            tone="success"
            label="Digital ID"
            value={participant ? 'Ready' : '—'}
            footnote={participant ? participant.id : 'Sign in again to generate it'}
          />
        </div>
      )}

      {/* Masonry: columns balance themselves, cards never split across them. */}
      <div className="gap-5 md:columns-2 xl:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        <Panel title="My Events" meta={loading ? undefined : `${myEvents.length}`}>
          {loading ? (
            <Skeleton className="h-20 w-full rounded-2xl" />
          ) : myEvents.length === 0 ? (
            <Card className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                You have not registered for anything yet. The catalogue is whatever the organisers
                have published.
              </p>
              <Link to={ROUTES.events} className="w-fit">
                <Button variant="secondary" className="gap-1.5">
                  <Ticket size={14} /> Browse events
                </Button>
              </Link>
            </Card>
          ) : (
            <>
              {myEvents.map((event) => {
                const registration = registrations?.find((r) => r.event_id === event.event_id);
                return (
                  <Link
                    key={event.event_id}
                    to={path(ROUTES.eventDetail, { eventId: event.event_id })}
                  >
                    <Card interactive className="flex items-center gap-3">
                      <IconTile icon={Ticket} tone="success" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{event.name}</p>
                        <p className="truncate text-xs text-muted">
                          {registration?.team_id
                            ? `Team ${registration.team_id} · ${registration.team_role}`
                            : 'Solo entry'}
                        </p>
                      </div>
                      {!event.open && <StatusBadge tone="neutral">Closed</StatusBadge>}
                      <ChevronRight size={18} className="shrink-0 text-muted" />
                    </Card>
                  </Link>
                );
              })}
              <Link to={ROUTES.myRegistrations} className="w-fit">
                <Button variant="ghost" size="sm">
                  See all registrations
                </Button>
              </Link>
            </>
          )}
        </Panel>

        {upcoming.length > 0 && (
          <Panel title="What's Next" meta={`${upcoming.length} rounds`}>
            {upcoming.slice(0, 5).map((round, i) => (
              <Link
                key={`${round.eventId}-${round.roundName}-${i}`}
                to={path(ROUTES.eventDetail, { eventId: round.eventId })}
              >
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={CalendarClock} tone="muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{round.eventName}</p>
                    <p className="truncate text-xs text-muted">
                      {round.roundName} · {timeFmt(round.start)}
                    </p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-muted" />
                </Card>
              </Link>
            ))}
            <Link to={ROUTES.schedule} className="w-fit">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <CalendarDays size={14} /> Full schedule
              </Button>
            </Link>
          </Panel>
        )}

        <Panel title="My Stay">
          <MessWidget />
          <HostelWidget />
        </Panel>

        <Panel title="My Pass">
          <Link to={ROUTES.myQr}>
            <Card interactive className="flex items-center gap-3">
              <IconTile icon={QrCode} />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">My Digital ID</p>
                <p className="text-xs text-muted">Show your QR at any checkpoint</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </Card>
          </Link>
          <Link to={ROUTES.profile}>
            <Card interactive className="flex items-center gap-3">
              <IconTile icon={User} tone="muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">My Profile</p>
                <p className="text-xs text-muted">View and edit your details</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </Card>
          </Link>
        </Panel>
      </div>
    </FestivalScreen>
  );
}

/** One titled block of rows — the same wrapper `StaffHomePage` uses. */
function Panel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={title} meta={meta} />
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
