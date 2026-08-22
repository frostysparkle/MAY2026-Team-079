import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3,
  Download,
  DoorOpen,
  RefreshCw,
  ScanLine,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { api } from '@/api';
import { reportApiError } from '@/api/report';
import { path, ROUTES } from '@/config/routes';
import { isSuperAdmin } from '@/stores/authStore';
import { downloadCsv, toCsv } from '@/lib/csv';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Histogram,
  Pagination,
  ProgressBar,
  RankedBars,
  ResultBanner,
  SectionHeading,
  Spinner,
  SplitBar,
  StatCard,
  StatusBadge,
  TextInput,
  usePagedList,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { useWorkshopRoster } from '@/features/workshops/useWorkshopRoster';
import {
  interestByCohort,
  interestByLevel,
  interestByProgramme,
  levelLabel,
  ROSTER_CSV_COLUMNS,
  toRosterCsvRows,
  type RosterEntry,
} from '@/features/workshops/workshopRoster';
import { clearScanLedger } from '@/features/workshops/scanLedger';
import { WorkshopTeamPanel } from '@/features/workshops/WorkshopTeamPanel';
import { workshopRoleLabel } from '@/features/workshops/workshopTeam';
import { parseSlotId, shiftLabel, workshopDayLabel } from '@/features/workshops/workshopSlot';

/**
 * The workshop desk: one screen for the volunteer or workshop manager running a
 * room, and the management view a Super Admin opens from the workshop grid.
 *
 * It answers the four questions the door actually has — how many booked, how many
 * of them came, who is still missing, and who was let in on the spot — and hands
 * the last two out as CSV. The two scanners are one tap away rather than
 * embedded: a camera and a table cannot share a screen usefully.
 *
 * What each figure can be trusted to mean, given the API:
 *
 *   - The headline counts are the workshop record's own `registration_count` and
 *     `participant_count`, which `GET /workshops` returns to any staff token.
 *     They are always right, whoever is looking.
 *   - The named lists come from `GET /workshops/{id}/logs`, which is Super
 *     Admin-only. For a volunteer they come from this device's scan ledger
 *     instead — real, but only the scans made here. The banner says which.
 *   - Rows are `participant_id`s. No endpoint returns a workshop registrant's
 *     name, email, or academic level, so the id — which is the student's roll
 *     number, and what their QR carries — is the identity available.
 */

type Tab = 'attended' | 'absent' | 'on-spot' | 'all';

const PAGE_SIZE = 25;

