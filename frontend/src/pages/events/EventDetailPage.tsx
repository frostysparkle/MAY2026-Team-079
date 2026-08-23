import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Pencil } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { reportApiError } from '@/api/report';
import type { Event, MyEventRegistration } from '@/api/types';
import { readEventExtras } from '@/features/events/eventExtras';
import { ROUTES } from '@/config/routes';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  ErrorState,
  ResultBanner,
  Skeleton,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { EventDetailView } from '@/components/events/EventDetailView';
import { fullEventView } from '@/features/events/eventView';
import { EventRegistrationForm } from '@/features/events/EventRegistrationForm';
import { EventCrowdCard } from '@/features/events/EventCrowdCard';
import { useEventCrowd } from '@/features/events/useEventCrowd';
import { EventAnnouncementsPanel } from '@/features/events/EventAnnouncementsPanel';
import { useEventAnnouncements } from '@/features/events/useEventAnnouncements';

/**
 * An event as the participant sees it — the very same `EventDetailView` the public
 * brochure and `AdminEventDetailPage` render, so the page an admin reviews, the
 * page a visitor reads, and the page a participant registers on are one design
 * with one implementation.
 *
 * This page used to hand-roll its own hero, meta grid, rounds list, prize list and
 * registration form. All five now come from the shared view, and what is left here
 * is the part that is genuinely specific to being signed in: registering,
 * cancelling, and the banner saying which of those applies.
 *
 * Uses `fullEventView` rather than the public normaliser: a participant may hold a
 * registration for an `event_type: 'others'` event, which has no public category,
 * and that must still open.
 *
 * Story 3.3 sits between the meta tiles and the registration action: how busy the
 * event is right now, refreshed after the participant registers or cancels so the
 * count they are looking at includes what they just did.
 */
