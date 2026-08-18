import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronRight, Home, Ticket, UtensilsCrossed, Wrench } from 'lucide-react';
import { api } from '@/api';
import type { Event, Hostel, Mess, Workshop } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { currentStaff, isSuperAdmin, isUhc, isDomainAdminFor } from '@/stores/authStore';
import { Button, Card, IconTile, SectionHeading, TextInput } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * Staff dashboard. Every card is computed from live entity lists, not from a
 * static role hierarchy — a mess, hostel, event, or workshop team member is
 * discovered by checking `session.id` against each entity's team array after
 * fetching it.
 *
 * Section navigation is deliberately absent: `StaffShell` renders the rail (and,
 * on a phone, the scrolling tab row) with the same links on every screen, so a
 * panel of them here would be a second copy that can only drift from the first.
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
      {/* Masonry: columns balance themselves, cards never split across them. */}
      <div className="gap-5 md:columns-2 xl:columns-3 [&>*]:mb-5 [&>*]:break-inside-avoid">
        {(myMess.length > 0 || myHostels.length > 0 || myWorkshops.length > 0) && (
          <Panel title="My Scanning Duties">
            {myMess.map((m) => (
              <Link key={m.mess_id} to={path(ROUTES.scanMess, { messId: m.mess_id })}>
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={UtensilsCrossed} tone="warning" />
                  <span className="flex-1 font-medium text-ink">Scan for {m.name}</span>
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
            {myWorkshops.map((w) => (
              <Link
                key={w.workshop_id}
                to={path(ROUTES.scanWorkshop, { workshopId: w.workshop_id })}
              >
                <Card interactive className="flex items-center gap-3">
                  <IconTile icon={Wrench} tone="muted" />
                  <span className="flex-1 font-medium text-ink">Scan for {w.name}</span>
                  <ChevronRight size={18} className="text-muted" />
                </Card>
              </Link>
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
          <Panel title="Scan a Workshop">
            <Card className="flex items-end gap-2">
              <IconTile icon={Wrench} tone="muted" className="mb-1" />
              <div className="flex-1">
                <TextInput
                  label="Workshop ID"
                  value={workshopId}
                  onChange={(e) => setWorkshopId(e.target.value)}
                />
              </div>
              <Button
                className="mb-0.5"
                disabled={!workshopId.trim()}
                onClick={() =>
                  navigate(path(ROUTES.scanWorkshop, { workshopId: workshopId.trim() }))
                }
              >
                Go
              </Button>
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
      </div>
    </FestivalScreen>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeading title={title} />
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
