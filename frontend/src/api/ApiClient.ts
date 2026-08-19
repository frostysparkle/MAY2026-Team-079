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
  EventLogsResponse,
  EventCreateRequest,
  EventUpdateRequest,
  EventTeamAssignRequest,
  ParticipantTeamUpdateRequest,
  Workshop,
  WorkshopCreateRequest,
  WorkshopUpdateRequest,
  WorkshopAssignVolunteerRequest,
  WorkshopLogsResponse,
  BackendTeamMember,
  BackendTeamCreateRequest,
  BackendTeamCreateResponse,
  BackendTeamUpdateRequest,
  ParticipantStatisticsResponse,
  AuditLogEntry,
  AuditLogFilter,
  MessageResponse,
} from './types';

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
  toggleHostelScan(hostelId: string, userId: string, logging: boolean): Promise<MessageResponse>;
  allocateHostels(): Promise<MessageResponse>;
  myHostel(): Promise<MyHostelResponse>;
  /** Ask for a hostel place. Idempotent; refused once one is allotted. */
  registerForAccommodation(): Promise<MessageResponse>;
  /** Withdraw a pending accommodation request. Refused once one is allotted. */
  cancelAccommodationRequest(): Promise<MessageResponse>;
  scanHostel(
    hostelId: string,
    action: 'entry' | 'exit',
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
  /** Every attendance scan recorded for one event. Super Admins only. */
  eventLogs(eventId: string): Promise<EventLogsResponse>;

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

  // ---- audit ----
  /**
   * The audit trail, newest first. `filter` narrows it server-side to one entity
   * or one action — necessary rather than cosmetic, since `limit` is applied
   * before any client-side filter could run.
   */
  auditLogs(limit?: number, filter?: AuditLogFilter): Promise<AuditLogEntry[]>;
}

/** Error thrown by any ApiClient implementation on a non-success response. */
export class ApiClientError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
  }
}
