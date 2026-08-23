/**
 * The API surface the app depends on. Screens talk to this interface only —
 * never to `fetch` directly — so the mock and the real backend are swappable
 * with zero component changes. One method per real backend endpoint; see
 * Frontend_Integration_Guide.md §3 for the canonical table this mirrors.
 */
import type {
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  ParticipantLoginResponse,
  StaffLoginResponse,
  ForgotPasswordRequest,
  ForgotPasswordResponse,
  ResetPasswordRequest,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ProfileCompleteRequest,
  ProfileCompleteResponse,
  ScanQRRequest,
  MealSlot,
  Mess,
  MessMenuRequest,
  MyMessResponse,
  MessScanResponse,
  MessStatisticsResponse,
  MessCreateRequest,
  MessAssignTeamRequest,
  Hostel,
  MyHostelResponse,
  HostelScanResponse,
  HostelStatisticsResponse,
  HostelCreateRequest,
  HostelAssignTeamRequest,
  Event,
  PublicEventRecord,
  PublicWorkshopRecord,
  EventRegistrationInput,
  MyEventRegistration,
  MyWorkshopRegistration,
  EventParticipationResponse,
  EventScanResponse,
  EventDailyScansResponse,
  EventCapacityCountsResponse,
  EventLogsResponse,
  AnnouncementCreateRequest,
  AnnouncementCreateResponse,
  Announcement,
  EventCreateRequest,
  EventUpdateRequest,
  EventTeamAssignRequest,
  EventTeamRoleUpdateRequest,
  ParticipantTeamUpdateRequest,
  Workshop,
  WorkshopCreateRequest,
  WorkshopUpdateRequest,
  WorkshopSlot,
  WorkshopSlotCreateRequest,
  WorkshopSlotUpdateRequest,
  WorkshopSlotUpdateResponse,
  WorkshopSlotDeleteResponse,
  WorkshopAssignVolunteerRequest,
  WorkshopLogsResponse,
  WorkshopParticipationResponse,
  WorkshopParticipantUpdateRequest,
  WorkshopParticipantUpdateResponse,
  BackendTeamMember,
  BackendTeamCreateRequest,
  BackendTeamCreateResponse,
  BackendTeamUpdateRequest,
  ParticipantStatisticsResponse,
  ParticipantListResponse,
  ParticipantFilter,
  ParticipantAdminUpdateRequest,
  ParticipantUpdateResponse,
  QueryRecord,
  QueryFilter,
  QueryCreateRequest,
  QueryCreateResponse,
  QueryUpdateRequest,
  QueryUpdateResponse,
  QueryReplyRequest,
  QueryReplyResponse,
  IssueCreateRequest,
  IssueCreateResponse,
  IssueFilter,
  IssueListResponse,
  IssueUpdateRequest,
  IssueUpdateResponse,
  StaffIssueListResponse,
  AuditLogEntry,
  AuditLogFilter,
  AuditLogSummary,
  MessageResponse,
} from './types';
import type { FieldError } from './errors';

export interface ApiClient {
  // ---- auth ----
  register(req: RegisterRequest): Promise<RegisterResponse>;
  login(req: LoginRequest): Promise<ParticipantLoginResponse>;
  adminLogin(req: LoginRequest): Promise<StaffLoginResponse>;
  forgotPassword(req: ForgotPasswordRequest): Promise<ForgotPasswordResponse>;
  resetPassword(req: ResetPasswordRequest): Promise<MessageResponse>;
  changePassword(req: ChangePasswordRequest): Promise<ChangePasswordResponse>;

  // ---- profile ----
  completeProfile(req: ProfileCompleteRequest): Promise<ProfileCompleteResponse>;

