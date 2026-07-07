/**
 * App-wide constants confirmed by the PRD / architecture docs.
 * Keep these authoritative values in one place so screens and validation agree.
 */

/** The only email domains allowed to register (PRD §1.3). */
export const IITM_EMAIL_DOMAINS = [
  '@ds.study.iitm.ac.in',
  '@es.study.iitm.ac.in',
  '@ee.study.iitm.ac.in',
  '@mg.study.iitm.ac.in',
] as const;

/** Four-tier role hierarchy (PRD FR-7.3). Order matters: higher index = more power. */
export const ROLES = ['participant', 'organizer', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

/** Human-readable labels for roles. */
export const ROLE_LABELS: Record<Role, string> = {
  participant: 'Participant',
  organizer: 'Organizer',
  admin: 'Admin',
  super_admin: 'Super Admin',
};

/** Rank of a role in the hierarchy (used for "at least this role" checks). */
export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/**
 * TOTP parameters — MUST match the backend (`pyotp`) and the architecture doc
 * exactly, or on-device codes will never verify. Do not change independently.
 */
export const TOTP = {
  algorithm: 'SHA1',
  digits: 6,
  period: 30, // seconds
  window: 1, // ±1 step tolerance
} as const;

/** Profile photo upload constraints (plan §4). */
export const PHOTO = {
  maxBytes: 750 * 1024, // 750 KB
  acceptedTypes: ['image/jpeg', 'image/png'] as const,
  acceptAttr: 'image/jpeg,image/png',
};

/** Checkpoint contexts a QR can be scanned against (organizer supplies this). */
export const CHECKPOINT_TYPES = ['event', 'mess', 'hostel', 'workshop'] as const;
export type CheckpointType = (typeof CHECKPOINT_TYPES)[number];
