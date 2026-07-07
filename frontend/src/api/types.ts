/**
 * API contract types — the single source of truth for the shape of every
 * request and response between the frontend and the backend.
 *
 * These are shared with the backend developer (Ashwin) so both sides agree on
 * the wire format before implementation. The mock API and the real API client
 * both satisfy these types.
 */
import type { Role, CheckpointType } from '@/config/constants';

/* ---------------------------------------------------------------- domain --- */

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type Program = 'standalone_degree' | 'dual_degree' | 'working_professional';

export type CourseStage = 'foundational' | 'diploma' | 'degree' | 'other';

/** Core participant profile (photo stored separately — see PhotoRef). */
export interface Participant {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  age: number | null;
  gender: Gender | null;
  phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  program: Program | null;
  courseStage: CourseStage | null;
  courseStageOther: string | null;
  photoUrl: string | null; // resolved from the separate `photos` collection
  profileComplete: boolean;
  createdAt: string; // ISO 8601
}

/* ------------------------------------------------------------------ auth --- */

export interface GoogleLoginRequest {
  /** The ID token returned by Google Sign-in, verified server-side. */
  idToken: string;
}

export interface AuthSession {
  token: string; // JWT session token
  participant: Participant;
}

export interface GoogleLoginResponse {
  session: AuthSession;
  /** True on first sign-in → route to Complete Your Profile. */
  isNewUser: boolean;
}

/* --------------------------------------------------------------- profile --- */

export interface CompleteProfileRequest {
  fullName: string;
  age: number;
  gender: Gender;
  phone: string;
  country: string;
  state: string;
  city: string;
  program: Program;
  courseStage: CourseStage;
  courseStageOther?: string;
  /** Base64 data URL of the photo; backend stores it in the `photos` collection. */
  photoDataUrl: string;
}

export interface CompleteProfileResponse {
  participant: Participant;
}

/* --------------------------------------------------- admin: user mgmt --- */

export interface UserListItem {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface ListUsersResponse {
  users: UserListItem[];
}

/** Super-Admin-only role assignment (PRD FR-7.3). */
export interface AssignRoleRequest {
  participantId: string;
  role: Role;
}

export interface AssignRoleResponse {
  participantId: string;
  role: Role;
}

/* --------------------------------------------------------- QR / TOTP --- */

/**
 * One-time secret provisioning for a specific checkpoint context.
 * The secret is returned exactly once and never re-exposed by any later call.
 */
export interface ProvisionSecretRequest {
  checkpointContext: CheckpointType;
}

export interface ProvisionSecretResponse {
  participantId: string;
  checkpointContext: CheckpointType;
  /** Base32-encoded TOTP secret. Stored encrypted client-side, never re-fetched. */
  secretBase32: string;
}

/** Result codes returned by scan verification (all 7 handled by the UI). */
export type ScanResultCode =
  | 'valid'
  | 'expired'
  | 'unknown_participant'
  | 'duplicate'
  | 'wrong_checkpoint'
  | 'not_eligible'
  | 'payment_pending';

export interface VerifyScanRequest {
  participantId: string;
  /** The 6-digit code decoded from the QR. */
  currentCode: string;
  /** Supplied by the organizer app, NOT embedded in the QR. */
  checkpointContext: CheckpointType;
}

export interface VerifyScanResponse {
  result: ScanResultCode;
  /** Present for valid scans / high-stakes checkpoints, for staff cross-check. */
  participant?: {
    id: string;
    fullName: string;
    photoUrl: string | null;
  };
  /** Optional human-readable detail (e.g. which hostel/room, why not eligible). */
  detail?: string;
}

/* -------------------------------------------------------------- errors --- */

/** Normalized error shape thrown by the API client on non-success. */
export interface ApiError {
  status: number;
  code: string;
  message: string;
}
