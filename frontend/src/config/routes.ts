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

  // Participant area (inside the nav shell)
  home: '/app',
  profile: '/app/profile',
  changePassword: '/app/profile/change-password',
  myQr: '/app/qr',
  events: '/app/events',
  eventDetail: '/app/events/:eventId',
  myRegistrations: '/app/events/mine',
  schedule: '/app/schedule',
  workshops: '/app/workshops',
  workshopDetail: '/app/workshops/:workshopId',
  mess: '/app/mess',
  hostel: '/app/hostel',

  // Staff area
  staffHome: '/staff',
  staffChangePassword: '/staff/change-password',
  scanMess: '/staff/scan/mess/:messId',
  scanHostel: '/staff/scan/hostel/:hostelId',
  scanEvent: '/staff/scan/event/:eventId',
  scanWorkshop: '/staff/scan/workshop/:workshopId',
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
