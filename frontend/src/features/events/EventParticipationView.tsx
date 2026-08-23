import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DoorOpen,
  Download,
  LayoutGrid,
  List,
  Phone,
  ScanLine,
  Search,
  Ticket,
  Users,
} from 'lucide-react';
import type { Event, EventParticipationResponse } from '@/api/types';
import { path, ROUTES } from '@/config/routes';
import { currentStaff, isUhc, uhcHouse } from '@/stores/authStore';
import { ADMITTED_NOTE, readEventCapacity } from './eventCapacity';
import { exportEventDetails, exportEventRoster } from './eventExport';
import {
  eventRegistrants,
  registrantsByCohort,
  registrantsByHouse,
  registrantsByProgramme,
  teamSplit,
} from './eventRoster';
import { RegistrantCards } from './RegistrantCards';
import { useRegistrantColumns } from './registrantColumns';
import { readEventExtras } from './eventExtras';
import {
  eventTeamRoleLabel,
  isEventHeadRole,
  isOnEventTeam,
  isReachablePhone,
  orderEventTeam,
} from './eventTeam';
import {
  ANY,
  Avatar,
  Button,
  Card,
  DataTable,
  EmptyState,
  IconTile,
  ProgressBar,
  RankedBars,
  ResultBanner,
  Select,
  SectionBlock,
  StatCard,
  StatusBadge,
  TextInput,
  ViewToggle,
  sortRows,
  useTableSort,
  useViewMode,
  type ViewOption,
} from '@/components/ui';

/**
 * Everything about who has registered for one event: the capacity figures, the
 * team directory, the registrant profile charts, and the roster itself.
 *
 * Lifted out of `EventParticipationPage` so the staff dashboard can show the same
 * content inline. Two callers, one body — an event head's dashboard *is* this
 * view now, and it has to be the same thing the full screen shows rather than a
 * summary of it that can drift.
 *
 * Deliberately layout-only: it takes the loaded roster rather than fetching, so
 * the page can keep its full-screen spinner and error state while the dashboard
 * renders a section-sized one. `useEventParticipation` is the shared fetch.
 *
 * What each caller supplies around it:
 *
 *   - the screen or section title ("Participants" in both places, which is what
 *     the event-name row below is positioned against),
 *   - the actions, via `EventParticipationActions` plus whatever else that caller
 *     is entitled to offer — the dashboard adds Allocate / Edit Teams for a head.
 */
const VIEW_OPTIONS: readonly ViewOption<'table' | 'cards'>[] = [
  { value: 'cards', label: 'Card view', icon: LayoutGrid },
  { value: 'table', label: 'Table view', icon: List },
];

