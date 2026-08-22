/**
 * What a refused event registration actually means.
 *
 * `POST /events/{id}/register` has three documented refusals
 * (`backend/routers/events.py`), each needing a different screen afterwards:
 *
 *   - `409 "User is already registered for this event."` — the seat is held; the
 *     page should show that rather than an error over an active Register button.
 *   - `400 "Registration is closed for this event"` — the event closed since the
 *     page loaded, so the form must go away.
 *   - `403 "Event team members cannot register as participants for their own
 *     event."` — permanent for this event and this account; the control should
 *     stay disabled rather than inviting another attempt.
 *
 * Classifying on status first and message second: the status codes are distinct
 * here (unlike the workshop route, where all four refusals are 400), so the
 * message is only used to tell the 400s apart.
 */

export type EventRegisterFailureKind =
  'already-registered' | 'registration-closed' | 'on-event-team' | 'validation' | 'unknown';

export interface EventRegisterFailure {
  kind: EventRegisterFailureKind;
  tone: 'error' | 'warning' | 'success';
  title: string;
  description?: string;
  /** Another attempt could plausibly succeed. False for the three above. */
  retryable: boolean;
  /** The event record is known to be stale; re-read it. */
  refreshEvent: boolean;
}

export function readEventRegisterFailure(
  status: number | undefined,
  message: string,
): EventRegisterFailure {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (status === 409 || lower.includes('already registered for this event')) {
    return {
      kind: 'already-registered',
      tone: 'success',
      title: 'You’re already registered for this event',
      description: 'Your entry is confirmed. Nothing more to do here.',
      retryable: false,
      // Re-read so the page can swap the form for the registered state and its
      // cancel control.
      refreshEvent: true,
    };
  }

  if (status === 403 || lower.includes('event team members cannot register')) {
    return {
      kind: 'on-event-team',
      tone: 'warning',
      title: 'You’re on this event’s team',
      description:
        'Staff and volunteers running an event cannot enter it as participants. You can still scan attendance for it from the staff area.',
      retryable: false,
      refreshEvent: false,
    };
  }

  if (lower.includes('registration is closed')) {
    return {
      kind: 'registration-closed',
      tone: 'warning',
      title: 'Registration has just closed',
      description: 'The organisers closed entries while this page was open.',
      retryable: false,
      refreshEvent: true,
    };
  }

  if (status === 422) {
    return {
      kind: 'validation',
      tone: 'error',
      title: 'Some answers need fixing',
      description: text || undefined,
      retryable: true,
      refreshEvent: false,
    };
  }

  return {
    kind: 'unknown',
    tone: 'error',
    title: 'Could not register',
    description: text || undefined,
    retryable: true,
    refreshEvent: true,
  };
}
