/**
 * The API surface the app depends on. Screens talk to this interface only —
 * never to `fetch` directly — so the mock and the real backend are swappable
 * with zero component changes.
 */
import type {
  GoogleLoginRequest,
  GoogleLoginResponse,
  CompleteProfileRequest,
  CompleteProfileResponse,
  ListUsersResponse,
  AssignRoleRequest,
  AssignRoleResponse,
  ProvisionSecretRequest,
  ProvisionSecretResponse,
  VerifyScanRequest,
  VerifyScanResponse,
  EventListResponse,
  EventItem,
  CreateEventRequest,
  UpdateEventRequest,
  QueryListResponse,
  SupportQuery,
  RaiseQueryRequest,
  UpdateQueryRequest,
  ContactListResponse,
  Contact,
  CreateContactRequest,
  UpdateContactRequest,
  MessMenuListResponse,
  MessMenuItem,
  CreateMessMenuRequest,
  UpdateMessMenuRequest,
  MessPass,
  MessEligibilityListResponse,
  MessEligibilityItem,
  MessStats,
  MyAllocationResponse,
  AllocationListResponse,
  HostelAllocation,
  CreateAllocationRequest,
  UpdateAllocationRequest,
  EventAttendance,
  EventCrowd,
  AttendanceDashboardResponse,
  Announcement,
  AnnouncementListResponse,
  CreateAnnouncementRequest,
  OperationalOverview,
  MealPlan,
  MealPlanListResponse,
  CreateMealPlanRequest,
  UpdateMealPlanRequest,
  CheckoutResponse,
  MyPayments,
  ReconciliationResponse,
  Journey,
  OnboardingChoice,
  PendingPayments,
  RegistrationResult,
  MyRegistrationsResponse,
  TestAccount,
} from './types';

export interface ApiClient {
  // Auth
  loginWithGoogle(req: GoogleLoginRequest): Promise<GoogleLoginResponse>;

  // Profile
  completeProfile(req: CompleteProfileRequest): Promise<CompleteProfileResponse>;

  // Admin / user management
  listUsers(): Promise<ListUsersResponse>;
  assignRole(req: AssignRoleRequest): Promise<AssignRoleResponse>;

  // QR / TOTP
  provisionSecret(req: ProvisionSecretRequest): Promise<ProvisionSecretResponse>;
  verifyScan(req: VerifyScanRequest): Promise<VerifyScanResponse>;

  // Events (Epic 1)
  listEvents(): Promise<EventListResponse>;
  getEvent(id: string): Promise<EventItem>;
  createEvent(req: CreateEventRequest): Promise<EventItem>;
  updateEvent(id: string, req: UpdateEventRequest): Promise<EventItem>;

  // Queries & contacts (Epic 6)
  raiseQuery(req: RaiseQueryRequest): Promise<SupportQuery>;
  listMyQueries(): Promise<QueryListResponse>;
  listAllQueries(): Promise<QueryListResponse>;
  updateQuery(id: string, req: UpdateQueryRequest): Promise<SupportQuery>;
  listContacts(): Promise<ContactListResponse>;
  createContact(req: CreateContactRequest): Promise<Contact>;
  updateContact(id: string, req: UpdateContactRequest): Promise<Contact>;
  deleteContact(id: string): Promise<void>;

  // Mess (Epic 4)
  listMessMenu(): Promise<MessMenuListResponse>;
  createMessMenu(req: CreateMessMenuRequest): Promise<MessMenuItem>;
  updateMessMenu(id: string, req: UpdateMessMenuRequest): Promise<MessMenuItem>;
  deleteMessMenu(id: string): Promise<void>;
  getMessPass(): Promise<MessPass>;
  listMessEligibility(): Promise<MessEligibilityListResponse>;
  setMessEligibility(id: string, eligible: boolean): Promise<MessEligibilityItem>;
  getMessStats(): Promise<MessStats>;

  // Hostel (Epic 5)
  getMyAllocation(): Promise<MyAllocationResponse>;
  listAllocations(): Promise<AllocationListResponse>;
  createAllocation(req: CreateAllocationRequest): Promise<HostelAllocation>;
  updateAllocation(id: string, req: UpdateAllocationRequest): Promise<HostelAllocation>;
  deleteAllocation(id: string): Promise<void>;

  // Attendance & crowd (Epic 3)
  getEventAttendance(eventId: string): Promise<EventAttendance>;
  getEventCrowd(eventId: string): Promise<EventCrowd>;
  getAttendanceDashboard(): Promise<AttendanceDashboardResponse>;

  // Announcements (Epic 8)
  listAnnouncements(): Promise<AnnouncementListResponse>;
  listAllAnnouncements(): Promise<AnnouncementListResponse>;
  createAnnouncement(req: CreateAnnouncementRequest): Promise<Announcement>;
  deleteAnnouncement(id: string): Promise<void>;

  // Operational overview (Epic 9)
  getOverview(): Promise<OperationalOverview>;

  // Onboarding journey (student-experience-redesign)
  getJourney(): Promise<Journey>;
  setAccommodationChoice(choice: OnboardingChoice): Promise<Journey>;
  setMessChoice(choice: OnboardingChoice, planId?: string): Promise<Journey>;
  getPendingPayments(): Promise<PendingPayments>;

  // Event registration (participant side)
  registerEvent(eventId: string): Promise<RegistrationResult>;
  cancelEventRegistration(eventId: string): Promise<void>;
  listMyRegistrations(): Promise<MyRegistrationsResponse>;

  // Dev-only test harness
  devLogin(email: string): Promise<GoogleLoginResponse>;
  listTestAccounts(): Promise<TestAccount[]>;

  // Payments (Epic 10)
  listMealPlans(): Promise<MealPlanListResponse>;
  createMealPlan(req: CreateMealPlanRequest): Promise<MealPlan>;
  updateMealPlan(id: string, req: UpdateMealPlanRequest): Promise<MealPlan>;
  deleteMealPlan(id: string): Promise<void>;
  startHostelCheckout(): Promise<CheckoutResponse>;
  startMessCheckout(planId: string): Promise<CheckoutResponse>;
  /** DEV/mock only: simulate the gateway completing a checkout. */
  mockSettlePayment(sessionId: string, outcome: 'paid' | 'failed'): Promise<void>;
  getMyPayments(): Promise<MyPayments>;
  getReconciliation(): Promise<ReconciliationResponse>;
}

/** Error thrown by any ApiClient implementation on a non-success response. */
export class ApiClientError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}
