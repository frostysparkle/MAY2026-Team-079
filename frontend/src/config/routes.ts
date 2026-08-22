/**
 * Central route path definitions. Referencing ROUTES.* instead of raw strings
 * keeps navigation refactor-safe and avoids typo'd paths across the app.
 */
export const ROUTES = {
  splash: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  adminLogin: '/admin/login',
  completeProfile: '/complete-profile',
  accessDenied: '/access-denied',

  // Public festival brochure — no auth, rendered from static catalogue data
  publicEvents: '/events',
  publicEventCategory: '/events/:category',
  publicEventDetail: '/events/:category/:eventId',
  publicSchedule: '/schedule',
  publicWorkshops: '/workshops',
  publicWorkshopDetail: '/workshops/:workshopId',
  sponsors: '/sponsors',

  /**
   * Participant area.
   *
   * `home` is the participant's Landing Page — the same PARADOX portal a visitor
   * sees at `splash`, with the perimeter nav filtered to the sections a signed-in
   * participant may open. It is deliberately *not* inside the nav shell: the
   * portal is a full-viewport hero and owns its own header.
   *
   * Every other participant route below renders inside `AppShell`, unchanged.
   */
  home: '/app',
  /** The figures screen that used to be the `/app` index. */
  dashboard: '/app/dashboard',
  profile: '/app/profile',
  changePassword: '/app/profile/change-password',
  myQr: '/app/qr',
  events: '/app/events',
  eventDetail: '/app/events/:eventId',
  myRegistrations: '/app/events/mine',
  schedule: '/app/schedule',
  workshops: '/app/workshops',
  workshopDetail: '/app/workshops/:workshopId',
  /**
   * Accommodation & Mess. One route for both halves of a student's stay,
   * because the choice is made once and across both — and the confirmation
   * (block, room, hall, entry QR) reads as one thing, not two screens.
   */
  accommodation: '/app/accommodation',
  /** The mock checkout that settles that choice. */
  accommodationPayment: '/app/accommodation/payment',
  /**
   * Official notices addressed to this participant — Stories 8.1/8.2. The
   * dashboard carries the first few; this is the full list.
   */
  announcements: '/app/announcements',
  /**
   * Help & Support — every way a participant reaches a human, in one section.
   *
   * One route with three tabs, selected by `?tab=`:
   *
   *   - `ask`      Stories 6.1/6.2 — raise a question and read the answer.
   *   - `report`   Story 5.4 — file a hostel or mess fault and track the repair.
   *   - `contacts` Story 6.5 — the coordinators on duty, and your own next-of-kin.
   *
   * These were three routes until they were not. Each one linked to the other two
   * and each carried a paragraph on why it was not the other two, which is a fair
   * sign the split lived in the navigation rather than in the student's head: from
   * their side it is one errand — something needs dealing with — and three answers
   * to "what do you want back". Sharing a screen also lets one row of figures
   * cover both the questions and the reports, which no single one of them could.
   *
   * The three old paths below still resolve; they redirect here with the matching
   * tab, because they are in the wild on bookmarks and in `AccommodationPage`.
   */
  support: '/app/support',
  /** @deprecated Redirects to `support?tab=contacts`. Kept for existing links. */
  helpDirectory: '/app/help',
  /** @deprecated Redirects to `support?tab=report`. Kept for existing links. */
  reportIssue: '/app/report-issue',
  /** @deprecated Redirects to `support?tab=ask`. Kept for existing links. */
  queries: '/app/queries',

  // Staff area
  /**
   * The staff Landing Page — the PARADOX portal again, with the perimeter nav
   * filtered by role (a Super Admin sees the admin sections, everyone else sees
   * their duty list plus the public programme). Outside `StaffShell`, as `home` is
   * outside `AppShell`.
   */
  staffHome: '/staff',
  /** The personal duty list that used to live at `/staff`. */
  staffDuties: '/staff/duties',
  staffChangePassword: '/staff/change-password',
  scanMess: '/staff/scan/mess/:messId',
  /**
   * The mess team's menu desk for one hall — dishes per fest day, service
   * windows, and the hall's notice. A duty route rather than an admin one: any
   * member of that hall's `mess_team` may open it, which is the same check the
   * scanner makes.
   */
  messMenu: '/staff/mess/:messId/menu',
  /**
   * Support — the duty desk for everything a participant has asked somebody to
   * deal with. One route with two tabs, selected by `?tab=`:
   *
   *   - `questions` Stories 6.3/6.4 — answer a query, and claim it by name.
   *   - `faults`    Story 5.4 — move a reported hostel or mess fault along.
   *
   * A duty route rather than an admin one, on the same terms as `messMenu`. Both
   * endpoints behind it scope themselves to the caller: `GET /queries` admits
   * anybody named on a block's, hall's, event's or workshop's team, `GET /issues`
   * anybody named on a block's or hall's team, and a Super Admin sees the whole
   * fest through either. That is also how 6.4's "help participants as POR / POC"
   * is delivered without adding a POR/POC role — the people already named on
   * those teams are the points of contact.
   *
   * These were two adjacent sections until they were not. They are one shift —
   * one queue of questions, one of faults — and the staff rail said so in a
   * comment while still charging a volunteer two visits to find out whether
   * anything was waiting on them. Sharing a screen is what lets one row of
   * figures answer that, which neither console could alone.
   *
   * The two old paths below still resolve; they redirect here with the matching
   * tab, because they are linked from the overview board's alert rail, from
   * `SupportPanel`, and from the duty list.
   */
  staffSupport: '/staff/support',
  /** @deprecated Redirects to `staffSupport?tab=faults`. Kept for existing links. */
  facilityIssues: '/staff/issues',
  /** @deprecated Redirects to `staffSupport?tab=questions`. Kept for existing links. */
  queryConsole: '/staff/queries',
  scanHostel: '/staff/scan/hostel/:hostelId',
  scanEvent: '/staff/scan/event/:eventId',
  /** The pre-registered turnstile: only students who booked a seat pass here. */
  scanWorkshop: '/staff/scan/workshop/:workshopId',
  /**
   * The on-spot desk — a second, separate scanner for walk-ins, capped
   * server-side at 10% of capacity. A distinct route rather than a mode hidden
   * behind a toggle, because admitting a walk-in and checking off a booking are
   * two different jobs, often at two different desks, and a volunteer should be
   * able to open (and be sent) the one they are staffing.
   */
  scanWorkshopOnSpot: '/staff/scan/workshop/:workshopId/on-spot',
  /**
   * The workshop desk: attendance figures, the attendee and absentee lists, the
   * exports, and the workshop's own team. Open to that workshop's volunteers and
   * managers as well as to Super Admins — the same shape as `messMenu`, a duty
   * route rather than an admin one.
   */
  workshopManage: '/staff/workshops/:workshopId/manage',
  eventParticipation: '/staff/events/:eventId/participation',
  eventTeams: '/staff/events/:eventId/teams',

  // Staff admin (super_admin only)
  /**
   * The Fest Control Board — every section's figures on one read-only screen.
   * First in the rail because it is fest-wide, where `staffHome` is the
   * personal, role-shaped duty list.
   */
  adminOverview: '/staff/admin/overview',
  adminEvents: '/staff/admin/events',
  adminEventNew: '/staff/admin/events/new',
  adminEventEdit: '/staff/admin/events/:eventId/edit',
  /** Admin's read view of an event, in the same design as the public page. */
  adminEventDetail: '/staff/admin/events/:eventId',
  adminWorkshops: '/staff/admin/workshops',
  adminWorkshopNew: '/staff/admin/workshops/new',
  adminWorkshopEdit: '/staff/admin/workshops/:workshopId/edit',
  adminMess: '/staff/admin/mess',
  adminHostels: '/staff/admin/hostels',
  adminBackendTeams: '/staff/admin/backend-teams',
  /**
   * Participant records — Story 7.3. The fest-wide roster `GET /participants`
   * returns, and the only screen anywhere that can correct somebody else's
   * profile. Admin-only, because both routes behind it are Super Admin only.
   */
  adminParticipants: '/staff/admin/participants',
  /**
   * The announcement desk — Stories 8.1/8.2. Admin-only because
   * `PUT /events/{event_id}`, which is where a notice is stored, refuses anybody
   * but a Super Admin. Other staff receive announcements on their duty board.
   */
  adminAnnouncements: '/staff/admin/announcements',
  adminAuditLogs: '/staff/admin/audit-logs',
  /**
   * Every log record for one entity. `domain` is events | workshops | mess |
   * hostels, `entityId` its readable id (an event_id, workshop_id, mess_id, or
   * hostel_id) — the same value the audit trail stores as `target_id`, so a trail
   * row can link straight here.
   */
  adminEntityLogs: '/staff/admin/audit-logs/:domain/:entityId',
} as const;

