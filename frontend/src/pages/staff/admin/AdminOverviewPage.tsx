import { useMemo } from 'react';
import { RefreshCw, Radio, ShieldCheck, UtensilsCrossed, Users } from 'lucide-react';
import { Button, DOMAIN_COLOR } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { ROUTES } from '@/config/routes';
import { buildHostelRows, summariseHostels } from '@/features/hostels/hostelOccupancy';
import { buildMessRows, summariseMess } from '@/features/mess/messOccupancy';
import {
  activityPulse,
  bucketByHour,
  mealMatrix,
  rowsOnDay,
  rowsSince,
  uniqueActors,
} from '@/features/overview/auditSeries';
import { buildAlerts } from '@/features/overview/festAlerts';
import {
  buildEventRows,
  buildStaffWorkload,
  buildWorkshopRows,
  summariseEvents,
  summariseStaffOps,
  summariseWorkshops,
} from '@/features/overview/festMetrics';
import { useFestSnapshot } from '@/features/overview/useFestSnapshot';
import { AttentionRail, type PressurePoint } from '@/features/overview/board/AttentionRail';
import { CapacityBoard } from '@/features/overview/board/CapacityBoard';
import { KpiCard } from '@/features/overview/board/KpiCard';
import { LiveFlowPanel } from '@/features/overview/board/LiveFlowPanel';
import { PipelinePanel } from '@/features/overview/board/PipelinePanel';
import { TrendDeck } from '@/features/overview/board/TrendDeck';
import {
  capacityRows,
  capacityStatusText,
  pipelineStages,
  pressureRows,
} from '@/features/overview/board/boardSeries';
import { windowDelta } from '@/features/overview/board/trendScale';
import { ActivityPanel } from '@/features/overview/panels/ActivityPanel';
import { EventsPanel } from '@/features/overview/panels/EventsPanel';
import { FinancePanel } from '@/features/overview/panels/FinancePanel';
import { HostelsPanel } from '@/features/overview/panels/HostelsPanel';
import { MessPanel } from '@/features/overview/panels/MessPanel';
import { ParticipantsPanel } from '@/features/overview/panels/ParticipantsPanel';
import { StaffPanel } from '@/features/overview/panels/StaffPanel';
import { WorkshopsPanel } from '@/features/overview/panels/WorkshopsPanel';

/**
 * The Fest Control Board — one screen that answers "is Paradox running cleanly
 * right now?" without opening eight sections one at a time.
 *
 * **Read-only by construction.** Every call behind this page is a GET and no
 * control here mutates fest data. The tabs, the range select, and the capacity
 * drill-in all change what is *shown*; each panel then ends by linking to the
 * section that owns the thing. That constraint is deliberate: a ninth screen that
 * could allocate hostels or close an event is a ninth place to do it by accident
 * mid-fest.
 *
 * **Reading order** runs from the most time-critical to the most detailed, which
 * is also roughly outside-in:
 *
 *  1. the pulse row — the four figures an admin checks without reading anything else;
 *  2. the command row — what is moving right now, beside what needs attention;
 *  3. the operational row — how far registrations have got, and where the campus
 *     is running out of room;
 *  4. the trend deck — one series at full width, for "how did we get here";
 *  5. the eight domain panels — the per-section detail, unchanged.
 *
 * Everything above the domain panels is a *summary of* them, so the page can be
 * abandoned at any point and still have answered a coarser version of the
 * question. Loading is tiered; see `useFestSnapshot` for why and at what cost.
 */
