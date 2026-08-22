/**
 * Whether a staff member's scanner is actually live for one duty.
 *
 * Mess and hostel team entries carry `logging`; workshop volunteers carry
 * `attendance`. A Super Admin can switch either off
 * (`PUT .../toggle_scan?logging=`, `?attendance=`), after which the backend
 * answers every scan with `403 "Scanning disabled for you"` /
 * `"Scanning disabled for this volunteer"`.
 *
 * Three states, not two, and the third one matters: `GET /workshops` projects
 * `workshop_team` out for everybody but a Super Admin, so a volunteer often
 * cannot read their own flag. `unknown` must therefore not be drawn as "off" —
 * that would tell a volunteer with a perfectly live scanner not to bother.
 */
export type DutyScanState = 'on' | 'off' | 'unknown';

/** The flag as it appears on a mess or hostel team entry. */
export function loggingState(member: { logging?: boolean } | undefined): DutyScanState {
  if (!member) return 'unknown';
  if (member.logging === undefined) return 'unknown';
  return member.logging ? 'on' : 'off';
}

/** The flag as it appears on a workshop volunteer entry. */
export function attendanceState(member: { attendance?: boolean } | undefined): DutyScanState {
  if (!member) return 'unknown';
  if (member.attendance === undefined) return 'unknown';
  return member.attendance ? 'on' : 'off';
}

/**
 * Should the duty card offer its scanner link?
 *
 * Only a definite `off` withholds it. `unknown` still offers the link, because
 * the page cannot tell and the scanner screen itself re-checks and explains.
 */
export function mayOpenScanner(state: DutyScanState): boolean {
  return state !== 'off';
}

/** The line a duty card shows when scanning is switched off. */
export const SCANNING_OFF_NOTE =
  'A Super Admin has switched your scanning off here, so codes would be refused.';
