/**
 * The "portal" a user picks on the splash screen. This is a UI hint only — it
 * decides which login copy to show next and carries NO permission. The real
 * role is always resolved server-side after email + password sign-in.
 */
export type Portal = 'student' | 'organizer' | 'admin';

export const PORTAL_LABELS: Record<Portal, string> = {
  student: "I'm a Student",
  organizer: "I'm an Organizer",
  admin: "I'm an Admin",
};
