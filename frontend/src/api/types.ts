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
  /**
   * The hall's own menu, written by its team through `PUT /mess/{id}/menu`.
   *
   * Absent on a hall nobody has edited — which is most of them — so the UI falls
   * back to the published campus sheet for its dietary category rather than
   * showing an empty menu. See `features/mess/messMenu.ts`.
   */
  menu?: MessMenu | null;
}

/** One sitting on one day: when it is served and what is on it. */
export interface MessMenuSlot {
  slot: MealSlot;
  /** 24-hour `HH:MM`. The window travels with the sitting, so a hall can move one meal. */
  start_time: string;
  end_time: string;
  dishes: string[];
}

export interface MessMenuDay {
  /** 1-based fest day, the same number `POST /mess/{id}/scan` takes. */
  day: number;
  slots: MessMenuSlot[];
}

/** As stored on the hall document and returned by `GET /mess` / `GET /mess/my_mess`. */
export interface MessMenu {
  days: MessMenuDay[];
  note?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
}

/** The body `PUT /mess/{id}/menu` takes — the whole menu, not a patch. */
export interface MessMenuRequest {
  days: MessMenuDay[];
  note?: string | null;
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
  /**
   * Required by the schema, but ignored: `POST /mess` generates the real id
   * (`MESS111`…) and overwrites this. The create form does not collect it — see
   * `lib/serverGeneratedId.ts`.
   */
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
  /** The participant's uploaded profile photo, when they have one. */
  photo: string | null;
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
 * How full one event is — `GET /events/{id}/capacity`.
 *
 * The only fullness figure a *participant* may read, and readable precisely
 * because it carries no identities: two integers and the event's own id. Every
 * other count is staff-gated because every other one returns the roster.
 *
 * The published capacity is not part of this response. It rides in the event's
 * `registration` map, which the caller already holds from `GET /events` or
 * `GET /events/public`; parsing it in a second place is how two places come to
 * disagree.
 */
export interface EventCapacityCountsResponse {
  event_id: string;
  /** Current registrations. Falls when somebody cancels. */
  registered: number;
  /** Distinct participants scanned in today — heads, not scan rows. */
  attended_today: number;
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
  /**
   * Required by the schema, but ignored: `POST /events` generates the real id
   * (`EVTEC1111`…) and overwrites this. The create form does not collect it —
   * see `lib/serverGeneratedId.ts`.
   */
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

/**
 * The body `POST /events/recommendations` and `POST /workshops/recommendations`
 * take — free text, or omitted/empty to fall back to the participant's saved
 * preference embedding for that domain.
 */
export interface RecommendationRequest {
  query?: string | null;
}

/**
 * An event as the recommendations endpoint returns it: every event that
 * exists, each carrying its cosine similarity (-1..1) to the query or saved
 * preference embedding. Nothing is filtered out — only reordered, most
 * similar first.
 */
export type RecommendedEvent = Event & { similarity: number };

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
  /**
   * Required by the schema, but ignored: `POST /workshops` generates the real id
   * (`WKSP111`…) and overwrites this. The create form does not collect it — see
   * `lib/serverGeneratedId.ts`.
   */
  workshop_id: string;
  slot_id: string;
  name: string;
  venue: string;
  capacity: number;
  instructions: string;
}

export type WorkshopUpdateRequest = Partial<Omit<WorkshopCreateRequest, 'workshop_id'>>;

/**
 * A workshop as the recommendations endpoint returns it: every workshop that
 * exists, each carrying its cosine similarity (-1..1) to the query or saved
 * preference embedding. Nothing is filtered out — only reordered, most
 * similar first.
 */
export type RecommendedWorkshop = Workshop & { similarity: number };

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
 * One row of `GET /workshops/{id}/participation` — a person who holds a seat at
 * this workshop, with the academic standing that makes an interest-by-level
 * breakdown a count rather than an inference.
 *
 * Every profile field is nullable: a participant registers before completing a
 * profile, so a roster can legitimately contain somebody with an id and nothing
 * else. `academic_level` is the four-value ladder (Foundation / Diploma / BSc
 * Degree / BS Degree); `course_stage` is the three-value field the app reports on.
 */
export interface WorkshopParticipationRow {
  participant_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  house: string | null;
  gender: string | null;
  program: string | null;
  course_stage: string | null;
  academic_level: string | null;
  academic_level_number: number | null;
  degree: string | null;
  entry_year: number | null;
  booking_type: string | null;
  attended: boolean;
  slot_id: string | null;
}

/** A workshop team member as the participation route reports them, with a name. */
export interface WorkshopTeamMemberDetail {
  user_id: string;
  role: string;
  attendance: boolean;
  name: string | null;
  phone: string | null;
}

/**
 * The workshop desk's roster — `GET /workshops/{id}/participation`.
 *
 * Readable by a Super Admin *or* a member of that workshop's own team, which is
 * what separates it from `GET /workshops/{id}/logs`. `count` is what this response
 * lists; `registration_count` and `participant_count` are the workshop's own
 * counters, returned alongside so a client never has to pick which to trust.
 */
export interface WorkshopParticipationResponse {
  workshop_id: string;
  name: string;
  venue: string;
  slot_id: string;
  capacity: number;
  registration_count: number;
  participant_count: number;
  count: number;
  attended_count: number;
  absent_count: number;
  on_spot_count: number;
  workshop_team: WorkshopTeamMemberDetail[];
  participants: WorkshopParticipationRow[];
}

/**
 * An authorised correction to one participant's workshop record —
 * `PATCH /workshops/{id}/participants/{participantId}`.
 *
 * Send only what changes; an empty body is a 400. Identity fields are not
 * editable through this route by design.
 */
export interface WorkshopParticipantUpdateRequest {
  attended?: boolean;
  booking_type?: 'pre-registered' | 'on-spot';
}

export interface WorkshopParticipantUpdateResponse {
  message: string;
  participant_id: string;
  /** Absent when the record already said what was asked for. */
  changes?: Partial<Pick<WorkshopParticipationRow, 'attended' | 'booking_type'>>;
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
  /**
   * The actor's name. Recorded with the entry from the point names began being
   * captured, and resolved by the endpoint for entries written before that, so it
   * is optional only because an id can belong to a deleted account with no name
   * left to find.
   */
  actor_name?: string | null;
  /** Which id namespace `actor_id` belongs to. Absent on pre-existing entries. */
  actor_type?: 'staff' | 'participant' | null;
  /** The actor's role at the time, e.g. `super_admin`. */
  actor_role?: string | null;
  /**
   * Every person id this entry mentions, mapped to that person's name — the actor
   * and any id inside `details`, such as the member named by a team assignment.
   * Lets the client show a name for an id without knowing which collection the id
   * came from. Ids with no resolvable name are simply absent.
   */
  names?: Record<string, string>;
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
  /**
   * Half-open ISO 8601 bounds on `timestamp` — `since` inclusive, `until`
   * exclusive, so consecutive days tile without counting the midnight row twice.
   *
   * These are what make a daily figure a total rather than a floor. Asking for
   * "today" by fetching the newest N rows and filtering them in the browser stops
   * being true the moment a fest produces more than N rows in a day.
   */
  since?: string;
  until?: string;
}

/**
 * Meals served in a window, de-duplicated per diner — the `meals` block of
 * `GET /audit-logs/summary`.
 *
 * `MESS_SCAN` writes one row per card read, so row counts answer "how many times
 * was a card scanned", not "how many people were fed". These figures collapse to
 * one entry per `(diner, day, slot)`, and report what that collapsing removed
 * instead of hiding it.
 */
export interface AuditMealSummary {
  /** Raw `MESS_SCAN` rows in the window. */
  scans: number;
  /** Distinct `(diner, day, slot)` swipes — the headline meal count. */
  meals_served: number;
  /** `scans - meals_served`: re-scans that fed nobody extra. */
  duplicate_scans: number;
  unique_diners: number;
  /**
   * Swipes with a missing or unrecognised `day`/`slot`. Counted in
   * `meals_served` — they are real meals — but there is no grid cell to draw
   * them in, so they are reported rather than dropped.
   */
  unclassified: number;
  by_slot: Record<'breakfast' | 'lunch' | 'dinner', number>;
  /** Keyed by fest day number as a string, ascending. */
  by_day: Record<string, number>;
}

/**
 * Exact counts over the trail — `GET /audit-logs/summary`, Super Admins only.
 *
 * The companion to `GET /audit-logs`, which takes a `limit` and therefore cannot
 * answer "how many". Every field here is counted server-side across the whole
 * matching set, so nothing is a page artefact.
 */
export interface AuditLogSummary {
  total: number;
  by_action: Record<string, number>;
  distinct_actors: number;
  /** The distinct set, not a sample — safe to intersect with a staff roster. */
  actor_ids: string[];
  /** `null` when the requested `action` cannot contain meal scans. */
  meals: AuditMealSummary | null;
  window: { since: string | null; until: string | null };
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

/**
 * One person on the fest-wide roster — `GET /participants`, Super Admins only.
 *
 * Deliberately a different endpoint from `/participants/statistics` above rather
 * than a flag on it: a dashboard showing totals to everyone who can see the
 * dashboard must not be the thing that hands out a list of names.
 *
 * `event_count` / `workshop_count` replace the arrays themselves — an admin
 * roster wants "3 events", and the per-event roster endpoints already answer
 * "which three". `photo`, `embedding`, `password_hash` and `qr_secrets` are not
 * in the response at all.
 */
export interface ParticipantRecord {
  participant_id: string;
  email: string;
  /** `{}` between registration and `PATCH /profile/complete`. */
  profile: Partial<ProfileCompleteResponse>;
  mess?: { registered?: boolean; mess_id?: string | null };
  accommodation?: {
    registered?: boolean;
    hostel_id?: string | null;
    room?: string | null;
    logged_in?: boolean;
  };
  event_count: number;
  workshop_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface ParticipantListResponse {
  count: number;
  participants: ParticipantRecord[];
}

/** Server-side narrowing for the roster. `q` matches an id, email, or name. */
export interface ParticipantFilter {
  q?: string;
  house?: string;
}

/**
 * An admin's edit of somebody else's record — `PATCH /participants/{id}`.
 *
 * Profile fields only. Identity (`email`, `participant_id`), credentials, and
 * allocation state are absent on purpose: the routes that own them enforce rules
 * — capacity, scan state, the email-to-id derivation — that a direct write would
 * skip. Every field optional, and only what is sent is written.
 */
export interface ParticipantAdminUpdateRequest {
  full_name?: string;
  house?: string;
  gender?: string;
  phone?: string;
  mess_preference?: string;
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  program?: string;
  course_stage?: string;
  emergency_contact?: EmergencyContact;
}

export interface ParticipantUpdateResponse {
  message: string;
  profile: Partial<ProfileCompleteResponse>;
}

/* --------------------------------------------------------------- queries --- */

/**
 * Participant queries — Epic 6, `/queries`.
 *
 * A sibling of `/issues` below, not a duplicate of it. An issue is a *fault* in a
 * facility somebody is placed in, with a fix and a room number; a query is a
 * *question* about anything in the fest, including events, workshops, and things
 * that belong to no entity at all. They ship as two domains because their guards
 * differ: filing an issue requires being allotted to the facility, while asking
 * about an event only requires being at the fest.
 */

/**
 * Who a query is for, which is also what routes it.
 *
 * `general` reaches the Super Admins and names no entity; every other value must
 * name one, and only that entity's own team can read it.
 */
export type QueryCategory = 'hostel' | 'mess' | 'event' | 'workshop' | 'general';

/** `assigned` is set implicitly the moment somebody is named on a query. */
export type QueryStatus = 'open' | 'assigned' | 'resolved';

/** One message in the thread. Both sides write these. */
export interface QueryReply {
  author_id: string;
  author_type: 'participant' | 'staff';
  /** A display name — a participant's `full_name`, or a staff `designation`. */
  author_name: string;
  body: string;
  timestamp: string;
}

/**
 * One query, in the single shape both sides read.
 *
 * There is no separate staff view because there is nothing extra to add: the row
 * carries the author's id, name, and house and deliberately **no email or
 * phone**. A block's `hostel_team` cannot read `/hostels/{id}/statistics`, so a
 * query row must not become the back door to contact details — the reply thread
 * is the channel back.
 */
export interface QueryRecord {
  query_id: string;
  participant_id: string;
  participant_name: string | null;
  participant_house: string | null;
  category: QueryCategory;
  /** A readable `hostel_id` / `mess_id` / `event_id` / `workshop_id`. `null` for `general`. */
  target_id: string | null;
  subject: string;
  body: string;
  status: QueryStatus;
  /** A label for the humans reading the thread. Routing does not depend on it. */
  assigned_team: string | null;
  /** The `paradox_id` of the staff member who owns it. */
  assigned_to: string | null;
  replies: QueryReply[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface QueryCreateRequest {
  category: QueryCategory;
  subject: string;
  body: string;
  /** Required for every category but `general`, where the backend drops it. */
  target_id?: string | null;
}

export interface QueryCreateResponse {
  message: string;
  query_id: string;
  query: QueryRecord;
}

export interface QueryUpdateRequest {
  status?: QueryStatus;
  assigned_team?: string;
  assigned_to?: string;
}

export interface QueryUpdateResponse {
  message: string;
  query: QueryRecord;
}

export interface QueryReplyRequest {
  body: string;
}

export interface QueryReplyResponse {
  message: string;
  reply: QueryReply;
}

/** Server-side narrowing for the staff queue. Applied before `limit`. */
export interface QueryFilter {
  status?: QueryStatus;
  category?: QueryCategory;
}

/* ---------------------------------------------------------------- issues --- */

/**
 * Participant-reported hostel and mess faults — Story 5.4, `/issues`.
 *
 * The only participant-written free text in this API that another user can read
 * back. Everything else a participant writes is either returned only to its own
 * author (`registration_data`) or is load-bearing data a report would corrupt
 * (`team_id`, `profile.*`), which is why this domain had to exist before the
 * story could ship.
 */

/** Which of the two things a participant is placed in a report is about. */
export type IssueFacilityType = 'hostel' | 'mess';

/**
 * Where a report has got to.
 *
 * Three, not a workflow: a fest runs six days, and a longer ladder is status
 * nobody updates.
 */
export type IssueStatus = 'open' | 'in_progress' | 'resolved';

/**
 * One entry in a report's history.
 *
 * `by` is present only on the staff read — which volunteer typed a note is
 * bookkeeping the audit trail keeps, not something the reporter is shown.
 */
export interface IssueUpdate {
  at: string;
  status: IssueStatus;
  note: string | null;
  by?: string;
}

/** A report as its author reads it back from `GET /issues/mine`. */
export interface Issue {
  issue_id: string;
  facility_type: IssueFacilityType;
  /** A readable `hostel_id` or `mess_id`. */
  facility_id: string;
  category: string;
  subject: string;
  body: string;
  room: string | null;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
  /** Newest last. What makes the story trackable rather than write-only. */
  updates: IssueUpdate[];
}

/**
 * A report as the answering team reads it from `GET /issues`.
 *
 * Carries the reporter, because a team that cannot call the person back cannot
 * resolve anything. Name and phone are the same `profile` fields
 * `/hostels/{id}/statistics` and `/mess/{id}/statistics` already hand to staff.
 */
export interface StaffIssue extends Issue {
  reporter: {
    participant_id: string;
    name: string | null;
    phone: string | null;
    room: string | null;
  };
}

export interface IssueCreateRequest {
  facility_type: IssueFacilityType;
  facility_id: string;
  category: string;
  subject: string;
  body: string;
  /** Omitted, the backend falls back to the room the participant is allotted. */
  room?: string | null;
}

export interface IssueUpdateRequest {
  status?: IssueStatus;
  /** Valid on its own, with no status change. */
  note?: string;
}

/** Server-side narrowing for the staff list. */
export interface IssueFilter {
  status?: IssueStatus;
  facility_type?: IssueFacilityType;
  facility_id?: string;
}

export interface IssueListResponse {
  count: number;
  issues: Issue[];
}

export interface StaffIssueListResponse {
  count: number;
  issues: StaffIssue[];
}

export interface IssueCreateResponse {
  message: string;
  issue_id: string;
  status: IssueStatus;
}

export interface IssueUpdateResponse {
  message: string;
  issue_id: string;
  status: IssueStatus;
}

/* -------------------------------------------------------------- generic --- */

export interface MessageResponse {
  message: string;
}

/* -------------------------------------------------------------- errors --- */

/**
 * One entry from FastAPI's request-validation error list.
 *
 * `loc` is the path to the offending value, e.g. `["body", "team", "min"]` — the
 * first element is the request part and the rest names the field, which is why
 * the formatter drops the head before showing it to a user.
 */
export interface FastApiValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/**
 * FastAPI's actual error body shape.
 *
 * `detail` is **not** always a string. A hand-raised `HTTPException` sets it to
 * one, which is every deliberate 400/401/403/404/409 in this backend — but a
 * 422 from request validation sets it to an array of `FastApiValidationError`.
 * Typing it as `string` (as this did) meant a 422 handed a non-string to
 * `new ApiClientError(...)` and the user was shown `[object Object]`.
 */
export interface FastApiErrorBody {
  detail?: string | FastApiValidationError[];
}
