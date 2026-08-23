import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Home,
  MessageSquareWarning,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/api';
import type { Event, Hostel, Mess, Workshop } from '@/api/types';
import { path, ROUTES, staffSupportPath } from '@/config/routes';
import { currentStaff, isSuperAdmin, isUhc, isDomainAdminFor } from '@/stores/authStore';
import { eventTeamRoleLabel, eventTeamRoleOf, isEventHeadRole } from '@/features/events/eventTeam';
import {
  EventParticipationActions,
  EventParticipationView,
} from '@/features/events/EventParticipationView';
import { useEventParticipation } from '@/features/events/useEventParticipation';
import { EventAnnouncementsPanel } from '@/features/events/EventAnnouncementsPanel';
import { useEventAnnouncements } from '@/features/events/useEventAnnouncements';
import { workshopRoleLabel } from '@/features/workshops/workshopTeam';
import {
  attendanceState,
  loggingState,
  mayOpenScanner,
  SCANNING_OFF_NOTE,
  type DutyScanState,
} from '@/features/staff/dutyScanning';
import {
  Button,
  Card,
  ErrorState,
  IconTile,
  SectionBlock,
  Spinner,
  StatusBadge,
  TextInput,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { PanelMasonry } from '@/components/layout/PanelMasonry';

/**
 * Staff dashboard. Every card is computed from live entity lists, not from a
 * static role hierarchy — a mess, hostel, event, or workshop team member is
 * discovered by checking `session.id` against each entity's team array after
 * fetching it.
 *
 * Section navigation is deliberately absent: the Landing Page at
 * `ROUTES.staffHome` lists this staffer's sections around the wordmark, and
 * `StaffShell` repeats them on the rail (and, on a phone, the scrolling tab row)
 * on every screen, so a panel of them here would be a third copy that can only
 * drift from the other two.
 *
 * It used to be `/staff` itself. It now lives at `ROUTES.staffDuties`, reached as
 * the Dashboard section of the staff landing — the four scanner screens come back
 * here, not to the landing, because it is the page that names which mess, hostel,
 * event, or workshop was theirs to scan. The route id still says `duties`; the
 * label everywhere a person reads it says Dashboard, matching this screen's own
 * title.
 *
 * The sections flow into a CSS multi-column masonry on wide viewports, so a
 * staffer with several duties sees them side by side instead of as one long
 * phone-width scroll. Below `md` it collapses to a single column.
 */
export default function StaffHomePage() {
  const staff = currentStaff();
  const navigate = useNavigate();
  const [mess, setMess] = useState<Mess[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [workshopId, setWorkshopId] = useState('');

  useEffect(() => {
    api
      .listMess()
      .then(setMess)
      .catch(() => undefined);
    api
      .listHostels()
      .then(setHostels)
      .catch(() => undefined);
    api
      .listEvents()
      .then(setEvents)
      .catch(() => undefined);
    api
      .listWorkshops()
      .then(setWorkshops)
      .catch(() => setWorkshops([]));
  }, []);

  const myMess = mess.filter((m) => m.mess_team?.some((t) => t.user_id === staff?.id));
  const myHostels = hostels.filter((h) => h.hostel_team?.some((t) => t.user_id === staff?.id));
  const myEventTeams = events.filter((e) => e.event_team.some((t) => t.user_id === staff?.id));
  // Events this staffer oversees without working on them. Their own events are
  // excluded because the duty card above now leads to the same roster, and the
  // page used to list a domain admin's own event twice, under two headings, with
  // two different labels for one screen.
  const participationEvents = events.filter(
    (e) =>
      (isUhc() || isDomainAdminFor(e.event_type) || isSuperAdmin()) &&
      !myEventTeams.some((mine) => mine.event_id === e.event_id),
  );

  // `GET /workshops` strips `workshop_team` for non-super-admin callers, so
  // whether the assignment can be derived depends on who is asking. When the field
  // is present on any record it is readable and the duty cards below are the whole
  // truth; when it is absent from every record the caller simply cannot see their
  // own assignment, and the manual entry is the only way to the scanner.
  const loadedWorkshops = workshops ?? [];
  const workshopTeamsReadable = loadedWorkshops.some((w) => w.workshop_team !== undefined);
  const myWorkshops = loadedWorkshops.filter((w) =>
    w.workshop_team?.some((t) => t.user_id === staff?.id),
  );

  // …but "cannot read the field" is not the same as "might have a workshop". Event
  // staff have no workshop to open, and the fallback was appearing for them too —
  // an Event Head for one event was being offered a workshop desk they can never
  // reach, since `POST /workshops/{id}/scan` checks `workshop_team` membership.
  //
  // Two signals say "event staff, not workshop staff", and neither depends on the
  // projected-out field:
  //   * `department === 'events'` — exactly what the admin Event section stamps on
  //     every account it mints for an Event Head, Event Member, or Volunteer
  //     (`EventTeamPanel.createAndAssign`), so accounts created there never see it.
  //   * being named on an `event_team` — `GET /events` keeps `event_team` for every
  //     caller, so this is readable where the workshop equivalent is not. It covers
  //     event staff who pre-dated the panel or were assigned from the Staff screen
  //     under some other department.
  //
  // `department === 'workshops'` (what `WorkshopTeamPanel` stamps) wins over both,
  // so somebody genuinely working a workshop keeps their only route to the scanner
  // even if they also help run an event.
  const department = (staff?.department ?? '').trim().toLowerCase();
  const worksWorkshops = department === 'workshops';
  const isEventStaff = department === 'events' || myEventTeams.length > 0;
  const needsWorkshopIdEntry =
    workshops !== null && !workshopTeamsReadable && (worksWorkshops || !isEventStaff);

  return (
    <FestivalScreen
      title="Dashboard"
      eyebrow={staff?.designation ?? 'Staff'}
      subtitle={staff?.email}
    >
      {/* Masonry: columns balance themselves, cards never split across them. */}
      <PanelMasonry>
        {(myMess.length > 0 || myHostels.length > 0 || myWorkshops.length > 0) && (
          <Panel title="My Duties">
            {/* The scanner link is withheld when this staffer's `logging` flag is
                off: the card used to lead to a screen whose only content was
                "Scanning disabled for you", which is a click spent learning
                something the duty list already knew. */}
            {myMess.map((m) => (
              <ScanDutyCard
                key={m.mess_id}
                icon={UtensilsCrossed}
                tone="warning"
                label={`Scan for ${m.name}`}
                to={path(ROUTES.scanMess, { messId: m.mess_id })}
                state={loggingState(m.mess_team?.find((t) => t.user_id === staff?.id))}
              />
            ))}
            {/* The menu desk sits beside the scanner rather than inside it: a
                volunteer setting up the day's dishes is not mid-scan, and the
                scanner is a full-screen camera with nowhere to put a form. */}
            {myMess.map((m) => (
              <Link key={`menu-${m.mess_id}`} to={path(ROUTES.messMenu, { messId: m.mess_id })}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={BookOpen} tone="warning" />
                  <span className="flex-1 font-medium text-ink">Menu for {m.name}</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
            ))}
            {myHostels.map((h) => (
              <ScanDutyCard
                key={h.hostel_id}
                icon={Home}
                label={`Scan for ${h.name}`}
                to={path(ROUTES.scanHostel, { hostelId: h.hostel_id })}
                // Hostel team entries carry `attendance`, not `logging` — see
                // `HostelTeamMember`. Mess still uses `loggingState`.
                state={attendanceState(h.hostel_team?.find((t) => t.user_id === staff?.id))}
              />
            ))}
            {/* Story 5.4. One card rather than one per facility: `GET /issues`
                already returns every block and hall this staffer is on in a
                single scoped queue, so splitting it per place would mean
                checking three screens to find the one report waiting.

                Points at the Faults tab of Support, which is where that queue
                now lives. Still gated on actually being on a block or hall team,
                because this is a duty list and a card here is a claim that
                something is yours — the section itself stays in the rail for
                everyone, since `GET /issues` answers an empty list rather than a
                403 for a staffer on neither. */}
            {(myMess.length > 0 || myHostels.length > 0) && (
              <Link to={staffSupportPath('faults')}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={MessageSquareWarning} tone="danger" />
                  <span className="flex-1 font-medium text-ink">Reported issues</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
            )}
            {/* A workshop duty is three destinations, not one: the desk that
                reports who came, and the two scanners that get them there. The
                mess and hostel duties above stay single links because they have
                one scanner and no roster to read. */}
            {myWorkshops.map((w) => (
              <Card key={w.workshop_id}>
                <div className="flex items-center gap-3">
                  <IconTile icon={Wrench} tone="muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{w.name}</p>
                    <p className="truncate text-xs text-muted">
                      {workshopRoleLabel(
                        w.workshop_team?.find((t) => t.user_id === staff?.id)?.role,
                      )}
                      {' · '}
                      {w.venue}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {/* The desk stays open whatever the flag says — attendance
                      figures and the exports are not scanning. Only the two
                      scanners go, and only on a definite `false`. */}
                  <Link to={path(ROUTES.workshopManage, { workshopId: w.workshop_id })}>
                    <Button variant="secondary">Workshop desk</Button>
                  </Link>
                  {mayOpenScanner(
                    attendanceState(w.workshop_team?.find((t) => t.user_id === staff?.id)),
                  ) ? (
                    <>
                      <Link to={path(ROUTES.scanWorkshop, { workshopId: w.workshop_id })}>
                        <Button variant="secondary">Scan registered</Button>
                      </Link>
                      <Link to={path(ROUTES.scanWorkshopOnSpot, { workshopId: w.workshop_id })}>
                        <Button variant="ghost">On-spot</Button>
                      </Link>
                    </>
                  ) : (
                    <StatusBadge tone="neutral">Scanning off</StatusBadge>
                  )}
                </div>
              </Card>
            ))}
          </Panel>
        )}

        {/* Only for workshop-side callers whose `workshop_team` was stripped:
            without it a volunteer cannot self-discover their assignment, so typing
            the id is the one remaining way in. Anyone who can read the field gets
            real duty cards above instead, and event staff never see it at all —
            see `needsWorkshopIdEntry`. */}
        {needsWorkshopIdEntry && (
          <Panel title="Open a Workshop">
            <Card className="flex flex-col gap-3">
              <div className="flex items-end gap-2">
                <IconTile icon={Wrench} tone="muted" className="mb-1" />
                <div className="flex-1">
                  <TextInput
                    label="Workshop ID"
                    value={workshopId}
                    onChange={(e) => setWorkshopId(e.target.value)}
                    placeholder="e.g. workshop-02"
                  />
                </div>
              </div>
              {/* The desk first: it names the workshop, reports the attendance,
                  and links to both scanners — so a mistyped id fails there
                  rather than in front of a queue. */}
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!workshopId.trim()}
                  onClick={() =>
                    navigate(path(ROUTES.workshopManage, { workshopId: workshopId.trim() }))
                  }
                >
                  Workshop desk
                </Button>
                <Button
                  variant="secondary"
                  disabled={!workshopId.trim()}
                  onClick={() =>
                    navigate(path(ROUTES.scanWorkshop, { workshopId: workshopId.trim() }))
                  }
                >
                  Scan registered
                </Button>
                <Button
                  variant="ghost"
                  disabled={!workshopId.trim()}
                  onClick={() =>
                    navigate(path(ROUTES.scanWorkshopOnSpot, { workshopId: workshopId.trim() }))
                  }
                >
                  On-spot
                </Button>
              </div>
            </Card>
          </Panel>
        )}

        {participationEvents.length > 0 && (
          <Panel title="Participation & Reports">
            {participationEvents.map((e) => (
              <Link key={e.event_id} to={path(ROUTES.eventParticipation, { eventId: e.event_id })}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={BarChart3} />
                  <span className="flex-1 font-medium text-ink">{e.name}</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
            ))}
          </Panel>
        )}
      </PanelMasonry>

      {/* The events this staffer works, each showing its registration roster in
          full rather than a card that links to one.
          This was a "My Event Duties" panel of one card per event: a role badge and
          three buttons, the first of which went to exactly the content now rendered
          here. For an event head that card was the whole dashboard, and every visit
          to it ended in the same click.

          Outside the masonry on purpose. The panels above are phone-width rows that
          balance across columns; this is a full screen's worth of stat cards, charts
          and a two-column roster, and it needs the page's width. Below them for the
          same reason: a staffer with a mess hall and an event keeps their compact
          scan cards at the top, while an event head — who has none of those panels —
          sees this first anyway. */}
      {myEventTeams.map((e) => (
        <EventDutySection key={e.event_id} event={e} staffId={staff?.id} />
      ))}
    </FestivalScreen>
  );
}

/**
 * One titled block of rows.
 *
 * The same shared `SectionBlock` the participant dashboard's `Panel` delegates to.
 * These two screens are documented as mirrors of each other — "the counterpart of
 * `StaffHomePage`, built from the same parts in the same order" — and both had
 * written this wrapper out themselves at a heading gap of 3 and a row gap of 2,
 * where every `DetailPanel` and every poster grid in the app uses 4 and 3. Moving
 * only the participant one onto the shared wrapper would have made the mirror
 * false, so both move.
 */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SectionBlock title={title}>
      <div className="flex flex-col gap-3">{children}</div>
    </SectionBlock>
  );
}

