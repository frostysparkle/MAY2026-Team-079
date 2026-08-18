import { useMemo } from 'react';
import { DOMAIN_COLOR, RankedBars, Sparkline, SplitBar, StatusBadge } from '@/components/ui';
import type { ParticipantStatisticsResponse, Workshop } from '@/api/types';
import type { TierState } from '../useFestSnapshot';
import { Figure, FigureRow, OverviewPanel, PanelBlock } from '../OverviewPanel';
import { orDash, orDashPercent } from '../format';

/**
 * How many people signed up for Paradox, and how far into the fest they got.
 *
 * Every figure here comes from `GET /participants/statistics`, which counts the
 * `participants` collection directly. That matters: it is a real registration
 * total, not the union-of-rosters proxy the board used to be limited to, which
 * could only ever report how many people had *turned up somewhere*.
 *
 * The demographic splits count only participants who completed a profile —
 * `house`, `program`, `gender` and `course_stage` are all written by
 * `PATCH /profile/complete` — so they total `profile_complete`, not
 * `total_registered`. The panel says so rather than leaving the discrepancy to
 * be discovered.
 */
export function ParticipantsPanel({
  participants,
  workshops,
  tier,
}: {
  participants: ParticipantStatisticsResponse | null;
  workshops: Workshop[] | null;
  tier: TierState;
}) {
  const signupTrend = useMemo(
    () =>
      Object.entries(participants?.signups_by_day ?? {}).map(([label, value]) => ({
        label,
        value,
      })),
    [participants],
  );

  const workshopBookings = useMemo(
    () => (workshops ?? []).reduce((sum, w) => sum + w.registration_count, 0),
    [workshops],
  );

  const houses = useMemo(
    () =>
      Object.entries(participants?.by_house ?? {})
        .map(([label, value]) => ({ key: label, label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    [participants],
  );

  if (participants === null) {
    return (
      <OverviewPanel
        domain="people"
        title="Participants"
        subtitle="Fest-wide registration"
        tier={tier}
        badge={<StatusBadge tone="neutral">Unavailable</StatusBadge>}
      >
        <p className="text-sm text-muted">Participant totals could not be loaded.</p>
      </OverviewPanel>
    );
  }

  const total = participants.total_registered;
  const completion = total > 0 ? (participants.profile_complete / total) * 100 : null;

  // The reach breakdown is the board's one all-six-domain mark, drawn in the
  // order the palette was validated in and with every segment direct-labelled.
  const reach = [
    {
      key: 'hostels',
      label: 'Hostel',
      value: participants.hostel_allotted,
      color: DOMAIN_COLOR.hostels,
    },
    { key: 'mess', label: 'Mess', value: participants.mess_allotted, color: DOMAIN_COLOR.mess },
    {
      key: 'workshops',
      label: 'Workshop',
      value: participants.with_workshop_registrations,
      color: DOMAIN_COLOR.workshops,
    },
    {
      key: 'events',
      label: 'Event',
      value: participants.with_event_registrations,
      color: DOMAIN_COLOR.events,
    },
  ];

  return (
    <OverviewPanel
      domain="people"
      title="Participants"
      subtitle="Fest-wide registration"
      tier={tier}
      badge={<StatusBadge tone="info">{total.toLocaleString()} registered</StatusBadge>}
    >
      <div className="rounded-xl bg-surface-2 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Total registered participants
        </p>
        <p className="text-4xl font-black leading-none tabular-nums text-ink">
          {total.toLocaleString()}
        </p>
        <p className="mt-1 text-xs text-muted">
          {participants.profile_complete.toLocaleString()} completed a profile (
          {orDashPercent(completion)}) · {participants.profile_incomplete.toLocaleString()} signed
          up but never finished
        </p>
      </div>

      <FigureRow>
        <Figure
          label="On campus"
          value={orDash(participants.currently_on_campus)}
          note="checked into a hostel"
          tone={participants.currently_on_campus > 0 ? 'good' : 'muted'}
        />
        <Figure
          label="In events"
          value={orDash(participants.with_event_registrations)}
          note={orDashPercent(
            total > 0 ? (participants.with_event_registrations / total) * 100 : null,
          )}
        />
        <Figure
          label="Hostel queue"
          value={orDash(participants.hostel_pending)}
          note="requested, not allotted"
          tone={participants.hostel_pending > 0 ? 'warn' : 'good'}
        />
        <Figure
          label="Workshop seats"
          value={workshopBookings.toLocaleString()}
          note="bookings, not people"
        />
      </FigureRow>

      <PanelBlock title="How far participants get">
        <SplitBar label="Participants reached by each fest domain" segments={reach} />
        <p className="text-[11px] text-muted">
          Counted per domain, not deduplicated — one participant appears in every domain they take
          part in.
        </p>
      </PanelBlock>

      <PanelBlock title="Sign-ups per day">
        <Sparkline
          points={signupTrend}
          domain="people"
          label="Participant sign-ups per day"
          caption={`${total.toLocaleString()} registrations since the first sign-up`}
        />
      </PanelBlock>

      <PanelBlock title="By house">
        <RankedBars
          rows={houses}
          domain="people"
          label="Participants by house"
          emptyText="No completed profiles yet"
        />
        <p className="text-[11px] text-muted">
          Houses are recorded when a profile is completed, so these total{' '}
          {participants.profile_complete.toLocaleString()}, not {total.toLocaleString()}.
        </p>
      </PanelBlock>
    </OverviewPanel>
  );
}