  // ---- mess ----
  listMess(): Promise<Mess[]>;
  createMess(req: MessCreateRequest): Promise<MessageResponse>;
  assignMessTeam(messId: string, req: MessAssignTeamRequest): Promise<MessageResponse>;
  toggleMessScan(messId: string, userId: string, logging: boolean): Promise<MessageResponse>;
  /**
   * Replace a hall's menu wholesale. Open to that hall's `mess_team` as well as
   * to Super Admins — the same check `POST /mess/{id}/scan` makes, and wider than
   * every other mess write.
   */
  updateMessMenu(messId: string, req: MessMenuRequest): Promise<MessageResponse>;
  allocateMess(): Promise<MessageResponse>;
  myMess(): Promise<MyMessResponse>;
  scanMess(
    messId: string,
    slot: MealSlot,
    day: number,
    body: ScanQRRequest,
  ): Promise<MessScanResponse>;
  messStatistics(messId: string): Promise<MessStatisticsResponse>;

  // ---- hostels ----
  listHostels(): Promise<Hostel[]>;
  createHostel(req: HostelCreateRequest): Promise<MessageResponse>;
  assignHostelTeam(hostelId: string, req: HostelAssignTeamRequest): Promise<MessageResponse>;
  /** `attendance`, not `logging` — the query param `toggle_hostel_scan` actually binds. */
  toggleHostelScan(hostelId: string, userId: string, attendance: boolean): Promise<MessageResponse>;
  allocateHostels(): Promise<MessageResponse>;
  myHostel(): Promise<MyHostelResponse>;
  /** Ask for a hostel place. Idempotent; refused once one is allotted. */
  registerForAccommodation(): Promise<MessageResponse>;
  /** Withdraw a pending accommodation request. Refused once one is allotted. */
  cancelAccommodationRequest(): Promise<MessageResponse>;
  scanHostel(
    hostelId: string,
    action: 'entry' | 'exit' | 'permanent_exit',
    body: ScanQRRequest,
  ): Promise<HostelScanResponse>;
  hostelStatistics(hostelId: string): Promise<HostelStatisticsResponse>;

  // ---- events ----
  listEvents(): Promise<Event[]>;
  /** The pre-login festival brochure. Requires no token. */
  listPublicEvents(): Promise<PublicEventRecord[]>;
  createEvent(req: EventCreateRequest): Promise<MessageResponse>;
  updateEvent(eventId: string, req: EventUpdateRequest): Promise<MessageResponse>;
  deleteEvent(eventId: string): Promise<MessageResponse>;
  assignEventTeam(eventId: string, req: EventTeamAssignRequest): Promise<MessageResponse>;
  /** Change an existing event team member's role. */
  updateEventTeamRole(
    eventId: string,
    userId: string,
    req: EventTeamRoleUpdateRequest,
  ): Promise<MessageResponse>;
  /** Take somebody off an event's team, freeing them to be assigned elsewhere. */
  removeEventTeamMember(eventId: string, userId: string): Promise<MessageResponse>;
  /** `req` is optional: the backend declares the body `Optional[...] = None`, so a solo entry with nothing to submit may omit it. */
  registerForEvent(eventId: string, req?: EventRegistrationInput): Promise<MessageResponse>;
  editEventRegistration(
    eventId: string,
    req: Pick<EventRegistrationInput, 'registration_data'>,
  ): Promise<MessageResponse>;
  cancelEventRegistration(eventId: string): Promise<MessageResponse>;
  myEventRegistrations(): Promise<MyEventRegistration[]>;
  eventParticipation(eventId: string): Promise<EventParticipationResponse>;
  allocateEventTeams(eventId: string): Promise<MessageResponse>;
  updateParticipantTeam(
    eventId: string,
    participantId: string,
    req: ParticipantTeamUpdateRequest,
  ): Promise<MessageResponse>;
  scanEvent(eventId: string, body: ScanQRRequest): Promise<EventScanResponse>;
  myDailyEventScans(eventId: string): Promise<EventDailyScansResponse>;
  /**
   * Publish a notification about this event to everybody registered for it —
   * Story 8.2. The event's own Event Head, or a Super Admin.
   */
  createAnnouncement(
    eventId: string,
    req: AnnouncementCreateRequest,
  ): Promise<AnnouncementCreateResponse>;
  /**
   * Newest first. Readable by whoever it is for — a registered participant —
   * plus whoever might send one: the event's own team, or a Super Admin.
   */
  listAnnouncements(eventId: string): Promise<Announcement[]>;
  /** How full one event is, as counts only. Readable by any signed-in user. */
  eventCapacityCounts(eventId: string): Promise<EventCapacityCountsResponse>;
  /** Every attendance scan recorded for one event. Super Admins only. */
  eventLogs(eventId: string): Promise<EventLogsResponse>;