/**
 * One event this staffer works, shown as its registration roster rather than as a
 * card that links to one.
 *
 * The same body `EventParticipationPage` renders, from the same
 * `GET /events/{id}/participation` call — `EventParticipationView`, so the two
 * cannot drift into a full version and a summary. Headed "Participants" to match
 * that screen's title, which is what the event-name row inside the view is
 * positioned directly below.
 *
 * The endpoint authorises *any* `event_team` member (`is_event_team` in
 * `view_participation`), so every role on the event gets this, not just a head. It
 * used to be reachable from this page only through the "Participation & Reports"
 * panel, which is filtered to UHC, domain admins, and Super Admins — an event head
 * could scan their event and allocate its teams while having no way in the app to
 * read who had registered.
 *
 * Actions, and which of them are gated:
 *
 *   - the two exports and the attendance scanner come from
 *     `EventParticipationActions`, unchanged from the full screen and ungated,
 *   - Allocate / Edit Teams is an Event Head's alone. `POST /events/{id}/allocate_teams`
 *     and `PUT /events/{id}/participant_teams/{pid}` check
 *     `event_team[].role === 'event_head'` and refuse everyone else, Super Admins
 *     included, so the button appears for a head and nobody else rather than being
 *     offered and certain to 403.
 *
 * The staffer's own role rides along as a badge in the event-name row, which is
 * where the retired duty card carried it.
 */