export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [registration, setRegistration] = useState<MyEventRegistration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Whether the amend-answers form is open, for `PUT /events/{id}/register`. */
  const [editing, setEditing] = useState(false);
  // The published capacity is read from the event the page already holds, so the
  // parsing rule lives in one place — see `eventExtras.parseCapacity`.
  const capacity = event ? readEventExtras(event.registration).capacity : undefined;
  const { counts, reload: reloadCrowd } = useEventCrowd(eventId);
  // Story 8.2. Reads `GET /events/{id}/announcements`, which 403s for anyone
  // not registered for this event — the hook degrades that to an empty list
  // rather than an error, so this is safe to call before `registration` loads.
  const announcements = useEventAnnouncements(eventId);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    Promise.all([api.listEvents(), api.myEventRegistrations()])
      .then(([events, registrations]) => {
        const found = events.find((e) => e.event_id === eventId);
        if (!found) {
          setLoadError('That event no longer exists.');
          return;
        }
        setEvent(found);
        setRegistration(
          registrations.find((r) => r.event_id !== null && r.event_id === eventId) ?? null,
        );
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the event.'),
      );
  }
  useEffect(load, [eventId]);

  /**
   * Re-read the event *and* the crowd counts.
   *
   * Used by the two actions that change what those counts say — registering and
   * cancelling — so the participant sees a figure that includes what they just
   * did. The mount read is not here: `useEventCrowd` does its own, and folding
   * it into `load` would make the mount effect depend on the hook's callback.
   */
  function refresh() {
    load();
    void reloadCrowd();
  }

  async function cancel() {
    setActionError(null);
    setBusy(true);
    try {
      await api.cancelEventRegistration(eventId);
      refresh();
    } catch (e) {
      setActionError(reportApiError(e, 'Could not cancel your registration.'));
    } finally {
      setBusy(false);
    }
  }

  const backToEvents = { label: 'Events', onClick: () => navigate(ROUTES.events) };

  if (loadError) {
    return (
      <FestivalScreen title="Event" eyebrow="Programme" back={backToEvents}>
        <ErrorState title="Could not load event" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  if (!event) {
    return (
      <FestivalScreen title="Event" eyebrow="Programme" back={backToEvents}>
        {/* `rounded-2xl`, so the placeholder has the corner of the panel that
            replaces it. `Skeleton` defaults to `rounded-lg`, which is the radius
            of an input, not of a card. */}
        <Skeleton className="h-96 rounded-2xl" />
      </FestivalScreen>
    );
  }

  const view = fullEventView(event);

  return (
    <FestivalScreen
      title={view.category.label}
      eyebrow="Programme"
      subtitle={event.registration.is_open ? 'Registration is open' : 'Registration is closed'}
      back={backToEvents}
      actions={
        <Button variant="secondary" onClick={() => navigate(ROUTES.schedule)}>
          <CalendarDays size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Fest schedule
        </Button>
      }
    >
      {actionError && (
        <ResultBanner variant="error" title="Action failed">
          {actionError}
        </ResultBanner>
      )}

      {/* The loose "Closed for registration" pill that used to sit here is gone.
          It was a top-level block holding one badge, so it took a full 20px of the
          screen's gap above and below to say what the subtitle two lines up
          already says in words ("Registration is closed") — and the registration
          form below it says a third time. A stray chip on its own line is also the
          one thing on these screens that is neither a panel nor a banner, which is
          what made this page's rhythm read as broken. */}
      <EventDetailView
        view={view}
        crowd={counts && <EventCrowdCard counts={counts} capacity={capacity} />}
        action={
          registration ? (
            <div className="flex flex-col gap-3">
              <ResultBanner variant="success" title="You're registered">
                {registration.team_id
                  ? `Team ${registration.team_id} · ${registration.team_role}`
                  : 'Solo entry'}
              </ResultBanner>

              {/* The answers as submitted, and — while entries are open — the way
                  to change them. `PUT /events/{id}/register` has been in the client
                  all along with nothing calling it, so a mistyped answer could
                  only be fixed by cancelling and re-entering, which for a team
                  entry also threw away the team. */}
              <RegistrationAnswers event={event} registration={registration} />

              {/* Withdrawing is offered whether or not entries are still open,
                  because `DELETE /events/{id}/register` accepts it either way.
                  Only *amending* answers needs an open window, so only that is
                  behind `event.registration.is_open` — the two used to share this branch, which
                  meant a closed window removed the way out of a registration
                  along with the way to correct it. */}
              {editing ? (
                <EventRegistrationForm
                  event={event}
                  mode="edit"
                  initialAnswers={registration.registration_data}
                  onRegistered={() => {
                    setEditing(false);
                    refresh();
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    {event.registration.is_open && hasAnswerableFields(event) && (
                      <Button
                        variant="secondary"
                        className="w-fit"
                        onClick={() => setEditing(true)}
                      >
                        <Pencil size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Edit
                        answers
                      </Button>
                    )}
                    <Button variant="danger" loading={busy} onClick={cancel} className="w-fit">
                      Undo registration
                    </Button>
                  </div>
                  {!event.registration.is_open && (
                    <p className="text-sm text-muted">
                      Registration has closed, so your answers can no longer be changed — but you
                      can still withdraw.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Handles the closed case, the team rule, and the admin-configured
            // fields — the same form the public event page submits.
            <EventRegistrationForm event={event} onRegistered={refresh} />
          )
        }
      />

      {/* Story 8.2. Only a registrant can read this event's announcements
          (`_may_read_announcements` in `backend/routers/events.py`), so there is
          nothing to show anybody else — the panel is skipped entirely rather
          than rendered empty for a participant who has not registered. */}
      {registration && <EventAnnouncementsPanel state={announcements} canPublish={false} />}
    </FestivalScreen>
  );
}

/* --------------------------------------------------------------- helpers --- */

/** Does this event ask anything an amendment could change? */
function hasAnswerableFields(event: Event): boolean {
  return (event.registration_fields ?? []).length > 0;
}

/**
 * The answers this participant submitted, read back.
 *
 * `GET /events/my_registrations` has always returned `registration_data` and no
 * screen showed it, so a participant could not check what they had entered — let
 * alone tell whether it needed correcting. Labelled with the event's own field
 * labels rather than the raw `field_id` keys, and questions left blank are named
 * as unanswered instead of omitted, since a missing answer is the thing most
 * worth noticing here.
 */
function RegistrationAnswers({
  event,
  registration,
}: {
  event: Event;
  registration: MyEventRegistration;
}) {
  const fields = event.registration_fields ?? [];
  if (fields.length === 0) return null;

  return (
    <dl className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
      {fields.map((field) => {
        const raw = registration.registration_data?.[field.field_id];
        const answered = raw !== undefined && raw !== null && String(raw).trim() !== '';
        return (
          <div key={field.field_id} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-xs font-semibold uppercase tracking-wider text-muted">
              {field.label}
            </dt>
            <dd className={answered ? 'text-sm font-medium text-ink' : 'text-sm italic text-muted'}>
              {answered ? formatAnswer(raw) : 'Not answered'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** `"true"` and `true` both read as Yes — the form writes the string form. */
function formatAnswer(value: unknown): string {
  if (value === true || value === 'true') return 'Yes';
  if (value === false || value === 'false') return 'No';
  return String(value);
}
