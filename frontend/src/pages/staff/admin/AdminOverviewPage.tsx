import { useMemo } from 'react';
import { RefreshCw, Radio, ShieldCheck, UtensilsCrossed, Users } from 'lucide-react';
import { Button, DOMAIN_COLOR } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { ROUTES, staffSupportPath } from '@/config/routes';
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
import { summariseSupport } from '@/features/overview/supportMetrics';
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
import { SupportPanel } from '@/features/overview/panels/SupportPanel';
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
    queries,
    issues,
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
          /*
           * Who acted today, counted across the whole day rather than inferred
           * from a page.
           *
           * This used to be `uniqueActors(rowsOnDay(audit.recent))` — the actors
           * appearing in the newest 60 unfiltered rows, filtered to today. On a
           * quiet fest that happens to be right; on a busy one 60 rows can span
           * minutes, so the figure was a floor that drifted further from the truth
           * the more the fest did. `audit.today.actor_ids` is the distinct set for
           * the viewer's calendar day, counted server-side with no limit in front
           * of it.
           *
           * The old derivation stays as the fallback, so losing the summary call
           * degrades the number rather than blanking the card.
           */
          audit.today ? new Set(audit.today.actor_ids) : uniqueActors(rowsOnDay(audit.recent)),
        ),
      ),
    [staff, events, mess, hostels, workshops, audit.today, audit.recent],
  );

  const onCampus = useMemo(
    () =>
      participants?.currently_on_campus ??
      (hostelRows.every((row) => row.inside !== null)
        ? hostelRows.reduce((sum, row) => sum + (row.inside ?? 0), 0)
        : null),
    [participants, hostelRows],
  );

  /*
   * Meals served today — people fed, not cards read.
   *
   * `meals_served` de-duplicates to one entry per `(diner, day, slot)` across the
   * whole day, server-side. The client-side matrix does the same arithmetic and
   * remains the fallback, but it can only ever see the newest `messScans` rows,
   * which is why the exact figure is preferred when it is there.
   */
  const mealsToday = useMemo(
    () => audit.today?.meals?.meals_served ?? mealMatrix(rowsOnDay(audit.messScans)).total,
    [audit.today, audit.messScans],
  );
  /** Re-scans behind today's figure — read twice, fed once. */
  const duplicateScansToday = audit.today?.meals?.duplicate_scans ?? null;
  /** Distinct people fed today, which is smaller than meals whenever anyone ate twice. */
  const dinersToday = audit.today?.meals?.unique_diners ?? null;

  const messScansRecently = useMemo(() => rowsSince(audit.messScans, 20).length, [audit.messScans]);
  // The time-bounded feed, not `recent`: comparing this hour with the previous six
  // is only possible over a window defined in hours.
  const pulse = useMemo(() => activityPulse(audit.pulse), [audit.pulse]);

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

  /**
   * The support backlog, for the alert rail.
   *
   * `SupportPanel` counts these for itself, but a panel is something an admin has
   * to scroll to. The alert engine is what surfaces without being looked for, and
   * it had no view of either queue until this was passed in.
   */
  const support = useMemo(() => summariseSupport(queries, issues), [queries, issues]);

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
          support,
          failedDomains,
        },
        {
          hostels: ROUTES.adminHostels,
          mess: ROUTES.adminMess,
          events: ROUTES.adminEvents,
          workshops: ROUTES.adminWorkshops,
          staff: ROUTES.adminBackendTeams,
          auditLogs: ROUTES.adminAuditLogs,
          // Straight to the tab that holds the backlog the alert is about, rather
          // than through the redirect the old paths now serve.
          queries: staffSupportPath('questions'),
          issues: staffSupportPath('faults'),
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
      support,
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
          {...(participants && onCampus !== null && participants.hostel_allotted > 0
            ? {
                /*
                 * Measured against residents, not against everyone registered.
                 *
                 * `currently_on_campus` counts `accommodation.logged_in`, which
                 * only a participant holding a hostel bed can ever set — it is
                 * written by the hostel entry scanner. Dividing it by
                 * `total_registered` therefore compared two different
                 * populations: every day visitor sat in the denominator with no
                 * way to appear in the numerator, so the bar read far emptier
                 * than campus actually was and could never reach 100%.
                 *
                 * `hostel_allotted` is the population the numerator is drawn
                 * from, which makes the ratio "residents currently inside, of
                 * residents" — a figure that can legitimately reach full.
                 */
                progress: {
                  value: onCampus,
                  max: participants.hostel_allotted,
                  label: 'Residents scanned in, of everyone with a hostel bed',
                  caption: `of ${participants.hostel_allotted.toLocaleString()} with a bed`,
                },
              }
            : { footnote: 'residents scanned into a hostel' })}
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
          /*
           * With the exact summary loaded this is a complete count, so the old
           * "trail truncated" caveat no longer applies to it — the truncation
           * warning belongs to the feed the *chart* is drawn from, not to this
           * number. What is worth surfacing instead is how many diners those meals
           * fed, and how many re-scans were discarded to get there, because that
           * is the difference between this figure and the raw scan count somebody
           * might tally from the trail.
           */
          footnote={
            audit.today?.meals
              ? dinersToday !== null && duplicateScansToday
                ? `${dinersToday.toLocaleString()} diners · ${duplicateScansToday.toLocaleString()} re-scans ignored`
                : dinersToday !== null
                  ? `${dinersToday.toLocaleString()} diners`
                  : undefined
              : audit.truncated.includes('meal scans')
                ? 'trail truncated — a floor'
                : undefined
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
          // Says which of the two derivations produced the number, because they
          // differ: one is the day, the other is whatever fitted in 60 rows.
          footnote={audit.today ? undefined : 'from recent activity — a floor'}
        />
      </div>

      {/*
        2 — The command row: what is moving, beside what needs attention.

        `xl:auto-rows-[34rem]` is what actually holds the two cards to one height.
        The rail's internal scroll alone did not: a grid row sized `auto` takes the
        tallest item's *content* height, and a scroll container still reports its
        full content, so fifteen open alerts grew the row and the flow panel beside
        it stretched to match. Fixing the row makes the rail scroll instead. The
        height clears the flow panel's 236px chart and its blocks, and that panel
        scrolls too rather than clipping if a translation or a font size overruns.

        Only from `xl`, where the row is three columns wide and neither card's
        header wraps. Stacked below that, each card is its own row and sizing them
        to content is right — a phone scrolls the page, not the card.
      */}
      <div className="grid items-stretch gap-4 xl:auto-rows-[34rem] xl:grid-cols-3">
        <LiveFlowPanel audit={audit} tier={tiers.fast} className="xl:col-span-2" />
        <AttentionRail
          alerts={alerts}
          pressure={pressure}
          tier={tiers.fast}
          loading={snapshot.loading}
        />
      </div>

      {/* 3 — The operational row: how far registrations got, and where campus is
             running out of room.
             `auto-rows-[30rem]` fixes both cards' height instead of letting the
             capacity table's row count decide it. Without it the grid row grows to
             whatever the fullest campus needs — thirty blocks and halls made a
             card taller than the viewport, and the pipeline beside it stretched to
             match. A fixed row is what makes the internal scrolls below engage.
             The height fits the pipeline's seven stages outright, so the card that
             cannot scroll is never the one that has to. */}
      <div className="grid auto-rows-[30rem] items-stretch gap-4 xl:grid-cols-2">
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

        `minmax(0,40rem)` is a ceiling on each row, not a fixed height, and the
        distinction is what makes it safe across nine panels of very different
        weights. A row still sizes itself to its taller panel while that fits;
        past 40rem it stops, and `OverviewPanel`'s body scrolls. What this ends is
        one dense panel dictating a row far taller than its neighbour has content
        for — Participants left Staff & Volunteers around two hundred pixels of
        empty glass, and Finance did the same to Support. A fixed height would have
        cost the opposite: the lightest panels padded out to the tallest one's size,
        and the lone Live activity panel on the last row stretched for no reason.
      */}
      <div className="mt-2 grid gap-4 xl:auto-rows-[minmax(0,40rem)] xl:grid-cols-2">
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
        {/* Story 9.1's two missing panels — open queries and reported faults —
            folded into one, because the question an admin is asking is "is
            anybody waiting on us". */}
        <SupportPanel queries={queries} issues={issues} tier={tiers.fast} />
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