function EventDutySection({ event, staffId }: { event: Event; staffId: string | undefined }) {
  const { data, error } = useEventParticipation(event.event_id);
  const role = eventTeamRoleOf(event.event_team, staffId);
  const head = isEventHeadRole(role);
  // Story 8.2. `POST /events/{id}/announcements` refuses everybody but this
  // event's own Event Head and a Super Admin — a plain member or volunteer
  // still sees the list, with no compose control they could not use anyway.
  // `isSuperAdmin()` is included on top of `head` because a Super Admin can
  // show up in this section too if they are also named on the event's own
  // team, just not necessarily as its head.
  const announcements = useEventAnnouncements(event.event_id);
  const canPublish = head || isSuperAdmin();

  return (
    <>
      <SectionBlock
        title="Participants"
        meta={data ? `${data.count} registered` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data && (
              <EventParticipationActions eventId={event.event_id} event={event} data={data} />
            )}
            {head && (
              <Link to={path(ROUTES.eventTeams, { eventId: event.event_id })}>
                <Button variant="ghost">Allocate / Edit Teams</Button>
              </Link>
            )}
          </div>
        }
      >
        {error ? (
          <ErrorState title="Could not load participation" description={error} />
        ) : !data ? (
          <Card className="flex h-40 items-center justify-center">
            <Spinner label={`Loading ${event.name}`} />
          </Card>
        ) : (
          <EventParticipationView
            eventId={event.event_id}
            event={event}
            data={data}
            badges={
              <StatusBadge tone={head ? 'info' : 'neutral'}>{eventTeamRoleLabel(role)}</StatusBadge>
            }
          />
        )}
      </SectionBlock>

      <EventAnnouncementsPanel state={announcements} canPublish={canPublish} />
    </>
  );
}

