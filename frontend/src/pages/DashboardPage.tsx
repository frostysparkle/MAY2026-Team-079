import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BedDouble,
  CalendarClock,
  CalendarDays,
  LifeBuoy,
  MessagesSquare,
  Phone,
  QrCode,
  RefreshCw,
  Ticket,
  User,
  Wrench,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, Issue, MyEventRegistration, QueryRecord, Workshop } from '@/api/types';
import { path, ROUTES, supportPath } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  Card,
  CardRow,
  ProgressBar,
  ResultBanner,
  SectionBlock,
  Skeleton,
  StatCard,
  StatGrid,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { EntryQrCard } from '@/features/qr/EntryQrCard';
import { QR_REFRESH_SECONDS, useLiveQr } from '@/features/qr/useLiveQr';
import { PanelMasonry } from '@/components/layout/PanelMasonry';
import { MessWidget } from '@/features/mess/MessWidget';
import { HostelWidget } from '@/features/hostel/HostelWidget';
import { useNow } from '@/features/schedule/useNow';
import { EventChangeAlerts } from '@/features/events/EventChangeAlerts';
import { AnnouncementFeed } from '@/features/announcements/AnnouncementFeed';
import { useAnnouncementInbox } from '@/features/announcements/useAnnouncementInbox';
import {
  dismissAllEventChanges,
  dismissEventChange,
  syncEventChanges,
  type EventChange,
} from '@/features/events/eventChanges';
import {
  EMPTY_SUPPORT_COUNTS,
  supportCounts,
  type SupportCounts,
} from '@/features/support/supportCounts';

