/**
 * API contract types — mirrors the real backend's wire format exactly
 * (snake_case field names, matching backend/models.py and every router's
 * request/response shapes). No camelCase translation boundary: with ~40
 * endpoints, a translation layer is pure surface area for silent mismatches.
 */

/* ------------------------------------------------------------------ auth --- */

export type TokenType = 'participant' | 'staff';

export interface RegisterRequest {
  email: string;
  password: string;
}
export interface RegisterResponse {
  message: string;
  participant_id: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ParticipantLoginResponse {
  id: string;
  email: string;
  access_token: string;
  token_type: 'participant';
  full_name: string | null;
  dob: string | null;
  house: string | null;
  gender: string | null;
  phone: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  program: string | null;
  course_stage: string | null;
  photo: string | null;
  public_key: string | null;
  /**
   * Not returned by `/auth/login` — the participant login payload omits both.
   * They appear on the stored session only after a profile save merges the
   * `PATCH /profile/complete` response in, so treat them as "may be absent".
   */
  mess_preference?: string;
  emergency_contact?: EmergencyContact | null;
}

export interface StaffLoginResponse {
  id: string;
  email: string;
  access_token: string;
  token_type: 'staff';
  role: string;
  department: string;
  designation: string;
}

export interface ForgotPasswordRequest {
  email: string;
}
export interface ForgotPasswordResponse {
  message: string;
  dev_reset_url?: string;
}
export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}
export interface ChangePasswordResponse {
  message: string;
  access_token: string;
}

/* --------------------------------------------------------------- profile --- */

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface ProfileCompleteRequest {
  full_name: string;
  dob: string;
  house: string;
  gender: string;
  phone: string;
  mess_preference?: string; // 'veg' | 'non_veg' | 'jain' — see config/constants.ts
  country: string;
  state: string;
  city: string;
  address: string;
  emergency_contact?: EmergencyContact;
  program: string;
  course_stage: string;
  photo?: string;
}

export interface ProfileCompleteResponse {
  full_name: string;
  dob: string;
  house: string;
  gender: string;
  phone: string;
  mess_preference?: string;
  country: string;
  state: string;
  city: string;
  address: string;
  emergency_contact?: EmergencyContact;
  program: string;
  course_stage: string;
  photo: string | null;
}

/* -------------------------------------------------------------- QR / scan --- */

export interface ScanQRRequest {
  participant_id: string;
  data: string;
  timestamp: string;
}

/* ------------------------------------------------------------------- mess --- */

export interface MessTeamMember {
  user_id: string | null;
  role: 'volunteer' | 'other';
  name?: string | null;
  phone?: string | null;
  logging: boolean;
}

