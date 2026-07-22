/**
 * Central route path definitions. Referencing ROUTES.* instead of raw strings
 * keeps navigation refactor-safe and avoids typo'd paths across the app.
 */
export const ROUTES = {
  splash: '/',
  login: '/login',
  completeProfile: '/complete-profile',

  // Participant area (inside the nav shell)
  home: '/app',
  profile: '/app/profile',
  myQr: '/app/qr',
  events: '/app/events',
  eventDetail: (id: string) => `/app/events/${id}`,
  help: '/app/help',
  mess: '/app/mess',
  hostel: '/app/hostel',
  announcements: '/app/announcements',

  // Staff
  scanner: '/scan',
  scanResult: '/scan/result',

  // Admin
  users: '/admin/users',
  newEvent: '/admin/events/new',
  editEvent: (id: string) => `/admin/events/${id}/edit`,
  manageQueries: '/admin/queries',
  manageContacts: '/admin/contacts',
  manageMess: '/admin/mess',
  manageHostel: '/admin/hostel',
  dashboard: '/admin/dashboard',
  manageAnnouncements: '/admin/announcements',

  accessDenied: '/access-denied',
} as const;