/**
 * Participant dashboard — the counterpart of `StaffHomePage`, built from the same
 * parts in the same order: a row of headline figures, then panels of rows that
 * flow into a CSS multi-column masonry on wide viewports and collapse to one
 * column below `md`.
 *
 * Section navigation is deliberately absent: the Landing Page at `ROUTES.home`
 * lists the participant's sections around the wordmark, and `AppShell` repeats
 * them on the rail (and, on a phone, the scrolling tab row) on every screen — so
 * a panel of them here would be a third copy that can only drift from the other
 * two. What this page carries instead is *state* — what the participant is
 * registered for, what is next, and where their mess and hostel stand.
 *
 * It used to be the `/app` index, which meant signing in dropped a student onto a
 * figures screen instead of the landing they had been using all along. The
 * Landing Page is the index now and this lives at `ROUTES.dashboard`, one
 * section entry away.
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

export default function DashboardPage() {
  const participant = currentParticipant();
  const navigate = useNavigate();
  const now = useNow();

  const [events, setEvents] = useState<Event[] | null>(null);
  const [registrations, setRegistrations] = useState<MyEventRegistration[] | null>(null);
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [changes, setChanges] = useState<EventChange[]>([]);
  /**
   * Announcements addressed to this participant. Self-fetching rather than fed
   * from this page's loader, because the audience rules need the block and hall
   * allocations that the dashboard does not otherwise read.
   */
  const inbox = useAnnouncementInbox();
  /**
   * How much of this participant's Help & Support is still open.
   *
   * Kept out of `load` and deliberately non-fatal on both halves: the panel below
   * is a signpost, and a dashboard that failed to render because a support count
   * could not be fetched would be a worse trade than a signpost reading zero.
   */
  const [support, setSupport] = useState<SupportCounts>(EMPTY_SUPPORT_COUNTS);

  const participantId = participant?.id ?? '';

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    void Promise.all([
      api.myQueries().catch(() => [] as QueryRecord[]),
      api
        .myIssues()
        .then((r) => r.issues ?? [])
        .catch(() => [] as Issue[]),
    ]).then(([queries, issues]) => setSupport(supportCounts(queries, issues)));

    Promise.all([api.listEvents(), api.myEventRegistrations(), api.listWorkshops()])
      .then(([allEvents, myRegistrations, allWorkshops]) => {
        setEvents(allEvents);
        setRegistrations(myRegistrations);
        setWorkshops(allWorkshops);
        setLoadError(null);
        // Story 1.2 — diffed against what this device last saw, on the data the
        // page has just fetched, so no extra request is made for it. The id is
        // read here rather than closed over so this stays a mount-only effect.
        setChanges(syncEventChanges(currentParticipant()?.id ?? '', allEvents, myRegistrations));
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
          <Button onClick={() => navigate(ROUTES.myQr)}>
            <QrCode size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> My digital ID
          </Button>
          <Button variant="secondary" onClick={() => navigate(ROUTES.events)}>
            <Ticket size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Browse events
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

      {/* Above the figures on purpose: a venue change is only worth anything
          before the participant has set off. */}
      <EventChangeAlerts
        changes={changes}
        onDismiss={(id) => setChanges(dismissEventChange(participantId, id))}
        onDismissAll={() => setChanges(dismissAllEventChanges(participantId))}
      />

      {/* Official notices, same reasoning and the same place. Capped at three
          with a link to the rest, so a busy noticeboard cannot push the figures
          off the screen — Stories 8.1/8.2. */}
      <AnnouncementFeed
        announcements={inbox.announcements}
        names={inbox.names}
        onDismiss={inbox.dismiss}
        onDismissAll={inbox.dismissAll}
        limit={3}
        moreTo={ROUTES.announcements}
      />

      {/* ---- headline figures ----
          `StatGrid` owns both the grid and its placeholder row, so the loading
          state cannot use a different one from the loaded state — which is what
          the two hand-written copies here risked. */}
      <StatGrid loading={loading}>
        <StatCard
          icon={Ticket}
          tone="brand"
          // Not "My Events": that is the heading of the panel listing them
          // below, and the same words twice on one screen read as one thing
          // said badly rather than as a figure and the list behind it.
          label="Events Registered"
          value={myEvents.length}
          // `events` is non-null by the time this row is on screen, but JSX
          // children are built eagerly, so `StatGrid`'s loading branch still
          // evaluates this. Read it optionally rather than asserting.
          footnote={
            myEvents.length === 0
              ? `${openCount} open to join`
              : `of ${events?.length ?? 0} on the programme`
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
      </StatGrid>

      {/* Masonry: columns balance themselves, cards never split across them.
          Shared with Profile and the staff home through `PanelMasonry`. */}
      <PanelMasonry>
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
                <Button variant="secondary">
                  <Ticket size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Browse events
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
                    <CardRow
                      icon={Ticket}
                      tone="success"
                      title={event.name}
                      subtitle={
                        registration?.team_id
                          ? `Team ${registration.team_id} · ${registration.team_role}`
                          : 'Solo entry'
                      }
                      trailing={!event.open && <StatusBadge tone="neutral">Closed</StatusBadge>}
                    />
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
                <CardRow
                  icon={CalendarClock}
                  tone="muted"
                  title={round.eventName}
                  subtitle={`${round.roundName} · ${timeFmt(round.start)}`}
                />
              </Link>
            ))}
            <Link to={ROUTES.schedule} className="w-fit">
              <Button variant="ghost" size="sm">
                <CalendarDays size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> Full
                schedule
              </Button>
            </Link>
          </Panel>
        )}

        <Panel title="Accommodation & Mess">
          <MessWidget />
          <HostelWidget />
          <Link to={ROUTES.accommodation} className="w-fit">
            {/* The panel heading now names the section, so the button says what
                the tap does rather than repeating it. */}
            <Button variant="ghost" size="sm">
              <BedDouble size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> Manage my stay
            </Button>
          </Link>
        </Panel>

        {/* Help & Support had no presence on this screen at all while it was three
            separate routes, which is part of why students reported it as missing:
            the dashboard is where they look to find out what is going on with
            their own fest, and "am I waiting on anybody" was not answerable here.
            Each row opens the tab that answers it. */}
        <Panel
          title="Help & Support"
          meta={
            support.openQuestions + support.openReports > 0
              ? `${support.openQuestions + support.openReports} open`
              : undefined
          }
        >
          <Link to={supportPath('ask')}>
            <CardRow
              icon={MessagesSquare}
              tone="brand"
              title="Ask a question"
              subtitle={
                support.openQuestions > 0
                  ? `${support.openQuestions} open${support.awaitingReply > 0 ? ` · ${support.awaitingReply} awaiting a reply` : ''}`
                  : 'About an event, a workshop, your block, or your hall'
              }
            />
          </Link>
          <Link to={supportPath('report')}>
            <CardRow
              icon={Wrench}
              tone="warning"
              title="Report a problem"
              subtitle={
                support.openReports > 0
                  ? `${support.openReports} open with the duty team`
                  : 'Something broken in your room or mess hall'
              }
            />
          </Link>
          <Link to={supportPath('contacts')}>
            <CardRow
              icon={Phone}
              tone="muted"
              title="Who to call"
              subtitle="Coordinators on duty across the fest"
            />
          </Link>
          <Link to={ROUTES.support} className="w-fit">
            <Button variant="ghost" size="sm">
              <LifeBuoy size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> All my questions
              and reports
            </Button>
          </Link>
        </Panel>

        <Panel title="My Pass">
          {/* The live pass itself, on the dashboard the guide names — not just a
              link to it. Smaller than the full-screen card on My QR, since this is
              a glance rather than the thing being held up at a gate, but the same
              component encrypting the same payload on the same 45 s cycle, with
              the countdown beside it so a participant can see it is current. */}
          <QrPass />
          <Link to={ROUTES.myQr}>
            <CardRow
              icon={QrCode}
              title="Open full screen"
              subtitle="Bigger code, easier to scan at a checkpoint"
            />
          </Link>
          <Link to={ROUTES.profile}>
            <CardRow
              icon={User}
              tone="muted"
              title="My Profile"
              subtitle="View and edit your details"
            />
          </Link>
        </Panel>
      </PanelMasonry>
    </FestivalScreen>
  );
}