export default function WorkshopManagePage() {
  const { workshopId = '' } = useParams();
  const navigate = useNavigate();
  const superAdmin = isSuperAdmin();
  const roster = useWorkshopRoster(workshopId);
  const { workshop, counts, lists } = roster;

  const [tab, setTab] = useState<Tab>('attended');
  const [query, setQuery] = useState('');
  /** The participant id whose correction is in flight, so only their row is busy. */
  const [saving, setSaving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const back = superAdmin
    ? { label: 'Workshops', onClick: () => navigate(ROUTES.adminWorkshops) }
    : { label: 'Dashboard', onClick: () => navigate(ROUTES.staffDuties) };

  const rows = useMemo<RosterEntry[]>(() => {
    const source =
      tab === 'attended'
        ? lists.attended
        : tab === 'absent'
          ? lists.absent
          : tab === 'on-spot'
            ? lists.onSpot
            : lists.all;
    const needle = query.trim().toUpperCase();
    return needle ? source.filter((row) => row.participantId.includes(needle)) : source;
  }, [tab, query, lists]);

  const paged = usePagedList(rows, { pageSize: PAGE_SIZE, resetKey: `${tab}|${query}` });

  const levels = useMemo(() => interestByLevel(lists.all), [lists.all]);
  const cohorts = useMemo(() => interestByCohort(lists.all), [lists.all]);
  const programmes = useMemo(() => interestByProgramme(lists.all), [lists.all]);

  // The level breakdown is only a *level* breakdown when somebody's profile
  // supplied one. A roster rebuilt from log rows carries no profile at all, and
  // the entry-year cohort stands in — labelled as a cohort, never as a level.
  const levelsKnown = levels.counted > 0;

  function exportRows(entries: RosterEntry[], suffix: string) {
    downloadCsv(
      `workshop-${workshopId}-${suffix}.csv`,
      toCsv(toRosterCsvRows(entries), ROSTER_CSV_COLUMNS),
    );
  }

  /**
   * Set or clear one person's attendance by hand.
   *
   * The authorised override for a QR that cannot be scanned — a flat battery, a
   * cracked screen, a code that expired in the queue. The server records it as an
   * `attendance_override` with this staffer's id on it, so it never reads as a scan.
   */
  async function setAttendance(entry: RosterEntry, attended: boolean) {
    setSaving(entry.participantId);
    setActionError(null);
    try {
      await api.updateWorkshopParticipant(workshopId, entry.participantId, { attended });
      roster.reload();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not update that participant.'));
    } finally {
      setSaving(null);
    }
  }

  if (roster.error) {
    return (
      <FestivalScreen title="Workshop" width="lg" back={back}>
        <ErrorState
          title="Could not load this workshop"
          description={roster.error}
          onRetry={roster.reload}
        />
      </FestivalScreen>
    );
  }

  if (roster.loading || !workshop || !counts) {
    return (
      <FestivalScreen title="Workshop" width="lg" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading the workshop" />
        </div>
      </FestivalScreen>
    );
  }

  // A 403 from the roster route is the server's own answer about authority: this
  // account is not on this workshop's team, and the scanners will refuse it too.
  // Any *other* failure is not an answer about authority, so the page stays open
  // on the counts — which every staff token may read — and says what is missing.
  if (roster.rosterForbidden && !superAdmin) {
    return (
      <FestivalScreen title="Workshop" eyebrow={workshop.name} width="lg" back={back}>
        <ErrorState
          title="You are not on this workshop’s team"
          description={`A Super Admin assigns volunteers and workshop managers to each workshop.${
            roster.rosterError ? ` The server said: “${roster.rosterError}”.` : ''
          }`}
        />
      </FestivalScreen>
    );
  }

  const slot = parseSlotId(workshop.slot_id);
  const slotLabel = [slot.date && workshopDayLabel(slot.date), slot.shift && shiftLabel(slot.shift)]
    .filter(Boolean)
    .join(' · ');

  const eyebrow = roster.membership
    ? workshopRoleLabel(roster.membership.role)
    : superAdmin
      ? 'Super Admin'
      : 'Workshop team';

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'attended', label: 'Attended', count: lists.attended.length },
    { key: 'absent', label: 'Not attended', count: lists.absent.length },
    { key: 'on-spot', label: 'On-spot', count: lists.onSpot.length },
    { key: 'all', label: 'Everyone', count: lists.all.length },
  ];

  return (
    <FestivalScreen
      title="Workshop Desk"
      eyebrow={eyebrow}
      subtitle={[workshop.name, workshop.venue, slotLabel].filter(Boolean).join(' · ')}
      width="lg"
      back={back}
      actions={
        <>
          <Button
            className="gap-1.5"
            onClick={() => navigate(path(ROUTES.scanWorkshop, { workshopId }))}
          >
            <ScanLine size={14} /> Scan registered
          </Button>
          <Button
            variant="secondary"
            className="gap-1.5"
            onClick={() => navigate(path(ROUTES.scanWorkshopOnSpot, { workshopId }))}
          >
            <DoorOpen size={14} /> On-spot scanner
          </Button>
          <Button variant="ghost" className="gap-1.5" onClick={roster.reload}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </>
      }
    >
      {roster.membership?.attendance === false && (
        <ResultBanner variant="warning" title="Your scanning is switched off">
          A Super Admin has disabled scanning for your account on this workshop, so both scanners
          will refuse every code until it is switched back on. The figures below still read.
        </ResultBanner>
      )}

      {/* ---------------------------------------------------------- figures --- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Attendance"
          meta={`${counts.registered} of ${counts.capacity} seats taken`}
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Users}
            label="Registered"
            value={counts.registered.toLocaleString()}
            tone="brand"
            footnote={
              <span className="flex flex-col gap-1">
                <ProgressBar
                  value={counts.registered}
                  max={counts.capacity || 1}
                  tone={counts.seatsLeft === 0 ? 'warning' : 'brand'}
                  label={`${workshop.name} seats taken`}
                />
                <span>{counts.seatsLeft.toLocaleString()} seats left</span>
              </span>
            }
          />
          <StatCard
            icon={UserCheck}
            label="Attended"
            value={counts.attended.toLocaleString()}
            tone="success"
            footnote={
              counts.showRate === null
                ? 'Nobody has registered yet'
                : `${counts.showRate.toFixed(0)}% of registrations turned up`
            }
          />
          <StatCard
            icon={UserMinus}
            label="Not attended"
            value={counts.notAttended.toLocaleString()}
            tone={counts.notAttended > 0 ? 'warning' : 'info'}
            footnote="Booked a seat and has not been scanned in"
          />
          <StatCard
            icon={DoorOpen}
            label="On-spot admitted"
            value={
              counts.onSpotAdmitted === null
                ? lists.onSpot.length.toLocaleString()
                : counts.onSpotAdmitted.toLocaleString()
            }
            tone="accent"
            footnote={
              counts.onSpotLeft === null
                ? `From this device. The cap is ${counts.onSpotAllowance} (10% of capacity).`
                : `${counts.onSpotLeft} of ${counts.onSpotAllowance} on-spot places left`
            }
          />
        </div>

        <Card className="flex flex-col gap-2">
          <SplitBar
            label="Workshop seats attended, booked but absent, and unsold"
            segments={[
              {
                key: 'attended',
                label: 'Attended',
                value: counts.attended,
                color: 'var(--color-domain-workshops)',
              },
              {
                key: 'absent',
                label: 'Booked, not scanned',
                value: counts.notAttended,
                color: 'var(--color-warning)',
              },
              {
                key: 'free',
                label: 'Seats unsold',
                value: counts.seatsLeft,
                color: 'var(--color-line)',
              },
            ]}
          />
        </Card>
      </section>

      {/* ------------------------------------------------------- interest --- */}
      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Who is interested"
          meta={
            cohorts.counted > 0
              ? `${cohorts.counted} registrations classified`
              : 'Awaiting bookings'
          }
        />

        {lists.all.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">
              Nothing to plot yet. This breakdown is derived from the roster below, so it fills in
              as bookings and scans arrive.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {levelsKnown ? (
              <Card className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">Interest by level</p>
                <Histogram
                  buckets={levels.buckets}
                  domain="workshops"
                  label="Workshop interest by academic level"
                  height={120}
                />
                <p className="text-xs text-muted">
                  Foundation, Diploma and Degree as each student’s own profile records them, from{' '}
                  <code className="rounded bg-surface-2 px-1">
                    GET /workshops/{'{id}'}/participation
                  </code>
                  . All three are shown even at zero.
                  {levels.unknown > 0 &&
                    ` ${levels.unknown} of them have no completed profile, so their level is not counted here.`}
                </p>
              </Card>
            ) : (
              <Card className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">Interest by cohort</p>
                <Histogram
                  buckets={cohorts.buckets}
                  domain="workshops"
                  label="Workshop interest by entry cohort"
                  height={120}
                />
                <p className="text-xs text-muted">
                  Entry year, read from each registrant’s roll number. Nobody on this list has a
                  readable academic level — a roster rebuilt from scan rows carries no profile — so
                  this is a year group, not a level.
                  {cohorts.unknown > 0 && ` ${cohorts.unknown} id(s) did not parse.`}
                </p>
              </Card>
            )}

            <Card className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-ink">Interest by programme</p>
              <RankedBars
                rows={programmes.buckets}
                domain="workshops"
                label="Workshop interest by programme"
                emptyText="No programme could be derived yet"
              />
              <p className="text-xs text-muted">
                Programme comes from the two letters that open every participant id, which the
                backend derives from the student’s email domain.
              </p>
            </Card>
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- exports --- */}
      <section className="flex flex-col gap-3">
        <SectionHeading title="Exports" />
        <Card className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="gap-1.5"
            disabled={lists.onSpot.length === 0}
            onClick={() => exportRows(lists.onSpot, 'on-spot-registrations')}
          >
            <Download size={14} /> On-spot registrations ({lists.onSpot.length})
          </Button>
          <Button
            variant="secondary"
            className="gap-1.5"
            disabled={lists.attended.length === 0}
            onClick={() => exportRows(lists.attended, 'registered-attended')}
          >
            <Download size={14} /> Registered students who attended ({lists.attended.length})
          </Button>
          <Button
            variant="ghost"
            className="gap-1.5"
            disabled={lists.absent.length === 0}
            onClick={() => exportRows(lists.absent, 'absentees')}
          >
            <Download size={14} /> Absentees ({lists.absent.length})
          </Button>
        </Card>
      </section>

      {/* ---------------------------------------------------------- roster --- */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading title="Registered students" meta={`${lists.all.length} on record`} />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            disabled={rows.length === 0}
            onClick={() => exportRows(rows, tab)}
          >
            <Download size={14} /> Export this list
          </Button>
        </div>

        {actionError && (
          <ResultBanner variant="error" title="Could not update that participant">
            {actionError}
          </ResultBanner>
        )}

        {/* The two numbers on this screen come from two places, and they can
            disagree: `registration_count` is a counter on the workshop, while the
            list is the participants who actually hold a seat. Seed data written
            straight into Mongo can have the counter without the records, so saying
            which is which beats leaving somebody to wonder why "8 seats taken"
            lists 7 people. */}
        {roster.rosterReadable && lists.all.length !== counts.registered && (
          <p className="text-xs text-muted">
            The workshop record reports {counts.registered.toLocaleString()} seat
            {counts.registered === 1 ? '' : 's'} taken and {counts.attended.toLocaleString()}{' '}
            present; the roster names {lists.all.length.toLocaleString()} of them. Seats counted
            without a matching participant record — data written straight into the database — appear
            in the figures above and not here.
          </p>
        )}

        {!roster.rosterReadable && (
          <ResultBanner variant="warning" title="Names below are the scans made on this device">
            This workshop’s roster is returned by <code>GET /workshops/{'{id}'}/participation</code>{' '}
            to a Super Admin or a member of its own team
            {roster.rosterError ? `: “${roster.rosterError}”` : ''}. The counts above come from the
            workshop record and are complete; this list is this device’s {roster.deviceScanCount}{' '}
            scan{roster.deviceScanCount === 1 ? '' : 's'}.
            {roster.deviceScanCount > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="tap font-semibold underline"
                  onClick={() => {
                    clearScanLedger(workshopId);
                    roster.reload();
                  }}
                >
                  Clear this device’s history
                </button>
              </>
            )}
          </ResultBanner>
        )}

        <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-pressed={tab === item.key}
              className={`tap flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                tab === item.key ? 'bg-surface text-brand shadow-card' : 'text-muted'
              }`}
            >
              {item.label} ({item.count})
            </button>
          ))}
        </div>

        <TextInput
          label="Search by participant ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. DS23F"
        />

        {rows.length === 0 ? (
          <EmptyState
            title={query ? 'No participant id matches' : 'Nothing on this list yet'}
            description={
              query
                ? 'Clear the search to see the whole list.'
                : tab === 'absent'
                  ? 'Everybody who booked has been scanned in.'
                  : 'Rows appear here as bookings are made and codes are scanned.'
            }
            icon={BarChart3}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {paged.items.map((entry) => (
                <li key={`${entry.participantId}-${entry.booking}`}>
                  <Card className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">
                        {entry.name || entry.participantId}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {[
                          entry.name ? entry.participantId : null,
                          entry.email,
                          entry.programLabel,
                          entry.registeredAt
                            ? `booked ${new Date(entry.registeredAt).toLocaleString('en-IN')}`
                            : null,
                          entry.attendedAt
                            ? `scanned ${new Date(entry.attendedAt).toLocaleString('en-IN')}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'No further detail is exposed for this id'}
                      </p>
                    </div>
                    {entry.courseStage && (
                      <StatusBadge tone="neutral">
                        {entry.academicLevel ?? levelLabel(entry.courseStage)}
                      </StatusBadge>
                    )}
                    <StatusBadge tone={entry.booking === 'on-spot' ? 'info' : 'neutral'}>
                      {entry.booking === 'on-spot' ? 'On-spot' : 'Pre-registered'}
                    </StatusBadge>
                    <StatusBadge tone={entry.attended ? 'success' : 'warning'}>
                      {entry.attended ? 'Present' : 'Not scanned'}
                    </StatusBadge>
                    {/* The correction, offered only where it can succeed: the
                        roster route answered (so this account is on the team or an
                        admin) and its scanning has not been switched off. The
                        server checks both again. */}
                    {roster.rosterReadable && roster.membership?.attendance !== false && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={saving === entry.participantId}
                        disabled={saving !== null}
                        onClick={() => void setAttendance(entry, !entry.attended)}
                      >
                        {entry.attended ? 'Mark absent' : 'Mark present'}
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
            <Pagination paged={paged} noun="students" />
          </>
        )}
      </section>

      {/* ------------------------------------------------------------ team --- */}
      <WorkshopTeamPanel
        workshopId={workshopId}
        team={roster.team}
        canManage={superAdmin}
        onChanged={roster.reload}
      />
    </FestivalScreen>
  );
}