/** Build a path with params substituted, e.g. path(ROUTES.eventDetail, {eventId: 'e1'}). */
export function path(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
    template,
  );
}

/** Which tab of Help & Support a link means. */
export type SupportTab = 'ask' | 'report' | 'contacts';

/**
 * A link straight to one tab of Help & Support, e.g.
 * `supportPath('report')` → `/app/support?tab=report`.
 *
 * Exists so callers elsewhere in the app do not hand-assemble the query string:
 * the tab names are the contract between `ROUTES.support`, the redirects from the
 * three old paths, and `useTabParam`'s fallback, and one typo in a template
 * literal would silently land somebody on the default tab instead.
 */
export function supportPath(tab: SupportTab): string {
  return `${ROUTES.support}?tab=${tab}`;
}

/** Which tab of the staff Support desk a link means. */
export type StaffSupportTab = 'questions' | 'faults';

/**
 * A link straight to one tab of the staff Support desk, e.g.
 * `staffSupportPath('faults')` → `/staff/support?tab=faults`.
 *
 * The staff counterpart of `supportPath`, and it exists for the same reason: the
 * tab names are the contract between `ROUTES.staffSupport`, the redirects from
 * `/staff/issues` and `/staff/queries`, and `useTabParam`'s fallback. A typo in a
 * template literal would land somebody on the default tab instead of failing.
 */
export function staffSupportPath(tab: StaffSupportTab): string {
  return `${ROUTES.staffSupport}?tab=${tab}`;
}
