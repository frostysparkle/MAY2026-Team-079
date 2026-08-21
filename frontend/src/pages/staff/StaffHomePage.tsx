import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Home,
  MessageSquareWarning,
  Ticket,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import { api } from '@/api';
import type { Event, Hostel, Mess, Workshop } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { currentStaff, isSuperAdmin, isUhc, isDomainAdminFor } from '@/stores/authStore';
import { workshopRoleLabel } from '@/features/workshops/workshopTeam';
import { Button, Card, IconTile, SectionBlock, TextInput } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { PanelMasonry } from '@/components/layout/PanelMasonry';
import { AnnouncementFeed } from '@/features/announcements/AnnouncementFeed';
import { useAnnouncementInbox } from '@/features/announcements/useAnnouncementInbox';

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
 * the Duties section of the staff landing — the four scanner screens come back
 * here, not to the landing, because it is the page that names which mess, hostel,
 * event, or workshop was theirs to scan.
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
  /** Announcements for this staffer's teams — see the panel comment below. */
  const inbox = useAnnouncementInbox();

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
  const myEventHeadEvents = events.filter((e) =>
    e.event_team.some((t) => t.user_id === staff?.id && t.role === 'event_head'),
  );
  const participationEvents = events.filter(
    (e) => isUhc() || isDomainAdminFor(e.event_type) || isSuperAdmin(),
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
  const needsWorkshopIdEntry = workshops !== null && !workshopTeamsReadable;

  return (
    <FestivalScreen
      title="Dashboard"
      eyebrow={staff?.designation ?? 'Staff'}
      subtitle={staff?.email}
    >
      {/* Announcements addressed to this staffer — Epic 8's "between teams" half.
          Above the duty cards, and outside the masonry, because one telling a
          volunteer their gate has moved has to be read before the gate is. Which
          teams name them is worked out from the team arrays the catalogue
          endpoints already return; see `staffReader`. */}
      <AnnouncementFeed
        announcements={inbox.announcements}
        names={inbox.names}
        onDismiss={inbox.dismiss}
        onDismissAll={inbox.dismissAll}
        limit={4}
        heading={
          inbox.announcements.length === 1
            ? 'One announcement for your team'
            : `${inbox.announcements.length} announcements for your teams`
        }
      />

      {/* Masonry: columns balance themselves, cards never split across them. */}
      <PanelMasonry>
        {(myMess.length > 0 || myHostels.length > 0 || myWorkshops.length > 0) && (
          <Panel title="My Duties">
            {myMess.map((m) => (
              <Link key={m.mess_id} to={path(ROUTES.scanMess, { messId: m.mess_id })}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={UtensilsCrossed} tone="warning" />
                  <span className="flex-1 font-medium text-ink">Scan for {m.name}</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
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
              <Link key={h.hostel_id} to={path(ROUTES.scanHostel, { hostelId: h.hostel_id })}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={Home} />
                  <span className="flex-1 font-medium text-ink">Scan for {h.name}</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
            ))}
            {/* Story 5.4. One card rather than one per facility: `GET /issues`
                already returns every block and hall this staffer is on in a
                single scoped queue, so splitting it per place would mean
                checking three screens to find the one report waiting. */}
            {(myMess.length > 0 || myHostels.length > 0) && (
              <Link to={ROUTES.facilityIssues}>
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
                  <Link to={path(ROUTES.workshopManage, { workshopId: w.workshop_id })}>
                    <Button variant="secondary">Workshop desk</Button>
                  </Link>
                  <Link to={path(ROUTES.scanWorkshop, { workshopId: w.workshop_id })}>
                    <Button variant="secondary">Scan registered</Button>
                  </Link>
                  <Link to={path(ROUTES.scanWorkshopOnSpot, { workshopId: w.workshop_id })}>
                    <Button variant="ghost">On-spot</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </Panel>
        )}

        {myEventTeams.length > 0 && (
          <Panel title="My Event Duties">
            {myEventTeams.map((e) => (
              <Card key={e.event_id}>
                <div className="flex items-center gap-3">
                  <IconTile icon={Ticket} tone="success" />
                  <p className="font-semibold text-ink">{e.name}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link to={path(ROUTES.scanEvent, { eventId: e.event_id })}>
                    <Button variant="secondary">Scan</Button>
                  </Link>
                  {myEventHeadEvents.some((h) => h.event_id === e.event_id) && (
                    <Link to={path(ROUTES.eventTeams, { eventId: e.event_id })}>
                      <Button variant="secondary">Allocate / Edit Teams</Button>
                    </Link>
                  )}
                </div>
              </Card>
            ))}
          </Panel>
        )}

        {/* Only for callers whose `workshop_team` was stripped: without it a
            volunteer cannot self-discover their assignment, so typing the id is
            the one remaining way in. Anyone who can read the field gets real duty
            cards above instead, and never sees this. */}
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
