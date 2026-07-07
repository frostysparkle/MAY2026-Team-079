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

  // Staff
  scanner: '/scan',
  scanResult: '/scan/result',

  // Admin
  users: '/admin/users',

  accessDenied: '/access-denied',
} as const;