export default function AdminOverviewPage() {
  const snapshot = useFestSnapshot();
  const {
    participants,
    workshops,
    staff,
    audit,
    mess,
    messStats,
    hostels,
    hostelStats,
    events,
    participation,
    tiers,
    failedDomains,
    refresh,
  } = snapshot;

  /* The summaries the pulse row, the alert engine, and the board panels need.
     Each domain panel still derives its own detail; only what is shared lives
     here, so a panel stays movable. */

  const hostelRows = useMemo(
    () => buildHostelRows(hostels ?? [], hostelStats),
    [hostels, hostelStats],
  );
  const hostelSummary = useMemo(() => summariseHostels(hostelRows), [hostelRows]);

  const messRows = useMemo(() => buildMessRows(mess ?? [], messStats), [mess, messStats]);
  const messSummary = useMemo(() => summariseMess(messRows), [messRows]);

  const eventSummary = useMemo(
    () => summariseEvents(buildEventRows(events ?? [], participation)),
    [events, participation],
  );

  const workshopSummary = useMemo(
    () => summariseWorkshops(buildWorkshopRows(workshops ?? [])),
    [workshops],
  );

  const staffSummary = useMemo(
    () =>
      summariseStaffOps(
        buildStaffWorkload(
          staff ?? [],
          {
            events: events ?? [],
            mess: mess ?? [],
            hostels: hostels ?? [],
            workshops: workshops ?? [],
          },
          uniqueActors(rowsOnDay(audit.recent)),
        ),
      ),
    [staff, events, mess, hostels, workshops, audit.recent],
  );

  const onCampus = useMemo(
    () =>
      participants?.currently_on_campus ??
      (hostelRows.every((row) => row.inside !== null)
        ? hostelRows.reduce((sum, row) => sum + (row.inside ?? 0), 0)
        : null),
    [participants, hostelRows],
  );

  const mealsToday = useMemo(() => mealMatrix(rowsOnDay(audit.messScans)).total, [audit.messScans]);
  const messScansRecently = useMemo(() => rowsSince(audit.messScans, 20).length, [audit.messScans]);
  const pulse = useMemo(() => activityPulse(audit.recent), [audit.recent]);

  /* ── the pulse row's movement figures ──
     Each delta compares the last hour against the one before it, off the same
     hourly buckets the hero chart plots — so a card's arrow and the line above it
     can never tell different stories. `windowDelta` returns null rather than
     inventing a percentage when there is no comparable previous window. */

  const mealDelta = useMemo(
    () => windowDelta(bucketByHour(audit.messScans, 24), 1),
    [audit.messScans],
  );

  /* ── the capacity board ── */

  const capacity = useMemo(
    () =>
      capacityRows(hostelRows, messRows, { hostels: ROUTES.adminHostels, mess: ROUTES.adminMess }),
    [hostelRows, messRows],
  );

  // The named places behind the rail's capacity alerts. The alert says how many
  // are under pressure; these say which, and link straight there.
  const pressure = useMemo<PressurePoint[]>(
    () =>
      pressureRows(capacity).map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        status: capacityStatusText(row),
        critical: row.allocated !== null && row.allocated > row.capacity,
        to: row.to,
      })),
    [capacity],
  );

  const stages = useMemo(
    () =>
      pipelineStages({
        registered: participants?.total_registered ?? null,
        profileComplete: participants?.profile_complete ?? null,
        // Prefer the participants endpoint, which counts the flag itself, over
        // summing per-block statistics that fail individually.
        hostelAllotted: participants?.hostel_allotted ?? hostelSummary.allocated,
        messAllotted: participants?.mess_allotted ?? messSummary.allocated,
        onCampus,
        withEvents: participants?.with_event_registrations ?? null,
        withWorkshops: participants?.with_workshop_registrations ?? null,
      }),
    [participants, hostelSummary.allocated, messSummary.allocated, onCampus],
  );

  const alerts = useMemo(
    () =>
      buildAlerts(
        {
          hostels: {
            summary: hostelSummary,
            rows: hostelRows,
            pending: participants?.hostel_pending ?? null,
          },
          mess: {
            summary: messSummary,
            rows: messRows,
            // Only a real signal once the trail has loaded; before that "zero
            // scans in 20 minutes" is a statement about the fetch, not the fest.
            scansLast20Min: tiers.fast.updatedAt === null ? null : messScansRecently,
          },
          events: eventSummary,
          workshops: workshopSummary,
          staff: staffSummary,
          pulse,
          failedDomains,
        },
        {
          hostels: ROUTES.adminHostels,
          mess: ROUTES.adminMess,
          events: ROUTES.adminEvents,
          workshops: ROUTES.adminWorkshops,
          staff: ROUTES.adminBackendTeams,
          auditLogs: ROUTES.adminAuditLogs,
        },
      ),
    [
      hostelSummary,
      hostelRows,
      participants,
      messSummary,
      messRows,
      messScansRecently,
      tiers.fast.updatedAt,
      eventSummary,
      workshopSummary,
      staffSummary,
      pulse,
      failedDomains,
    ],
  );

  // Names for the finance ledger's receipts, so a transaction reads
  // "Mess — Alakananda" instead of "Mess — M1".
  const messNames = useMemo(
    () => Object.fromEntries((mess ?? []).map((hall) => [hall.mess_id, hall.name])),
    [mess],
  );
  const hostelNames = useMemo(
    () => Object.fromEntries((hostels ?? []).map((block) => [block.hostel_id, block.name])),
    [hostels],
  );

  return (
    <FestivalScreen
      title="Overview"
      eyebrow="Super Admin"
      actions={
        <Button variant="secondary" onClick={refresh} disabled={snapshot.loading}>
          <RefreshCw
            size={15}
            strokeWidth={2.25}
            className={snapshot.loading ? 'mr-1.5 animate-spin' : 'mr-1.5'}
          />
          {snapshot.loading ? 'Refreshing…' : 'Refresh all'}
        </Button>
      }
    >
      {/* 1 — The pulse row: the four figures an admin checks first. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={Users}
          accent={DOMAIN_COLOR.people}
          label="On campus now"
          value={onCampus === null ? '—' : onCampus.toLocaleString()}
          {...(participants && onCampus !== null
            ? {
                progress: {
                  value: onCampus,
                  max: participants.total_registered,
                  label: 'Participants on campus, of everyone registered',
                  caption: `of ${participants.total_registered.toLocaleString()} registered`,
                },
              }
            : { footnote: 'checked into a hostel' })}
        />
        <KpiCard
          icon={Radio}
          accent={DOMAIN_COLOR.events}
          label="Live now"
          value={eventSummary.live}
          delta={{ percent: null, label: 'events currently running' }}
          footnote={
            eventSummary.startingSoon.length > 0
              ? `${eventSummary.startingSoon.length} starting within 6h`
              : undefined
          }
        />
        <KpiCard
          icon={UtensilsCrossed}
          accent={DOMAIN_COLOR.mess}
          label="Meals today"
          value={mealsToday.toLocaleString()}
          delta={{ percent: mealDelta, label: 'vs the previous hour' }}
          footnote={
            audit.truncated.includes('meal scans') ? 'trail truncated — a floor' : undefined
          }
        />
        <KpiCard
          icon={ShieldCheck}
          accent={DOMAIN_COLOR.staff}
          label="Staff active today"
          value={staffSummary.activeToday}
          progress={{
            value: staffSummary.activeToday,
            max: Math.max(staffSummary.accounts, 1),
            label: 'Staff who acted today, of all accounts',
            caption: `of ${staffSummary.accounts.toLocaleString()} accounts`,
          }}
        />
      </div>

      {/*
        2 — The command row: what is moving, beside what needs attention.
        `items-stretch` with the rail's own internal scroll is what keeps the two
        the same height regardless of how many alerts are open — the rail clips its
        least-urgent entries rather than stretching the page.
      */}
      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <LiveFlowPanel audit={audit} tier={tiers.fast} className="xl:col-span-2" />
        <AttentionRail
          alerts={alerts}
          pressure={pressure}
          tier={tiers.fast}
          loading={snapshot.loading}
        />
      </div>

      {/* 3 — The operational row: how far registrations got, and where campus is
             running out of room. */}
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <PipelinePanel
          stages={stages}
          registered={participants?.total_registered ?? null}
          tier={tiers.fast}
        />
        <CapacityBoard rows={capacity} tier={tiers.medium} />
      </div>

      {/* 4 — One series at full width, for "how did we get here". */}
      <TrendDeck audit={audit} tier={tiers.fast} />

      {/*
        5 — The per-section detail. Two panels per row from xl, stacked below.
        Panels are self-contained, so the order here is the only thing that decides
        the reading order: the operational spine first — where people sleep, eat,
        and go — then the organisation behind it, then money, then the raw trail.
      */}
      <div className="mt-2 grid gap-4 xl:grid-cols-2">
        <HostelsPanel
          hostels={hostels}
          stats={hostelStats}
          audit={audit}
          participants={participants}
          tier={tiers.medium}
        />
        <MessPanel mess={mess} stats={messStats} audit={audit} tier={tiers.medium} />
        <EventsPanel
          events={events}
          participation={participation}
          audit={audit}
          tier={tiers.slow}
        />
        <WorkshopsPanel workshops={workshops} tier={tiers.fast} />
        <StaffPanel
          staff={staff}
          events={events}
          mess={mess}
          hostels={hostels}
          workshops={workshops}
          audit={audit}
          tier={tiers.fast}
        />
        <ParticipantsPanel participants={participants} workshops={workshops} tier={tiers.fast} />
        <FinancePanel
          messStats={messStats}
          hostelStats={hostelStats}
          participation={participation}
          workshops={workshops}
          events={events}
          messNames={messNames}
          hostelNames={hostelNames}
          tier={tiers.slow}
        />
        <ActivityPanel audit={audit} tier={tiers.fast} />
      </div>
    </FestivalScreen>
  );
}