export function EventParticipationView({
  eventId,
  event,
  data,
  badges,
}: {
  eventId: string;
  /**
   * The catalogue record, for the name, the published capacity, and the team size
   * rule. Null is expected and handled: both callers load it without blocking, so
   * the roster renders whether or not `GET /events` has answered.
   */
  event: Event | null;
  data: EventParticipationResponse;
  /** Extra badges for the event-name row — the dashboard puts the caller's own role there. */
  badges?: ReactNode;
}) {
  const houseWarning = isUhc() && uhcHouse() === null;

  // Absent for UHC callers, so narrow rather than assert. `total_daily_scans`
  // counts distinct participants, not scan rows, so it needs no correction here.
  const attendedToday = typeof data.total_daily_scans === 'number' ? data.total_daily_scans : null;
  const capacity = readEventCapacity(
    event ? readEventExtras(event.registration).capacity : undefined,
    attendedToday,
  );

  // Registrations against the same published limit — a different question from
  // "who has walked in", and the one that tells an organiser they have sold more
  // places than the venue holds.
  const oversubscribed = capacity ? Math.max(0, data.count - capacity.capacity) : 0;

  const registrants = useMemo(() => eventRegistrants(data.participants), [data.participants]);
  const houseRows = registrantsByHouse(registrants);
  const programmeRows = registrantsByProgramme(registrants);
  const cohortRows = registrantsByCohort(registrants);
  const teams = teamSplit(registrants);

  // Client-side, matching every other admin list in the app (`useListFilters`):
  // this roster is already loaded in full, so there is no server call to send a
  // query to. Matches on the fields a name search actually needs — name, email,
  // id, and house — so "wayanad" or a roll number finds the right rows too.
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  // Two more filters, alongside the search box — House and Team, matching the
  // Mess/Hostels toolbar pattern. Their vocabularies come from the roster itself,
  // so a filter can never offer a house or team that nobody here actually holds.
  const [houseFilter, setHouseFilter] = useState<string>(ANY);
  const [teamFilter, setTeamFilter] = useState<'any' | 'teamed' | 'solo'>('any');

  const houseOptions = useMemo(
    () =>
      [...new Set(registrants.map((p) => p.house).filter((h): h is string => Boolean(h)))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [registrants],
  );

  const visibleRegistrants = useMemo(() => {
    return registrants.filter((p) => {
      if (houseFilter !== ANY && p.house !== houseFilter) return false;
      if (teamFilter === 'teamed' && !p.teamId) return false;
      if (teamFilter === 'solo' && p.teamId) return false;
      if (!needle) return true;
      return [p.name, p.email, p.participantId, p.house, p.teamId]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle));
    });
  }, [registrants, needle, houseFilter, teamFilter]);

  const registrantFiltered = needle !== '' || houseFilter !== ANY || teamFilter !== 'any';

  const registrantSort = useTableSort('name');
  const registrantColumns = useRegistrantColumns();
  const sortedRegistrants = useMemo(
    () => sortRows(visibleRegistrants, registrantColumns, registrantSort),
    [visibleRegistrants, registrantColumns, registrantSort],
  );

  const { view: registrantView, setView: setRegistrantView } = useViewMode(VIEW_OPTIONS, 'cards');

  return (
    <>
      {/* Which event this is, as the first row rather than only as the eyebrow over
          the title.
          Both callers head this content "Participants" — the same words for every
          event — so without this row the name was carried only in 12px tracked
          caps on the full screen, and not at all on the dashboard. An organiser
          working two events could not tell the two apart at a glance.

          Falls back to the id, never to nothing: `event` is loaded without
          blocking, so it can still be null on a slow or failed catalogue fetch,
          and a blank row would be worse than an unresolved one. */}
      <Card className="flex items-center gap-3">
        <IconTile icon={Ticket} tone="success" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Event</p>
          <p className="truncate text-lg font-black leading-tight text-ink">
            {event?.name ?? eventId}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {badges}
          {event && (
            <>
              <StatusBadge tone="neutral">{event.event_type}</StatusBadge>
              <StatusBadge tone={event.registration.is_open ? 'success' : 'neutral'}>
                {event.registration.is_open ? 'Registration open' : 'Registration closed'}
              </StatusBadge>
            </>
          )}
        </div>
      </Card>

      {houseWarning && (
        <ResultBanner variant="warning" title="No house detected on your account">
          UHC visibility is derived from your email (e.g. wayanad-sec@...). Your email has no
          hyphen, so this list may show nobody even if participants exist.
        </ResultBanner>
      )}

      {/* Story 3.2: the organiser's answer to "how many entries are left today",
          derived in `features/events/eventCapacity`. Shown only for events whose
          organiser has published a capacity. */}
      {capacity && (
        <SectionBlock title="Entry capacity today">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              icon={Ticket}
              label="Published capacity"
              value={capacity.capacity.toLocaleString()}
              tone="brand"
              footnote={
                oversubscribed > 0
                  ? `${oversubscribed.toLocaleString()} more registered than the venue holds`
                  : `${data.count.toLocaleString()} registered`
              }
            />
            <StatCard
              icon={DoorOpen}
              label="Admitted today"
              value={capacity.admitted === null ? '—' : capacity.admitted.toLocaleString()}
              tone={capacity.atCapacity ? 'warning' : 'info'}
              footnote={
                capacity.admitted === null
                  ? 'Today’s attendance is not readable from this account'
                  : ADMITTED_NOTE
              }
            />
            <StatCard
              icon={Users}
              label="Entries left"
              value={capacity.remaining === null ? '—' : capacity.remaining.toLocaleString()}
              tone={capacity.atCapacity ? 'warning' : 'success'}
              footnote={
                capacity.admitted === null ? (
                  capacity.summary
                ) : (
                  <span className="flex flex-col gap-1">
                    <ProgressBar
                      value={capacity.admitted}
                      max={capacity.capacity}
                      tone={capacity.barTone}
                      label={`${event?.name ?? 'Event'} entries used`}
                    />
                    <span>{capacity.summary}</span>
                  </span>
                )
              }
            />
          </div>
          {capacity.over > 0 && (
            <ResultBanner
              variant="warning"
              title={`${capacity.over.toLocaleString()} past the published capacity`}
            >
              More people have been scanned in today than the published limit. The capacity is an
              organiser’s figure, not an enforced cap — the gate does not refuse anyone.
            </ResultBanner>
          )}
        </SectionBlock>
      )}

      {/* A directory, not a list of names.
          `event_team` is the only place in the API where an Event Head's and a
          volunteer's phone number is readable, and it is exactly what the guide
          wants UHC to have here — but the number came back on every row and was
          never rendered, so this section could name the person to ring and not
          how to ring them. Heads sort first, since they are who a house officer
          or a domain admin actually needs. */}
      {data.event_team.length > 0 && (
        <SectionBlock title="Event team" meta="who to contact">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {orderEventTeam(data.event_team).map((member) => {
              const reachable = isReachablePhone(member.phone);
              return (
                <li key={`${member.user_id}-${member.role}`}>
                  <Card className="flex items-center gap-3">
                    <Avatar name={member.name || member.user_id} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {member.name || member.user_id}
                      </p>
                      {reachable ? (
                        <a
                          href={`tel:${member.phone}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand underline"
                        >
                          <Phone size={11} strokeWidth={2.5} />
                          {member.phone}
                        </a>
                      ) : (
                        // The backend substitutes the literal "Unknown" when the
                        // member has no participant profile to read a phone from.
                        <p className="text-xs text-muted">No number on record</p>
                      )}
                    </div>
                    <StatusBadge tone={isEventHeadRole(member.role) ? 'info' : 'neutral'}>
                      {eventTeamRoleLabel(member.role)}
                    </StatusBadge>
                  </Card>
                </li>
              );
            })}
          </ul>
        </SectionBlock>
      )}

      {/* Who signs up for this event, not just who has.
          A roster of cards answers "is so-and-so registered"; it does not answer
          "what kind of entry does my event attract", which is what an organiser
          plans rounds, prizes, and house-based team rules around. House comes from
          the profile; programme and cohort are read out of the roll number by
          `eventRegistrants`, which is the only profile information available to a
          caller who cannot read the Super Admin participant roster.

          Cohort, deliberately, not level: entry year is what the id carries, and a
          2023-entry student may be on Foundation, Diploma or Degree. The heading
          says so, because a chart labelled "level" here would be wrong every time. */}
      {registrants.length > 0 && (
        <SectionBlock title="Registrant profile" meta="house, programme, entry cohort">
          {/* All four cards fixed to the same height, each scrolling on its own
              rather than the whole row sharing one scroller. A single shared
              scroller hid "Teams" behind "By house" whenever house alone had
              enough rows to fill it, and capping only the chart cards left
              "Teams" a different height and the row uneven. A shared `h-80`
              keeps every card the same size regardless of how many rows its
              own chart has; `overflow-y-auto` only engages once a chart's rows
              exceed that height, so a short list just sits inside it unscrolled. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="flex h-80 flex-col gap-2 overflow-y-auto">
              <h3 className="sticky top-0 bg-surface text-[10px] font-semibold uppercase tracking-wider text-muted">
                By house
              </h3>
              <RankedBars rows={houseRows} domain="people" label="Registrants by house" />
            </Card>
            <Card className="flex h-80 flex-col gap-2 overflow-y-auto">
              <h3 className="sticky top-0 bg-surface text-[10px] font-semibold uppercase tracking-wider text-muted">
                By programme
              </h3>
              <RankedBars rows={programmeRows} domain="events" label="Registrants by programme" />
            </Card>
            <Card className="flex h-80 flex-col gap-2 overflow-y-auto">
              <h3 className="sticky top-0 bg-surface text-[10px] font-semibold uppercase tracking-wider text-muted">
                By entry cohort
              </h3>
              <RankedBars
                rows={cohortRows}
                domain="workshops"
                label="Registrants by entry cohort"
              />
            </Card>
            <Card className="flex h-80 flex-col gap-2 overflow-y-auto">
              <h3 className="sticky top-0 bg-surface text-[10px] font-semibold uppercase tracking-wider text-muted">
                Teams
              </h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  { label: 'In a team', value: teams.teamed.toLocaleString() },
                  { label: 'Registered alone', value: teams.solo.toLocaleString() },
                  { label: 'Teams formed', value: teams.teams.toLocaleString() },
                  {
                    label: 'Team size',
                    value: event ? `${event.team.min}–${event.team.max}` : '—',
                    note: event?.team.house_vs_house_event ? 'house-only' : undefined,
                  },
                ].map((figure) => (
                  <div key={figure.label} className="min-w-0">
                    <dt className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted">
                      {figure.label}
                    </dt>
                    <dd className="text-lg font-black leading-tight tabular-nums text-ink">
                      {figure.value}
                      {'note' in figure && figure.note && (
                        <span className="ml-1 text-[11px] font-medium text-muted">
                          {figure.note}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </SectionBlock>
      )}

      <SectionBlock title="Registered" meta={`${data.count}`}>
        {registrants.length > 0 && (
          <>
            {/* Search plus House and Team, and the Grid/List toggle — the same
                arrangement `AdminHostelsPage` and `AdminMessPage` use, so this
                roster reads the same way every other admin list in the app does. */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <TextInput
                  label="Search registered participants"
                  icon={Search}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, participant ID, or house"
                />
              </div>
              {houseOptions.length > 0 && (
                <div className="min-w-36">
                  <Select
                    label="House"
                    value={houseFilter}
                    onChange={(e) => setHouseFilter(e.target.value)}
                    options={[
                      { value: ANY, label: 'All Houses' },
                      ...houseOptions.map((h) => ({ value: h, label: h })),
                    ]}
                  />
                </div>
              )}
              <div className="min-w-36">
                <Select
                  label="Team"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value as 'any' | 'teamed' | 'solo')}
                  options={[
                    { value: 'any', label: 'Any team status' },
                    { value: 'teamed', label: 'On a team' },
                    { value: 'solo', label: 'Registered alone' },
                  ]}
                />
              </div>
              <ViewToggle
                options={VIEW_OPTIONS}
                value={registrantView}
                onChange={setRegistrantView}
              />
            </div>

            {registrantFiltered && (
              <p className="text-xs text-muted">
                {visibleRegistrants.length} of {registrants.length} shown
              </p>
            )}
          </>
        )}

        {registrants.length === 0 ? (
          <EmptyState
            title="Nobody has registered yet"
            description="Registrations appear here as soon as participants sign up."
            icon={Users}
          />
        ) : visibleRegistrants.length === 0 ? (
          <EmptyState
            title="No match"
            description="Clear the search or filters to see the whole roster."
            icon={Search}
          />
        ) : registrantView === 'table' ? (
          <DataTable
            columns={registrantColumns}
            rows={sortedRegistrants}
            rowKey={(row) => row.participantId}
            sort={registrantSort}
            caption="Registered participants with house, programme, team, and phone"
          />
        ) : (
          <RegistrantCards rows={sortedRegistrants} />
        )}
      </SectionBlock>
    </>
  );
}

/**
 * The three things every caller of `EventParticipationView` can offer: two
 * exports and the attendance scanner.
 *
 * Shared for the same reason the view is. These are not extra permissions — the
 * exports save what is already on screen, and the scanner re-checks membership
 * server-side — so both the full screen and the dashboard section carry all three.
 * A caller with more to offer renders it alongside: the dashboard adds Allocate /
 * Edit Teams, which is an Event Head's alone.
 */
export function EventParticipationActions({
  eventId,
  event,
  data,
}: {
  eventId: string;
  event: Event | null;
  data: EventParticipationResponse;
}) {
  const navigate = useNavigate();

  // `POST /events/{id}/scan` admits an `event_team` member and refuses everybody
  // else with a 403 (`_is_event_team_member` in `backend/routers/events.py`) — a
  // Super Admin, a UHC member, or a domain admin looking at this roster is not
  // automatically on that team, and offering a button that is certain to 403 is
  // not a scanner, it is a dead end with a spinner. `event_team` on the catalogue
  // record carries every role for every caller, so this reads the same list an
  // Event Head's dashboard badge does.
  const staff = currentStaff();
  const canScan = isOnEventTeam(event?.event_team, staff?.id);

  return (
    <>
      {/* Two exports, because they are two different questions: "who is coming"
          and "what is this event". Both are built in `features/events/eventExport`
          so the header rows cannot drift from the shapes being written. The details
          export needs the event record, so it waits for the `GET /events` call
          rather than writing a file with a blank name on it. */}
      <Button
        variant="secondary"
        className="gap-1.5"
        disabled={event === null}
        onClick={() => event && exportEventDetails(event, data)}
      >
        <Download size={14} /> Export event details
      </Button>
      <Button
        variant="secondary"
        className="gap-1.5"
        disabled={data.participants.length === 0}
        onClick={() => exportEventRoster(eventId, data.participants)}
      >
        <Download size={14} /> Export registrations
      </Button>
      {canScan && (
        <Button
          variant="ghost"
          className="gap-1.5"
          onClick={() => navigate(path(ROUTES.scanEvent, { eventId }))}
        >
          <ScanLine size={14} /> Scan attendance
        </Button>
      )}
    </>
  );
}