  // ---- embeddings ----
  /**
   * Generate embeddings for text input(s). Used by client-side recommendations
   * to convert a query string into a vector for similarity calculation.
   * Returns one embedding vector per input string.
   */
  generateEmbedding(input: string | string[]): Promise<number[][]>;

  // ---- workshop slots (super admin) ----
  /** The slot catalogue — `D<day>S<shift>` time blocks. No token required. */
  listWorkshopSlots(): Promise<WorkshopSlot[]>;
  createWorkshopSlot(req: WorkshopSlotCreateRequest): Promise<MessageResponse>;
  /** Cascades an edited `start_time` onto every workshop referencing this slot. */
  updateWorkshopSlot(
    slotId: string,
    req: WorkshopSlotUpdateRequest,
  ): Promise<WorkshopSlotUpdateResponse>;
  /** Deletes the slot and every workshop scheduled against it, with their bookings. */
  deleteWorkshopSlot(slotId: string): Promise<WorkshopSlotDeleteResponse>;

  // ---- workshops ----
  /** The published workshop programme — no token required. */
  listPublicWorkshops(): Promise<PublicWorkshopRecord[]>;
  listWorkshops(): Promise<Workshop[]>;
  createWorkshop(req: WorkshopCreateRequest): Promise<MessageResponse>;
  updateWorkshop(workshopId: string, req: WorkshopUpdateRequest): Promise<MessageResponse>;
  deleteWorkshop(workshopId: string): Promise<MessageResponse>;
  assignWorkshopVolunteer(
    workshopId: string,
    req: WorkshopAssignVolunteerRequest,
  ): Promise<MessageResponse>;
  toggleWorkshopScan(
    workshopId: string,
    userId: string,
    attendance: boolean,
  ): Promise<MessageResponse>;
  workshopLogs(workshopId: string): Promise<WorkshopLogsResponse>;
  /**
   * This workshop's roster, with each registrant's academic level. Readable by a
   * Super Admin or by a member of that workshop's own team — unlike
   * `workshopLogs`, which is Super Admin-only.
   */
  workshopParticipation(workshopId: string): Promise<WorkshopParticipationResponse>;
  /**
   * Correct one participant's attendance or booking type for this workshop. Needs
   * scanning permission on that workshop, or Super Admin.
   */
  updateWorkshopParticipant(
    workshopId: string,
    participantId: string,
    req: WorkshopParticipantUpdateRequest,
  ): Promise<WorkshopParticipantUpdateResponse>;
  /** Take somebody off a workshop's team. Super Admins only. */
  removeWorkshopVolunteer(workshopId: string, userId: string): Promise<MessageResponse>;
  registerForWorkshop(workshopId: string): Promise<MessageResponse>;
  myWorkshopRegistrations(): Promise<MyWorkshopRegistration[]>;
  workshopAttendance(
    workshopId: string,
    scanType: 'pre-registered' | 'on-spot',
    body: ScanQRRequest,
  ): Promise<MessageResponse>;

  // ---- backend teams (super admin) ----
  listBackendTeams(): Promise<BackendTeamMember[]>;
  createBackendTeam(req: BackendTeamCreateRequest): Promise<BackendTeamCreateResponse>;
  updateBackendTeam(paradoxId: string, req: BackendTeamUpdateRequest): Promise<MessageResponse>;
  deleteBackendTeam(paradoxId: string): Promise<MessageResponse>;

