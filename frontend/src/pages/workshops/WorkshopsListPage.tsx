import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Sparkles, Wrench } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
import { useRecommendations } from '@/features/ai/useRecommendations';
import { path, ROUTES } from '@/config/routes';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  EmptyState,
  ErrorState,
  SectionBlock,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  EVENT_GRID_CLASS,
  EventGridSkeleton,
  EventPosterCard,
} from '@/features/events/EventPosterCard';
import {
  useMyWorkshopBookings,
  type MyWorkshopBookings,
} from '@/features/workshops/useMyWorkshopBookings';
import { useLiveSeats } from '@/features/workshops/useLiveSeats';
import { sortWorkshops, workshopView, WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { shiftLabel, workshopDayLabel } from '@/features/workshops/workshopSlot';
import { AiRecommendBar } from '@/features/ai/AiRecommendBar';

/**
 * The in-app workshop programme — the same flyer grid, grouped by the day each
 * workshop runs on, that `AdminWorkshopsPage` and the public catalogue use.
 *
 * The participant layer on top of it is the seat count, which is live over SSE,
 * and the one-per-shift rule: a workshop clashing with one already booked is
 * dimmed rather than hidden, so the reason it cannot be taken stays visible.
 */

/** A day heading plus the workshops running that day. */
interface Section {
  key: string;
  label: string;
  views: ReturnType<typeof workshopView>[];
}

/** Workshops whose slot id carries no date still need somewhere to live. */
const UNDATED = 'Unscheduled';

/**
 * How many of the top-ranked cards carry the "Suggested" badge when an AI
 * ranking is active. The backend already returns every workshop sorted most
 * similar first, so this is purely a display cutoff — cards ranked 6th or
 * lower stay in the list (nothing is hidden), they just lose the badge.
 */
const TOP_RECOMMENDED_COUNT = 5;

export default function WorkshopsListPage() {
  const navigate = useNavigate();
  const [workshops, setWorkshops] = useState<Workshop[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Client-side recommendations hook - no backend call except for embedding generation
  const { rankedItems: recommended, isGenerating: recommendLoading, error: recommendError, rankByQuery, rankBySaved } = useRecommendations({
    items: workshops || [],
    savedEmbedding: null, // TODO: Get from profile when available
    onEmbeddingUpdate: (embedding) => {
      // TODO: Save to profile via PATCH /profile/complete
      console.log('New workshop embedding generated:', embedding.slice(0, 5), '...');
    },
  });

  // The slots this participant already holds, read from
  // `GET /workshops/my_registrations` — so a clash stays greyed out after a
  // reload and for a booking made on another device.
  const bookings = useMyWorkshopBookings();

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listWorkshops()
      .then((all) => {
        setWorkshops(all);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshops.'),
      );
  }
  useEffect(load, []);

  async function handleRecommend(query: string) {
    await rankByQuery(query);
  }

  function clearRecommendations() {
    // Reset to empty so the banner shows "not active"
    rankBySaved();
  }

  // Kept in the similarity order — most-similar-first — rather than
  // run through `sortWorkshops`, which reorders chronologically. Re-ranking by
  // match is the entire point of this view.
  const recommendedViews = useMemo(() => 
    recommended.length > 0 && recommended.some(w => w.similarity > 0)
      ? recommended.map(workshopView) 
      : null, 
    [recommended]
  );

  const sections = useMemo<Section[]>(() => {
    if (!workshops) return [];
    const views = sortWorkshops(workshops.map(workshopView));

    const byDay = new Map<string, Section>();
    for (const view of views) {
      const key = view.slot.date ?? UNDATED;
      const label = view.slot.date ? workshopDayLabel(view.slot.date) : UNDATED;
      const section = byDay.get(key) ?? { key, label, views: [] };
      section.views.push(view);
      byDay.set(key, section);
    }
    return [...byDay.values()];
  }, [workshops]);

  // Inside the screen rather than instead of it — see `EventsListPage` for why a
  // bare `ErrorState` is a full-bleed message with no section title on it.
  if (loadError) {
    return (
      <FestivalScreen title="Workshops" eyebrow="Programme">
        <ErrorState title="Could not load workshops" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  const seatsLeft =
    workshops?.reduce((sum, w) => sum + Math.max(0, w.capacity - w.registration_count), 0) ?? 0;

  return (
    <FestivalScreen
      title="Workshops"
      eyebrow="Programme"
      subtitle={
        workshops === null
          ? 'Loading the programme…'
          : `${workshops.length} workshop${workshops.length === 1 ? '' : 's'} · ${seatsLeft.toLocaleString()} seats left · ${
              bookings.count === 0
                ? 'one booking per shift'
                : `${bookings.count} shift${bookings.count === 1 ? '' : 's'} booked`
            }`
      }
      // Carries its glyph now, like the "Schedule" button on the event catalogue
      // and the "Fest schedule" one on an event's own page. It was the only
      // schedule link in the participant area with a bare label.
      actions={
        <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)}>
          <CalendarDays size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Fest schedule
        </Button>
      }
    >
      {workshops !== null && workshops.length > 0 && (
        <AiRecommendBar
          noun="workshops"
          placeholder="e.g. hands-on coding, design, public speaking…"
          active={recommendedViews !== null}
          loading={recommendLoading}
          onSearch={handleRecommend}
          onClear={clearRecommendations}
          available={true}
        />
      )}

      {recommendError && (
        <ErrorState
          title="Could not get recommendations"
          description={recommendError}
          onRetry={() => handleRecommend('')}
        />
      )}

      {workshops === null ? (
        <EventGridSkeleton />
      ) : workshops.length === 0 ? (
        <EmptyState
          title="No workshops yet"
          description="The programme appears here as soon as the organisers publish it."
          icon={Wrench}
        />
      ) : recommendedViews !== null ? (
        <SectionBlock
          title="Recommended for you"
          meta={`${recommendedViews.length} workshop${recommendedViews.length === 1 ? '' : 's'} · ranked by match`}
        >
          <ul className={EVENT_GRID_CLASS}>
            {/* Backend already sorts by similarity, most similar first, so the
                top 5 by array position are the top 5 by score. */}
            {recommendedViews.map((view, index) => (
              <WorkshopPosterCard
                key={view.id}
                view={view}
                bookings={bookings}
                suggested={index < TOP_RECOMMENDED_COUNT}
              />
            ))}
          </ul>
        </SectionBlock>
      ) : (
        sections.map((section) => (
          <SectionBlock
            key={section.key}
            title={section.label}
            meta={`${section.views.length} workshop${section.views.length === 1 ? '' : 's'}`}
          >
            <ul className={EVENT_GRID_CLASS}>
              {section.views.map((view) => (
                <WorkshopPosterCard key={view.id} view={view} bookings={bookings} />
              ))}
            </ul>
          </SectionBlock>
        ))
      )}
    </FestivalScreen>
  );
}

/**
 * One flyer tile with its live seat count.
 *
 * A component of its own because `useLiveSeats` opens one SSE subscription per
 * workshop, and a hook cannot be called inside the grid's `map`.
 */
function WorkshopPosterCard({
  view,
  bookings,
  suggested = false,
}: {
  view: ReturnType<typeof workshopView>;
  bookings: MyWorkshopBookings;
  /** Marks this tile as part of the AI-ranked view, alongside its other badges. */
  suggested?: boolean;
}) {
  const seats = useLiveSeats(
    view.id,
    view.seatsLeft === undefined
      ? null
      : { remaining_seats: view.seatsLeft, capacity: view.capacity },
  );

  // The raw `slot_id` off the record, not one rebuilt from the parsed day and
  // shift: a hand-typed slot id parses to nothing, and the conflict cache is
  // keyed on whatever string the backend actually enforces the rule against.
  const status = bookings.slotStatus(view.workshop?.slot_id ?? '', view.id);
  const clashes = status === 'conflict';
  const soldOut = seats !== null && seats.remaining_seats <= 0;

  const statusBadge = clashes ? (
    <StatusBadge tone="warning" className="shadow-card ring-1 ring-line">
      Clashes
    </StatusBadge>
  ) : status === 'own' ? (
    <StatusBadge tone="success" className="shadow-card ring-1 ring-line">
      Booked
    </StatusBadge>
  ) : soldOut ? (
    <StatusBadge tone="danger" className="shadow-card ring-1 ring-line">
      Full
    </StatusBadge>
  ) : seats ? (
    <StatusBadge tone="neutral" className="shadow-card ring-1 ring-line">
      {seats.remaining_seats} left
    </StatusBadge>
  ) : null;

  const badge = (
    <span className="flex flex-wrap items-center gap-1.5">
      {suggested && (
        <StatusBadge tone="info" className="shadow-card ring-1 ring-line">
          <Sparkles size={11} strokeWidth={2.5} className="mr-1 inline" />
          Suggested
        </StatusBadge>
      )}
      {statusBadge}
    </span>
  );

  return (
    <EventPosterCard
      to={path(ROUTES.workshopDetail, { workshopId: view.id })}
      name={view.name}
      poster={view.poster}
      fallbackImage={WORKSHOP_COVER}
      dimmed={clashes}
      meta={
        clashes
          ? 'Clashes with a workshop you booked'
          : [view.slot.shift && shiftLabel(view.slot.shift), view.venue].filter(Boolean).join(' · ')
      }
      badge={badge}
    />
  );
}