/**
 * One titled block of rows.
 *
 * A thin wrapper over the shared `SectionBlock` rather than its own `<section>`,
 * which is what this and `StaffHomePage` each had: both sat their rows 3 units
 * under the heading and 2 apart, where every other headed block in the app —
 * every `DetailPanel`, every poster grid — uses 4 and 3. On a masonry that can put
 * a dashboard panel beside a `DetailPanel`, a half-step difference in heading gap
 * is visible as misalignment. The rows keep a tighter gap than the heading, which
 * is what makes them read as one list rather than as separate cards.
 */
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
    <SectionBlock title={title} meta={meta}>
      <div className="flex flex-col gap-3">{children}</div>
    </SectionBlock>
  );
}

/**
 * The participant's live entry pass, inline on the dashboard.
 *
 * A component of its own so `useLiveQr`'s timers mount and unmount with the panel
 * rather than with the whole page, and so the dashboard's own data loading is not
 * re-rendered by the one-second countdown tick.
 *
 * `EntryQrCard` and the countdown are the same ones My QR uses — one encryption
 * cycle, one refresh window, one visual object. The card is smaller here because
 * this is a glance; the row underneath opens the full-screen version for actually
 * presenting at a gate.
 */
function QrPass() {
  const qr = useLiveQr();

  return (
    <div className="flex flex-col gap-2">
      <EntryQrCard qr={qr} size={150} />
      {qr.status === 'ready' && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-2 text-xs tabular-nums text-muted">
            <span className="flex items-center gap-1.5">
              <RefreshCw size={11} strokeWidth={2.5} aria-hidden /> Refreshes automatically
            </span>
            <span>in {qr.secondsRemaining}s</span>
          </span>
          <ProgressBar
            value={qr.secondsRemaining}
            max={QR_REFRESH_SECONDS}
            label="Seconds until this QR code refreshes"
          />
        </div>
      )}
    </div>
  );
}