export interface Mess {
  mess_id: string;
  name: string;
  capacity: number;
  /** Dietary designation: veg | non_veg | jain. Allocation groups on this. */
  preference: string;
  /**
   * Regional menus the hall serves, e.g. `['north_indian']` or both. Optional
   * because halls created before the field existed have none stored, so the UI
   * must treat "missing" as "not recorded" rather than as an empty menu.
   */
  cuisines?: string[];
  mess_team?: MessTeamMember[];
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export interface MessSlotEntry {
  logged: boolean;
}

export interface MessDayEntry {
  breakfast: MessSlotEntry;
  lunch: MessSlotEntry;
  dinner: MessSlotEntry;
}

export interface MyMessResponse {
  allotted_mess: string | null;
  mess_details: Mess | null;
  slots: MessDayEntry[];
}

export interface MessScanResponse {
  message: string;
}

export interface MessStatisticsResponse {
  total_allocated: number;
  capacity: number;
  allotted_participants: {
    participant_id: string;
    name: string | null;
    email: string;
    phone: string | null;
  }[];
}

export interface MessCreateRequest {
  mess_id: string;
  name: string;
  capacity: number;
  preference: string;
  /** Omitted or empty records a hall with no regional menu declared. */
  cuisines?: string[];
}

export interface MessAssignTeamRequest {
  user_id?: string;
  role: 'volunteer' | 'other';
  name?: string;
  phone?: string;
}

/* ---------------------------------------------------------------- hostels --- */

export interface HostelTeamMember {
  user_id: string | null;
  role: 'volunteer' | 'other';
  name?: string | null;
  phone?: string | null;
  logging: boolean;
}

export interface Hostel {
  hostel_id: string;
  name: string;
  capacity: number;
  gender: string;
  /**
   * Catalogue wording for the block — "men" or "women". Seeded blocks carry it;
   * blocks created from the dashboard form only set `gender`, so it is optional.
   */
  category?: string;
  coordinator?: Record<string, unknown>;
  hostel_team?: HostelTeamMember[];
}

export interface MyHostelResponse {
  assigned_hostel: string | null;
  room: string | null;
  logged_in: boolean;
  /**
   * Whether this participant has asked for accommodation. Distinct from
   * `assigned_hostel`: "never requested" and "requested, awaiting allocation"
   * both have no hostel yet but need different things said to them.
   */
  registered: boolean;
  volunteers: { name: string; phone: string }[];
}

export interface HostelScanResponse {
  message: string;
}

export interface HostelStatisticsResponse {
  total_allocated: number;
  capacity: number;
  currently_inside: number;
  allotted_participants: {
    participant_id: string;
    name: string | null;
    email: string;
    room: string | null;
  }[];
}

export interface HostelCreateRequest {
  hostel_id: string;
  name: string;
  capacity: number;
  gender: string;
  coordinator: Record<string, unknown>;
}

export interface HostelAssignTeamRequest {
  user_id?: string;
  role: 'volunteer' | 'other';
  name?: string;
  phone?: string;
}

/* ----------------------------------------------------------------- events --- */

export interface TeamRule {
  min: number;
  max: number;
  house: boolean;
  allow_single_registration: boolean;
}

export interface PrizeMoney {
  position: string;
  amount: number;
}

export interface ScheduleRound {
  round_id?: string;
  name: string;
  description?: string;
  start_time: string;
  end_time: string;
  /** Where the round happens, e.g. "KV Ground" or "Online". */
  venue?: string;
}

export interface RegistrationField {
  field_id: string;
  label: string;
  type: string;
  required: boolean;
}

export interface EventTeamMember {
  user_id: string;
  role: 'event_head' | 'event_member' | 'volunteer' | string;
  name?: string;
  phone?: string;
}

export interface Event {
  event_id: string;
  event_type: string;
  name: string;
  description: string;
  poster?: string;
  team: TeamRule;
  open: boolean;
  prize_money: PrizeMoney[];
  registration: { start_time?: string; end_time?: string };
  schedule: ScheduleRound[];
  registration_fields: RegistrationField[];
  event_team: EventTeamMember[];
}

/**
 * An event as the public (pre-login) brochure sees it: the published fields
 * only. `GET /events/public` omits `event_team`, `registration_fields`, and all
 * internal bookkeeping, so this is deliberately narrower than `Event`.
 */
export type PublicEventRecord = Omit<Event, 'event_team' | 'registration_fields'>;

export interface EventRegistrationInput {
  team_name?: string;
  registration_data?: Record<string, unknown>;
}

export interface MyEventRegistration {
  event_id: string;
  team_id: string | null;
  team_role: 'leader' | 'member' | null;
  registration_data: Record<string, unknown>;
}

/**
 * One of this participant's own workshop bookings, from
 * `GET /workshops/my_registrations`.
 *
 * `workshop_id` and `name` are null when the workshop was deleted after it was
 * booked; `slot_id` survives either way, so a booking always reports the shift
 * it occupies.
 */
export interface MyWorkshopRegistration {
  workshop_id: string | null;
  slot_id: string;
  name: string | null;
  venue: string | null;
  booking_type: string | null;
  attended: boolean;
}

export interface EventParticipant {
  participant_id: string;
  name: string | null;
  email: string;
  phone: string | null;
  house: string | null;
  team_id: string | null;
  team_role: string | null;
}

export interface EventParticipationResponse {
  count: number;
  participants: EventParticipant[];
  event_team: { user_id: string; role: string; name: string; phone: string }[];
  /** Absent (not null/0) for UHC callers — check `'total_daily_scans' in response`. */
  total_daily_scans?: number;
}

export interface EventScanResponse {
  name: string | null;
  email: string;
  is_participating: boolean;
}

export interface EventDailyScansResponse {
  daily_unique_scans: number;
}

/**
 * A row of the `event_logs` collection — `GET /events/{id}/logs`.
 *
 * One attendance scan, deduped per participant/scanner/day. `day` is what the
 * scan endpoint dedupes on; `timestamp` is when it actually happened.
 */
export interface EventLogRow {
  event_id: string;
  participant_id: string;
  scanned_by: string;
  day: string;
  timestamp: string;
}

export interface EventLogsResponse {
  logs: EventLogRow[];
}

export interface EventCreateRequest {
  event_id: string;
  event_type: string;
  name: string;
  description: string;
  poster?: string;
  team: TeamRule;
  prize_money?: PrizeMoney[];
  registration: { start_time?: string; end_time?: string };
  schedule?: ScheduleRound[];
  registration_fields?: RegistrationField[];
}

export type EventUpdateRequest = Partial<Omit<EventCreateRequest, 'event_id'>> & {
  open?: boolean;
};

export interface EventTeamAssignRequest {
  user_id: string;
  role: 'event_head' | 'event_member' | 'volunteer';
}

export interface ParticipantTeamUpdateRequest {
  team_id?: string;
  team_role?: string;
}

/* ------------------------------------------------------------- workshops --- */

export interface WorkshopVolunteer {
  user_id: string;
  role: string;
  attendance: boolean;
}

export interface Workshop {
  workshop_id: string;
  slot_id: string;
  name: string;
  venue: string;
  capacity: number;
  instructions: string;
  registration_count: number;
  participant_count: number;
  workshop_team?: WorkshopVolunteer[];
}

/**
 * A workshop as the published programme returns it — `GET /workshops/public`.
 * Never carries `workshop_team` (staff identities) or internal bookkeeping.
 */
export type PublicWorkshopRecord = Omit<
  Workshop,
  'workshop_team' | 'participant_count' | 'registration_count'
> & {
  /** Present on the public feed, but treat it as optional at the type level. */
  registration_count?: number;
};

export interface WorkshopCreateRequest {
  workshop_id: string;
  slot_id: string;
  name: string;
  venue: string;
  capacity: number;
  instructions: string;
}

export type WorkshopUpdateRequest = Partial<Omit<WorkshopCreateRequest, 'workshop_id'>>;

export interface WorkshopAssignVolunteerRequest {
  user_id: string;
  role?: string;
  attendance?: boolean;
}

export interface WorkshopSeatsEvent {
  remaining_seats: number;
  capacity: number;
}

/**
 * A row of the `workshop_logs` collection — `GET /workshops/{id}/logs`.
 *
 * `action` separates a booking from a turnstile scan; `scan_type` and `scanned_by`
 * are attendance-only, so both are optional. Typed rather than left as an opaque
 * record so the log views can classify an entry instead of guessing at its keys.
 */
export interface WorkshopLogRow {
  workshop_id: string;
  action: string;
  scan_type?: string;
  participant_id: string;
  scanned_by?: string;
  timestamp: string;
}

export interface WorkshopLogsResponse {
  logs: WorkshopLogRow[];
}

/* ------------------------------------------------------------ backend_teams --- */

export interface BackendTeamMember {
  paradox_id: string;
  email: string;
  role: string;
  department: string;
  designation: string;
  admin_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BackendTeamCreateRequest {
  email: string;
  password: string;
  role: string;
  department: string;
  designation: string;
}

export type BackendTeamUpdateRequest = Partial<
  Pick<BackendTeamCreateRequest, 'role' | 'department' | 'designation'>
>;

export interface BackendTeamCreateResponse {
  message: string;
  paradox_id: string;
}

/* ----------------------------------------------------------------- audit --- */

export interface AuditLogEntry {
  actor_id: string;
  action: string;
  target_id?: string | null;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Server-side narrowing for `GET /audit-logs`.
 *
 * Applied before `limit`, which is the whole point: filtering client-side would
 * mean an entity's older entries were already cut off by the limit before they
 * could be matched.
 */
export interface AuditLogFilter {
  /** An `event_id`, `workshop_id`, `mess_id`, or `hostel_id`. */
  target_id?: string;
  /** A single action name, e.g. `HOSTEL_ENTRY`. */
  action?: string;
}

/* --------------------------------------------------------- participants --- */

/**
 * Fest-wide participant counts — `GET /participants/statistics`, Super Admins only.
 *
 * Counts only, by design: the endpoint returns no name, email, phone, or
 * participant id, so a dashboard can show fest-wide totals without holding a
 * roster. `total_registered` is every account `POST /auth/register` has created,
 * which is what makes it a real registration total rather than a count of people
 * who happen to have turned up somewhere.
 *
 * The `by_*` splits only count participants who completed a profile, since
 * `house`, `program`, `course_stage` and `gender` are all written by
 * `PATCH /profile/complete`. Their totals therefore equal `profile_complete`,
 * not `total_registered` — a real distinction, not a rounding error.
 */
export interface ParticipantStatisticsResponse {
  total_registered: number;
  profile_complete: number;
  profile_incomplete: number;
  mess_registered: number;
  mess_allotted: number;
  hostel_registered: number;
  hostel_allotted: number;
  /** Requested but not yet allotted. Exact, unlike the audit-derived estimate. */
  hostel_pending: number;
  currently_on_campus: number;
  with_event_registrations: number;
  with_workshop_registrations: number;
  by_house: Record<string, number>;
  by_program: Record<string, number>;
  by_course_stage: Record<string, number>;
  by_gender: Record<string, number>;
  /** Signups keyed `YYYY-MM-DD`, already in chronological key order. */
  signups_by_day: Record<string, number>;
}

/* -------------------------------------------------------------- generic --- */

export interface MessageResponse {
  message: string;
}

/* -------------------------------------------------------------- errors --- */

/** FastAPI's actual error body shape — every non-2xx response looks like this. */
export interface FastApiErrorBody {
  detail: string;
}