/**
 * One "Scan for X" duty, which is a link only while scanning is actually live.
 *
 * A definite `off` renders the same card without the link and with the reason on
 * it, so the duty stays visible — the person is still on that team, and for a
 * mess the menu desk beside this card still works — while the dead end goes.
 * `unknown` keeps the link: the flag is not readable from every account, and the
 * scanner screen re-checks and explains it either way.
 */
function ScanDutyCard({
  icon,
  tone,
  label,
  to,
  state,
}: {
  icon: LucideIcon;
  tone?: 'brand' | 'warning';
  label: string;
  to: string;
  state: DutyScanState;
}) {
  if (!mayOpenScanner(state)) {
    return (
      <Card className="flex items-start gap-3">
        <IconTile icon={icon} tone="muted" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-muted">{label}</p>
          <p className="text-xs text-muted">{SCANNING_OFF_NOTE}</p>
        </div>
        <StatusBadge tone="neutral">Scanning off</StatusBadge>
      </Card>
    );
  }

  return (
    <Link to={to}>
      <Card interactive className="flex items-center gap-3">
        <IconTile icon={icon} tone={tone} />
        <span className="flex-1 font-medium text-ink">{label}</span>
        <ChevronRight size={18} className="text-muted" />
      </Card>
    </Link>
  );
}
