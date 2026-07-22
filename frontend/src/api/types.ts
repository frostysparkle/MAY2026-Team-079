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

/* -------------------------------------------------------------- events --- */

export type EventStatus = 'draft' | 'published' | 'cancelled';

/** A fest event (Epic 1). Times are 24h "HH:MM"; date is ISO "YYYY-MM-DD". */
export interface EventItem {
  id: string;
  title: string;
  venue: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  instructions: string;
  status: EventStatus;
  createdAt: string;
}

export interface EventListResponse {
  events: EventItem[];
}

export interface CreateEventRequest {
  title: string;
  venue: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  instructions: string;
  status?: EventStatus;
}

/** All fields optional — send only what changes (PATCH semantics). */
export type UpdateEventRequest = Partial<CreateEventRequest>;

/* ------------------------------------------------- queries & contacts --- */

export type QueryCategory = 'event' | 'hostel' | 'mess' | 'workshop' | 'lost_item' | 'other';
export type QueryStatus = 'open' | 'assigned' | 'in_progress' | 'resolved';
export type QueryTeam = 'event' | 'hostel' | 'mess' | 'workshop' | 'general';

export interface SupportQuery {
  id: string;
  participantId: string;
  category: QueryCategory;
  description: string;
  status: QueryStatus;
  assignedTeam: QueryTeam | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueryListResponse {
  queries: SupportQuery[];
}

export interface RaiseQueryRequest {
  category: QueryCategory;
  description: string;
}

export interface UpdateQueryRequest {
  status?: QueryStatus;
  assignedTeam?: QueryTeam;
}

export type ContactCategory = 'hostel' | 'mess' | 'event' | 'security' | 'general';

export interface Contact {
  id: string;
  name: string;
  role: string;
  category: ContactCategory;
  phone: string;
  email: string | null;
  isEmergency: boolean;
}

export interface ContactListResponse {
  contacts: Contact[];
}

export interface CreateContactRequest {
  name: string;
  role: string;
  category: ContactCategory;
  phone: string;
  email?: string | null;
  isEmergency?: boolean;
}

export type UpdateContactRequest = Partial<CreateContactRequest>;

/* ---------------------------------------------------------------- mess --- */

export type Meal = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface MessMenuItem {
  id: string;
  location: string;
  meal: Meal;
  items: string;
  startTime: string;
  endTime: string;
}

export interface MessMenuListResponse {
  items: MessMenuItem[];
}

export interface CreateMessMenuRequest {
  location: string;
  meal: Meal;
  items: string;
  startTime: string;
  endTime: string;
}

export type UpdateMessMenuRequest = Partial<CreateMessMenuRequest>;

/** The caller's own digital mess pass (FR-4.2). */
export interface MessPass {
  participantId: string;
  eligible: boolean;
}

export interface MessEligibilityItem {
  id: string;
  fullName: string | null;
  email: string;
  eligible: boolean;
}

export interface MessEligibilityListResponse {
  participants: MessEligibilityItem[];
}

export interface MessStats {
  eligibleCount: number;
}

/* -------------------------------------------------------------- errors --- */

/** Normalized error shape thrown by the API client on non-success. */
export interface ApiError {
  status: number;
  code: string;
  message: string;
}
