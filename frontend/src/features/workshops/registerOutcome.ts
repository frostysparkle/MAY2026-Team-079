/**
 * What a refused workshop booking actually means.
 *
 * `POST /workshops/{id}/register` answers 400 in four materially different
 * situations and distinguishes them only by prose
 * (`backend/routers/workshops.py`):
 *
 *   - "Workshop is full"
 *   - "Already registered for this workshop"
 *   - "Already registered for another workshop in this time slot"
 *   - "Failed to register. Workshop might have just filled up."
 *
 * Printing the string and stopping — which is what the page used to do — leaves
 * the participant looking at an active Register button after being told they are
 * already registered, and leaves the catalogue's clash hint none the wiser about
 * a conflict the server just reported. Classifying the refusal lets the screen
 * correct itself.
 *
 * Matching is on the message because there is no other signal: all four share
 * status 400. Anything unrecognised falls through to `unknown`, which shows the
 * server's own words — so a backend copy change degrades to today's behaviour
 * rather than swallowing the reason.
 */

export type WorkshopRegisterFailureKind =
  'full' | 'already-registered' | 'slot-clash' | 'race' | 'unknown';

export interface WorkshopRegisterFailure {
  kind: WorkshopRegisterFailureKind;
  /** Banner tone. A clash or an existing booking is not an error to the reader. */
  tone: 'error' | 'warning' | 'success';
  title: string;
  description?: string;
  /** Worth offering another attempt — only true for the race. */
  retryable: boolean;
  /** The seat count is known to be stale; re-read it. */
  refreshSeats: boolean;
  /** This participant's held slots are known to be stale; re-read them. */
  refreshBookings: boolean;
}

export function readWorkshopRegisterFailure(message: string): WorkshopRegisterFailure {
  const text = message.trim().toLowerCase();

  if (text.includes('already registered for another workshop')) {
    return {
      kind: 'slot-clash',
      tone: 'warning',
      title: 'You already hold a workshop in this shift',
      description:
        'Only one booking per shift is allowed. Cancel the other one first, or pick a workshop in a different shift.',
      retryable: false,
      refreshSeats: false,
      // The catalogue did not know about the clashing booking, or it would have
      // greyed this out. Re-read so the rest of the shift greys out too.
      refreshBookings: true,
    };
  }

  if (text.includes('already registered for this workshop')) {
    return {
      kind: 'already-registered',
      tone: 'success',
      title: 'You’re already registered for this workshop',
      description: 'Your seat is held. Nothing more to do.',
      retryable: false,
      refreshSeats: false,
      refreshBookings: true,
    };
  }

  // Checked before the plain "full" match: this message also contains "filled
  // up", and it means "somebody beat you to the last seat", not "the room was
  // already full when the page loaded".
  if (text.includes('failed to register')) {
    return {
      kind: 'race',
      tone: 'warning',
      title: 'That seat went while you were booking',
      description:
        'Somebody claimed the last place a moment before you. Check the seat count and try again.',
      retryable: true,
      refreshSeats: true,
      refreshBookings: false,
    };
  }

  if (text.includes('workshop is full')) {
    return {
      kind: 'full',
      tone: 'error',
      title: 'This workshop is full',
      description: 'Every seat is taken. The count above updates live if one is released.',
      retryable: false,
      refreshSeats: true,
      refreshBookings: false,
    };
  }

  return {
    kind: 'unknown',
    tone: 'error',
    title: 'Could not register',
    description: message.trim() || undefined,
    retryable: true,
    refreshSeats: true,
    refreshBookings: true,
  };
}
