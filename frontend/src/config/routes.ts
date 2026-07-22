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

  // Staff
  scanner: '/scan',
  scanResult: '/scan/result',

  // Admin
  users: '/admin/users',
  newEvent: '/admin/events/new',
  editEvent: (id: string) => `/admin/events/${id}/edit`,

  accessDenied: '/access-denied',
} as const;