  // ---- participants (super admin) ----
  /**
   * Fest-wide participant counts. Counts only — this never returns a roster, so
   * it is safe for a dashboard that shows totals to everyone who can see the
   * dashboard at all.
   */
  participantStatistics(): Promise<ParticipantStatisticsResponse>;
  /**
   * The fest-wide roster — story 7.3's read half. A separate endpoint from the
   * statistics above rather than a flag on it, so a dashboard showing totals can
   * never be the thing that hands out names.
   */
  listParticipants(filter?: ParticipantFilter, limit?: number): Promise<ParticipantListResponse>;
  /**
   * Edit somebody else's record — story 7.3's write half. Profile fields only:
   * identity, credentials, and allocation state are owned by the routes that
   * enforce their rules.
   */
  updateParticipant(
    participantId: string,
    req: ParticipantAdminUpdateRequest,
  ): Promise<ParticipantUpdateResponse>;

  // ---- queries (epic 6) ----
  /** Raise a query. Participants only. */
  raiseQuery(req: QueryCreateRequest): Promise<QueryCreateResponse>;
  /** The author's own queries, newest first, replies included. */
  myQueries(): Promise<QueryRecord[]>;
  /**
   * The staff queue, already scoped by the backend to the blocks, halls, events,
   * and workshops the caller is named on a team for. A Super Admin gets the fest.
   */
  listQueries(filter?: QueryFilter, limit?: number): Promise<QueryRecord[]>;
  /** Set status and assignment. Staff on the owning team, or a Super Admin. */
  updateQuery(queryId: string, req: QueryUpdateRequest): Promise<QueryUpdateResponse>;
  /** Add to the thread. Either the author or the staff member handling it. */
  replyToQuery(queryId: string, req: QueryReplyRequest): Promise<QueryReplyResponse>;

  // ---- issues (story 5.4) ----
  /**
   * File a hostel or mess fault. Participants only, and only against the
   * facility they are actually placed in — the backend refuses anything else
   * with a 403, so a screen must offer only the caller's own block and hall.
   */
  reportIssue(req: IssueCreateRequest): Promise<IssueCreateResponse>;
  /** Every report this participant has filed, newest first, with its history. */
  myIssues(): Promise<IssueListResponse>;
  /**
   * The reports this staff member is answerable for — their own blocks' and
   * halls', or the whole fest for a Super Admin. A staffer on no team gets an
   * empty list rather than an error.
   */
  listIssues(filter?: IssueFilter, limit?: number): Promise<StaffIssueListResponse>;
  /**
   * Move a report along, and say something the reporter will read. Appends to
   * the history rather than overwriting it; a note with no status change is
   * valid.
   */
  updateIssue(issueId: string, req: IssueUpdateRequest): Promise<IssueUpdateResponse>;

  // ---- audit ----
  /**
   * The audit trail, newest first. `filter` narrows it server-side to one entity
   * or one action — necessary rather than cosmetic, since `limit` is applied
   * before any client-side filter could run.
   */
  auditLogs(limit?: number, filter?: AuditLogFilter): Promise<AuditLogEntry[]>;

  /**
   * Exact counts over the same trail, with no row limit.
   *
   * `auditLogs` above takes a `limit`, so `rows.length` off it is a floor, not a
   * total — which is what made the dashboard label a capped page "Recorded
   * Actions". Use this for any figure presented as a count, and `auditLogs` for
   * the rows themselves.
   */
  auditLogSummary(filter?: AuditLogFilter): Promise<AuditLogSummary>;
}

/** Error thrown by any ApiClient implementation on a non-success response. */
export class ApiClientError extends Error {
  status: number;

  /**
   * Per-field problems, for a 422 only. Empty for every other status.
   *
   * FastAPI reports request-validation failures as a list of `{loc, msg}`, which
   * is the only error shape in this API that identifies *which input* is wrong.
   * Carrying it here lets a form mark that input instead of printing one
   * sentence above the whole thing.
   */
  fieldErrors: FieldError[];

  constructor(status: number, message: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** The problem reported for one field, if the server named it. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((error) => error.field === field)?.message;
  }
}
