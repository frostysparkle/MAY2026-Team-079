/**
 * What a hostel entry/exit scan actually resulted in.
 *
 * `POST /hostels/{id}/scan` answers 400 for four different situations and, as
 * everywhere else in this API, distinguishes them only by prose
 * (`backend/routers/hostels.py`):
 *
 *   - "Participant not allotted to this hostel"
 *   - "Participant is already inside"   (entry attempted on somebody inside)
 *   - "Participant is already outside"  (exit attempted on somebody outside)
 *   - "Invalid action. Must be 'entry' or 'exit'"
 *
 * The middle two are not really errors from the guard's point of view: the
 * participant is where they should be and the desk simply pressed the wrong side
 * of the toggle. Rendering them in the same red as "not allotted to this hostel"
 * — which *is* somebody to turn away — is the difference the guide asks for, and
 * the state it wants shown ("inside" / "outside") is knowable from which message
 * came back.
 *
 * Matching on the message rather than the status, because all four share 400. The
 * same technique the mess scanner uses for "Already logged in" and the workshop
 * scanner for "Attendee already marked present"; an unrecognised refusal falls
 * through to the server's own words, so a backend copy change degrades to plain
 * reporting rather than a wrong state.
 */

export type HostelScanState = 'inside' | 'outside' | 'unknown';

export type HostelScanKind =
  'logged' | 'already-inside' | 'already-outside' | 'not-allotted' | 'invalid-action' | 'unknown';

export interface HostelScanOutcome {
  kind: HostelScanKind;
  tone: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
  /**
   * Where the participant is now.
   *
   * On a refusal this is read from the message. On success it is derived from the
   * action, which is sound rather than a guess: the route refuses an entry for
   * somebody already inside and an exit for somebody already outside, so a 200 on
   * `entry` can only mean they are now inside. The response message
   * ("Scan successful, entry allowed") says the same thing.
   */
  state: HostelScanState;
}

/** A scan the backend accepted. */
export function readHostelScanSuccess(
  action: 'entry' | 'exit',
  message: string,
): HostelScanOutcome {
  return {
    kind: 'logged',
    tone: 'success',
    title: action === 'entry' ? 'Now Inside' : 'Now Outside',
    description: message.trim() || undefined,
    state: action === 'entry' ? 'inside' : 'outside',
  };
}

/** A scan the backend refused. */
export function readHostelScanFailure(
  action: 'entry' | 'exit',
  message: string,
): HostelScanOutcome {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (lower.includes('already inside')) {
    return {
      kind: 'already-inside',
      tone: 'warning',
      title: 'Already Inside',
      description:
        'They are already logged in to this block, so there was nothing to record. Switch to Exit if they are leaving.',
      state: 'inside',
    };
  }

  if (lower.includes('already outside')) {
    return {
      kind: 'already-outside',
      tone: 'warning',
      title: 'Already Outside',
      description:
        'They are already logged out of this block, so there was nothing to record. Switch to Entry if they are coming in.',
      state: 'outside',
    };
  }

  if (lower.includes('not allotted')) {
    return {
      kind: 'not-allotted',
      tone: 'error',
      title: 'Not allotted to this block',
      description:
        'This participant belongs to a different block, or has no room yet. Do not admit them here.',
      state: 'unknown',
    };
  }

  if (lower.includes('invalid action')) {
    return {
      kind: 'invalid-action',
      tone: 'error',
      title: 'Scanner sent an invalid action',
      description: `The desk asked for "${action}", which the server rejected. Reload this page.`,
      state: 'unknown',
    };
  }

  return {
    kind: 'unknown',
    tone: 'error',
    title: 'Scan failed',
    description: text || undefined,
    state: 'unknown',
  };
}
