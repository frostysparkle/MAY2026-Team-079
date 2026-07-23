/**
 * In-memory mock implementation of ApiClient. Lets the whole app run with no
 * backend. Verification uses the real TOTP helper so the QR issue → scan →
 * verify flow behaves like production (including replay protection).
 *
 * Secrets are derived deterministically from (participantId, checkpoint) so a
 * device's persisted secret still verifies after a page reload, even though the
 * mock's own memory resets.
 */
import { Secret } from 'otpauth';
import type { ApiClient } from '@/api/ApiClient';
import { ApiClientError } from '@/api/ApiClient';
import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  CompleteProfileRequest,
  CompleteProfileResponse,
  ListUsersResponse,
  AssignRoleRequest,
  AssignRoleResponse,
  ProvisionSecretRequest,
  ProvisionSecretResponse,
  VerifyScanRequest,
  VerifyScanResponse,
  Participant,
  EventItem,
  EventListResponse,
  CreateEventRequest,
  UpdateEventRequest,
  SupportQuery,
  QueryListResponse,
  RaiseQueryRequest,
  UpdateQueryRequest,
  Contact,
  ContactListResponse,
  CreateContactRequest,
  UpdateContactRequest,
  MessMenuItem,
  MessMenuListResponse,
  CreateMessMenuRequest,
  UpdateMessMenuRequest,
  MessPass,
  MessEligibilityItem,
  MessEligibilityListResponse,
  MessStats,
  HostelAllocation,
  HostelAllocationWithParticipant,
  MyAllocationResponse,
  AllocationListResponse,
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
  Payment,
  MyPayments,
  ReconciliationResponse,
  Journey,
  OnboardingChoice,
  PendingPayments,
  PendingPaymentItem,
  RegistrationResult,
  MyRegistration,
  MyRegistrationsResponse,
  TestAccount,
} from '@/api/types';
import { TOTP, roleRank } from '@/config/constants';
import { verifyCode } from '@/lib/totp';
import { resolveJourney } from '@/features/journey/resolve';
import {
  seedParticipants,
  seedEvents,
  seedContacts,
  seedQueries,
  seedMessMenu,
  seedHostelAllocations,
  seedAnnouncements,
  seedMealPlans,
  seedTestAccounts,
} from './fixtures';

const participants: Participant[] = seedParticipants();
const events: EventItem[] = seedEvents();
const contacts: Contact[] = seedContacts();
const queries: SupportQuery[] = seedQueries();
const messMenu: MessMenuItem[] = seedMessMenu();
const hostelAllocations: HostelAllocation[] = seedHostelAllocations();
// Explicit mess-pass holders (Epic 4). Only these verify at the mess checkpoint.
const messEligible = new Set<string>(['p_participant']);
// Attendance (Epic 3): distinct participants counted per event id.
const eventAttendance: Record<string, Set<string>> = {};
const announcements: Announcement[] = seedAnnouncements();
const mealPlans: MealPlan[] = seedMealPlans();
// Mock payments store (Epic 10). Card data never appears here, matching the
// hosted-checkout model — only status + a mock transaction reference.
interface MockPayment extends Payment {
  userId: string;
  planId: string | null;
  sessionId: string;
}
const payments: MockPayment[] = [];
const HOSTEL_FEE = 2000;

/** Onboarding intent per participant (mirrors backend `users.onboarding`). */
interface MockOnboarding {
  accommodationChoice: OnboardingChoice | null;
  messChoice: OnboardingChoice | null;
  messPlanId: string | null;
}
const onboarding: Record<string, MockOnboarding> = {};

/** Soft-cancellable event registrations (mirrors `event_registrations`). */
interface MockRegistration {
  participantId: string;
  eventId: string;
  status: 'registered' | 'cancelled';
  createdAt: string;
}
const eventRegistrations: MockRegistration[] = [];

/**
 * Labels shown by the dev account switcher, keyed by participant id. Populated
 * from the seeded test-harness matrix (Req 10) so the mock mirrors the backend.
 */
const testAccountLabels: Record<string, string> = {};

function toPaymentOut(p: MockPayment): Payment {
  return {
    id: p.id,
    kind: p.kind,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    planName: p.planName,
    txnRef: p.txnRef,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
  };
}

function latestPayment(userId: string | null, kind: 'hostel' | 'mess'): MockPayment | null {
  const mine = payments
    .filter((p) => p.userId === userId && p.kind === kind)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return mine[0] ?? null;
}

function paymentDisplayStatus(p: MockPayment | null): string {
  if (!p) return 'not_started';
  return p.status === 'created' ? 'pending' : p.status;
}

function activeRegCount(eventId: string): number {
  return eventRegistrations.filter((r) => r.eventId === eventId && r.status === 'registered')
    .length;
}

function isRegistered(participantId: string | null, eventId: string): boolean {
  return eventRegistrations.some(
    (r) => r.participantId === participantId && r.eventId === eventId && r.status === 'registered',
  );
}

/** Annotate an event with the current caller's registration context. */
function annotateEvent(e: EventItem): EventItem {
  const count = activeRegCount(e.id);
  return {
    ...e,
    registered: isRegistered(currentId, e.id),
    registrationCount: count,
    spotsLeft: Math.max(e.capacity - count, 0),
  };
}

function crowdStatus(attendance: number, capacity: number): 'available' | 'filling_fast' | 'full' {
  if (capacity <= 0) return 'available';
  const ratio = attendance / capacity;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.7) return 'filling_fast';
  return 'available';
}
let currentId: string | null = null;

// Used-code registry for replay protection: `${id}:${ctx}:${step}` -> true.
const usedCodes = new Set<string>();

// Minimal mock eligibility (not part of the shared API type) so the scanner can
// demonstrate payment_pending / not_eligible live.
const eligibility: Record<string, { hostelPaid: boolean; messEligible: boolean }> = {
  p_participant: { hostelPaid: true, messEligible: true },
};

// The default seeded participant has completed onboarding end-to-end.
onboarding.p_participant = {
  accommodationChoice: 'yes',
  messChoice: 'yes',
  messPlanId: 'plan_full',
};

/**
 * Seed the test-harness account matrix (Req 10) into the mock stores so the dev
 * account switcher and journey behave exactly like the backend seed script.
 */
(function seedTestHarness() {
  for (const seed of seedTestAccounts()) {
    const pid = seed.participant.id;
    if (!participants.some((p) => p.id === pid)) participants.push(seed.participant);
    testAccountLabels[pid] = seed.label;
    onboarding[pid] = {
      accommodationChoice: seed.onboarding.accommodationChoice,
      messChoice: seed.onboarding.messChoice,
      messPlanId: seed.onboarding.messPlanId,
    };
    eligibility[pid] = { hostelPaid: seed.hostelPaid, messEligible: seed.messEligible };
    if (seed.messEligible) messEligible.add(pid);
    if (seed.allocation && !hostelAllocations.some((a) => a.participantId === pid)) {
      hostelAllocations.push({
        id: `h_${pid}`,
        participantId: pid,
        hostelBlock: seed.allocation.hostelBlock,
        room: seed.allocation.room,
        instructions: 'Check in at the block office. Carry your digital ID.',
        coordinator: 'Hostel Desk · 9100000222',
        checkedIn: false,
        checkedInAt: null,
      });
    }
    for (const eventId of seed.registrations) {
      eventRegistrations.push({
        participantId: pid,
        eventId,
        status: 'registered',
        createdAt: '2026-07-20T10:00:00+05:30',
      });
    }
    for (const pay of seed.payments) {
      const now = '2026-07-20T10:00:00+05:30';
      payments.push({
        id: `pay_${pid}_${pay.kind}`,
        userId: pid,
        kind: pay.kind,
        status: pay.status,
        amount: pay.amount,
        currency: 'INR',
        planId: pay.kind === 'mess' ? seed.onboarding.messPlanId : null,
        planName: pay.planName ?? null,
        sessionId: `seed_${pid}_${pay.kind}`,
        txnRef: pay.status === 'paid' ? `MOCK-SEED-${pid}` : null,
        createdAt: now,
        paidAt: pay.status === 'paid' ? now : null,
      });
    }
  }
})();

const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms));

/** In-memory password store for the mock (email → password). */
const passwords = new Map<string, string>();

/** Deterministic Base32 secret from a seed (mulberry32 → 20 bytes). */
function deterministicSecret(seed: string): string {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const rand = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const bytes = new Uint8Array(20);
  for (let i = 0; i < bytes.length; i++) bytes[i] = rand() & 0xff;
  return new Secret({ buffer: bytes.buffer }).base32;
}

const secretKey = (id: string, ctx: string) => `${id}:${ctx}`;

export const mockApi: ApiClient = {
  async register({ email, password, fullName }: RegisterRequest): Promise<AuthResponse> {
    await delay();
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) {
      throw new ApiClientError(422, 'invalid_email', 'Enter a valid email address.');
    }
    if (password.length < 8) {
      throw new ApiClientError(
        422,
        'weak_password',
        'Password must be at least 8 characters.',
      );
    }
    if (participants.some((p) => p.email.toLowerCase() === normalized)) {
      throw new ApiClientError(
        409,
        'email_already_registered',
        'An account with this email already exists. Try signing in instead.',
      );
    }
    const created: Participant = {
      id: `p_${Date.now()}`,
      email: normalized,
      fullName: fullName?.trim() ?? '',
      role: 'participant',
      age: null,
      gender: null,
      phone: null,
      country: null,
      state: null,
      city: null,
      program: null,
      courseStage: null,
      courseStageOther: null,
      photoUrl: null,
      profileComplete: false,
      createdAt: new Date().toISOString(),
    };
    participants.push(created);
    passwords.set(normalized, password);
    currentId = created.id;
    return { session: { token: `mock.${created.id}`, participant: created }, isNewUser: true };
  },

  async login({ email, password }: LoginRequest): Promise<AuthResponse> {
    await delay();
    const normalized = email.trim().toLowerCase();
    const existing = participants.find((p) => p.email.toLowerCase() === normalized);
    // Seeded fixtures have no stored password, so accept any non-empty password
    // for them; registered accounts must match the password used at sign-up.
    const stored = passwords.get(normalized);
    const ok = existing && (stored ? stored === password : password.length > 0);
    if (!ok || !existing) {
      throw new ApiClientError(401, 'invalid_credentials', 'Incorrect email or password.');
    }
    currentId = existing.id;
    return { session: { token: `mock.${existing.id}`, participant: existing }, isNewUser: false };
  },

  async completeProfile(req: CompleteProfileRequest): Promise<CompleteProfileResponse> {
    await delay();
    const p = participants.find((x) => x.id === currentId);
    if (!p) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    Object.assign(p, {
      fullName: req.fullName,
      age: req.age,
      gender: req.gender,
      phone: req.phone,
      country: req.country,
      state: req.state,
      city: req.city,
      program: req.program,
      courseStage: req.courseStage,
      courseStageOther: req.courseStageOther ?? null,
      photoUrl: req.photoDataUrl, // mock stores the data URL directly
      profileComplete: true,
    });
    return { participant: p };
  },

  async listUsers(): Promise<ListUsersResponse> {
    await delay();
    return {
      users: participants.map((p) => ({
        id: p.id,
        fullName: p.fullName || '(profile incomplete)',
        email: p.email,
        role: p.role,
        createdAt: p.createdAt,
      })),
    };
  },

  async assignRole({ participantId, role }: AssignRoleRequest): Promise<AssignRoleResponse> {
    await delay();
    const p = participants.find((x) => x.id === participantId);
    if (!p) throw new ApiClientError(404, 'not_found', 'Participant not found.');
    p.role = role;
    return { participantId, role };
  },

  async provisionSecret({
    checkpointContext,
  }: ProvisionSecretRequest): Promise<ProvisionSecretResponse> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const secretBase32 = deterministicSecret(secretKey(currentId, checkpointContext));
    return { participantId: currentId, checkpointContext, secretBase32 };
  },

  async verifyScan({
    participantId,
    currentCode,
    checkpointContext,
    eventId,
  }: VerifyScanRequest): Promise<VerifyScanResponse> {
    await delay();
    const p = participants.find((x) => x.id === participantId);
    if (!p) return { result: 'unknown_participant' };

    // Recompute the same deterministic secret the device was provisioned with.
    const secret = deterministicSecret(secretKey(participantId, checkpointContext));
    const now = Date.now();
    const delta = verifyCode(secret, currentCode, now);
    if (delta === null) return { result: 'expired' };

    // Replay protection keyed on the exact matched 30s step.
    const step = Math.floor(now / 1000 / TOTP.period) + delta;
    const replayKey = `${participantId}:${checkpointContext}:${step}`;
    if (usedCodes.has(replayKey)) return { result: 'duplicate' };
    usedCodes.add(replayKey);

    // Eligibility (mock rules) for high-stakes checkpoints.
    const elig = eligibility[participantId];
    if (checkpointContext === 'hostel' && elig && !elig.hostelPaid) {
      return { result: 'payment_pending', detail: 'Hostel fee not yet paid.' };
    }
    // Mess requires an explicit mess pass (Epic 4, FR-4.2/4.3).
    if (checkpointContext === 'mess' && !messEligible.has(participantId)) {
      return { result: 'not_eligible', detail: 'No active mess pass.' };
    }
    // Hostel check-in requires an allocation (Epic 5, FR-5.2).
    const allocation =
      checkpointContext === 'hostel'
        ? hostelAllocations.find((a) => a.participantId === participantId)
        : undefined;
    if (checkpointContext === 'hostel' && !allocation) {
      return { result: 'not_eligible', detail: 'No accommodation assigned.' };
    }
    if (allocation) {
      allocation.checkedIn = true;
      allocation.checkedInAt = new Date().toISOString();
    }
    // Attendance (Epic 3): a valid event scan counts the participant once.
    if (checkpointContext === 'event' && eventId) {
      (eventAttendance[eventId] ??= new Set()).add(participantId);
    }

    return {
      result: 'valid',
      participant: { id: p.id, fullName: p.fullName || p.email, photoUrl: p.photoUrl },
      detail: allocation ? `${allocation.hostelBlock} · Room ${allocation.room}` : undefined,
    };
  },

  async listEvents(): Promise<EventListResponse> {
    await delay();
    const me = participants.find((p) => p.id === currentId);
    const canManage = me ? me.role !== 'participant' : false;
    const visible = canManage ? events : events.filter((e) => e.status === 'published');
    const sorted = [...visible].sort((a, b) =>
      `${a.eventDate}${a.startTime}`.localeCompare(`${b.eventDate}${b.startTime}`),
    );
    return { events: sorted.map(annotateEvent) };
  },

  async getEvent(id: string): Promise<EventItem> {
    await delay();
    const me = participants.find((p) => p.id === currentId);
    const canManage = me ? me.role !== 'participant' : false;
    const e = events.find((x) => x.id === id);
    if (!e || (!canManage && e.status !== 'published')) {
      throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    }
    return annotateEvent(e);
  },

  async createEvent(req: CreateEventRequest): Promise<EventItem> {
    await delay();
    const created: EventItem = {
      id: `e_${Date.now()}`,
      title: req.title,
      venue: req.venue,
      eventDate: req.eventDate,
      startTime: req.startTime,
      endTime: req.endTime,
      capacity: req.capacity,
      instructions: req.instructions,
      status: req.status ?? 'draft',
      createdAt: new Date().toISOString(),
    };
    events.push(created);
    return created;
  },

  async updateEvent(id: string, req: UpdateEventRequest): Promise<EventItem> {
    await delay();
    const e = events.find((x) => x.id === id);
    if (!e) throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    Object.assign(e, {
      ...(req.title !== undefined ? { title: req.title } : {}),
      ...(req.venue !== undefined ? { venue: req.venue } : {}),
      ...(req.eventDate !== undefined ? { eventDate: req.eventDate } : {}),
      ...(req.startTime !== undefined ? { startTime: req.startTime } : {}),
      ...(req.endTime !== undefined ? { endTime: req.endTime } : {}),
      ...(req.capacity !== undefined ? { capacity: req.capacity } : {}),
      ...(req.instructions !== undefined ? { instructions: req.instructions } : {}),
      ...(req.status !== undefined ? { status: req.status } : {}),
    });
    return e;
  },

  async raiseQuery(req: RaiseQueryRequest): Promise<SupportQuery> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const now = new Date().toISOString();
    const created: SupportQuery = {
      id: `q_${Date.now()}`,
      participantId: currentId,
      category: req.category,
      description: req.description,
      status: 'open',
      assignedTeam: null,
      createdAt: now,
      updatedAt: now,
    };
    queries.unshift(created);
    return created;
  },

  async listMyQueries(): Promise<QueryListResponse> {
    await delay();
    const mine = queries
      .filter((q) => q.participantId === currentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { queries: mine };
  },

  async listAllQueries(): Promise<QueryListResponse> {
    await delay();
    const all = [...queries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { queries: all };
  },

  async updateQuery(id: string, req: UpdateQueryRequest): Promise<SupportQuery> {
    await delay();
    const q = queries.find((x) => x.id === id);
    if (!q) throw new ApiClientError(404, 'query_not_found', 'Query not found.');
    if (req.status !== undefined) q.status = req.status;
    if (req.assignedTeam !== undefined) q.assignedTeam = req.assignedTeam;
    q.updatedAt = new Date().toISOString();
    return q;
  },

  async listContacts(): Promise<ContactListResponse> {
    await delay();
    const sorted = [...contacts].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
    return { contacts: sorted };
  },

  async createContact(req: CreateContactRequest): Promise<Contact> {
    await delay();
    const created: Contact = {
      id: `c_${Date.now()}`,
      name: req.name,
      role: req.role,
      category: req.category,
      phone: req.phone,
      email: req.email ?? null,
      isEmergency: req.isEmergency ?? false,
    };
    contacts.push(created);
    return created;
  },

  async updateContact(id: string, req: UpdateContactRequest): Promise<Contact> {
    await delay();
    const c = contacts.find((x) => x.id === id);
    if (!c) throw new ApiClientError(404, 'contact_not_found', 'Contact not found.');
    Object.assign(c, {
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.role !== undefined ? { role: req.role } : {}),
      ...(req.category !== undefined ? { category: req.category } : {}),
      ...(req.phone !== undefined ? { phone: req.phone } : {}),
      ...(req.email !== undefined ? { email: req.email } : {}),
      ...(req.isEmergency !== undefined ? { isEmergency: req.isEmergency } : {}),
    });
    return c;
  },

  async deleteContact(id: string): Promise<void> {
    await delay();
    const idx = contacts.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiClientError(404, 'contact_not_found', 'Contact not found.');
    contacts.splice(idx, 1);
  },

  async listMessMenu(): Promise<MessMenuListResponse> {
    await delay();
    const order = { breakfast: 0, lunch: 1, snacks: 2, dinner: 3 };
    const items = [...messMenu].sort(
      (a, b) => a.location.localeCompare(b.location) || order[a.meal] - order[b.meal],
    );
    return { items };
  },

  async createMessMenu(req: CreateMessMenuRequest): Promise<MessMenuItem> {
    await delay();
    if (messMenu.some((m) => m.location === req.location && m.meal === req.meal)) {
      throw new ApiClientError(409, 'menu_conflict', 'That location and meal already exists.');
    }
    const created: MessMenuItem = { id: `m_${Date.now()}`, ...req };
    messMenu.push(created);
    return created;
  },

  async updateMessMenu(id: string, req: UpdateMessMenuRequest): Promise<MessMenuItem> {
    await delay();
    const m = messMenu.find((x) => x.id === id);
    if (!m) throw new ApiClientError(404, 'menu_item_not_found', 'Menu item not found.');
    Object.assign(m, {
      ...(req.location !== undefined ? { location: req.location } : {}),
      ...(req.meal !== undefined ? { meal: req.meal } : {}),
      ...(req.items !== undefined ? { items: req.items } : {}),
      ...(req.startTime !== undefined ? { startTime: req.startTime } : {}),
      ...(req.endTime !== undefined ? { endTime: req.endTime } : {}),
    });
    return m;
  },

  async deleteMessMenu(id: string): Promise<void> {
    await delay();
    const idx = messMenu.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiClientError(404, 'menu_item_not_found', 'Menu item not found.');
    messMenu.splice(idx, 1);
  },

  async getMessPass(): Promise<MessPass> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    return { participantId: currentId, eligible: messEligible.has(currentId) };
  },

  async listMessEligibility(): Promise<MessEligibilityListResponse> {
    await delay();
    return {
      participants: participants.map((p) => ({
        id: p.id,
        fullName: p.fullName || null,
        email: p.email,
        eligible: messEligible.has(p.id),
      })),
    };
  },

  async setMessEligibility(id: string, eligible: boolean): Promise<MessEligibilityItem> {
    await delay();
    const p = participants.find((x) => x.id === id);
    if (!p) throw new ApiClientError(404, 'participant_not_found', 'Participant not found.');
    if (eligible) messEligible.add(id);
    else messEligible.delete(id);
    return { id: p.id, fullName: p.fullName || null, email: p.email, eligible };
  },

  async getMessStats(): Promise<MessStats> {
    await delay();
    return { eligibleCount: messEligible.size };
  },

  async getMyAllocation(): Promise<MyAllocationResponse> {
    await delay();
    const a = hostelAllocations.find((x) => x.participantId === currentId) ?? null;
    return { allocation: a };
  },

  async listAllocations(): Promise<AllocationListResponse> {
    await delay();
    const allocations: HostelAllocationWithParticipant[] = hostelAllocations.map((a) => {
      const p = participants.find((x) => x.id === a.participantId);
      return { ...a, fullName: p?.fullName || null, email: p?.email ?? null };
    });
    return { allocations };
  },

  async createAllocation(req: CreateAllocationRequest): Promise<HostelAllocation> {
    await delay();
    if (!participants.some((p) => p.id === req.participantId)) {
      throw new ApiClientError(404, 'participant_not_found', 'Participant not found.');
    }
    if (hostelAllocations.some((a) => a.participantId === req.participantId)) {
      throw new ApiClientError(409, 'allocation_conflict', 'Participant already has an allocation.');
    }
    const created: HostelAllocation = {
      id: `h_${Date.now()}`,
      participantId: req.participantId,
      hostelBlock: req.hostelBlock,
      room: req.room,
      instructions: req.instructions ?? '',
      coordinator: req.coordinator ?? null,
      checkedIn: false,
      checkedInAt: null,
    };
    hostelAllocations.push(created);
    return created;
  },

  async updateAllocation(id: string, req: UpdateAllocationRequest): Promise<HostelAllocation> {
    await delay();
    const a = hostelAllocations.find((x) => x.id === id);
    if (!a) throw new ApiClientError(404, 'allocation_not_found', 'Allocation not found.');
    Object.assign(a, {
      ...(req.hostelBlock !== undefined ? { hostelBlock: req.hostelBlock } : {}),
      ...(req.room !== undefined ? { room: req.room } : {}),
      ...(req.instructions !== undefined ? { instructions: req.instructions } : {}),
      ...(req.coordinator !== undefined ? { coordinator: req.coordinator } : {}),
    });
    return a;
  },

  async deleteAllocation(id: string): Promise<void> {
    await delay();
    const idx = hostelAllocations.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiClientError(404, 'allocation_not_found', 'Allocation not found.');
    hostelAllocations.splice(idx, 1);
  },

  async getEventAttendance(eventId: string): Promise<EventAttendance> {
    await delay();
    const e = events.find((x) => x.id === eventId);
    if (!e) throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    const attendance = eventAttendance[eventId]?.size ?? 0;
    const remaining = Math.max(e.capacity - attendance, 0);
    return { eventId, capacity: e.capacity, attendance, remaining, atCapacity: remaining === 0 };
  },

  async getEventCrowd(eventId: string): Promise<EventCrowd> {
    await delay();
    const e = events.find((x) => x.id === eventId);
    if (!e || e.status !== 'published') {
      throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    }
    const attendance = eventAttendance[eventId]?.size ?? 0;
    return { eventId, status: crowdStatus(attendance, e.capacity) };
  },

  async getAttendanceDashboard(): Promise<AttendanceDashboardResponse> {
    await delay();
    const published = events.filter((e) => e.status === 'published');
    return {
      events: published.map((e) => {
        const attendance = eventAttendance[e.id]?.size ?? 0;
        const remaining = Math.max(e.capacity - attendance, 0);
        return {
          eventId: e.id,
          title: e.title,
          venue: e.venue,
          capacity: e.capacity,
          attendance,
          remaining,
          atCapacity: remaining === 0,
          status: crowdStatus(attendance, e.capacity),
        };
      }),
    };
  },

  async listAnnouncements(): Promise<AnnouncementListResponse> {
    await delay();
    const me = participants.find((p) => p.id === currentId);
    const isPor = me ? roleRank(me.role) >= roleRank('organizer') : false;
    const hasHostel = hostelAllocations.some((a) => a.participantId === currentId);
    const visible = announcements.filter((a) => {
      switch (a.audience) {
        case 'all_participants':
        case 'event_registrants':
          return true;
        case 'hostel_residents':
          return hasHostel;
        case 'pors':
          return isPor;
        default:
          return false;
      }
    });
    const sorted = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { announcements: sorted };
  },

  async listAllAnnouncements(): Promise<AnnouncementListResponse> {
    await delay();
    const sorted = [...announcements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { announcements: sorted };
  },

  async createAnnouncement(req: CreateAnnouncementRequest): Promise<Announcement> {
    await delay();
    const me = participants.find((p) => p.id === currentId);
    const created: Announcement = {
      id: `a_${Date.now()}`,
      title: req.title,
      body: req.body,
      audience: req.audience,
      eventId: req.eventId ?? null,
      senderName: me?.fullName || 'Core Team',
      createdAt: new Date().toISOString(),
    };
    announcements.unshift(created);
    return created;
  },

  async deleteAnnouncement(id: string): Promise<void> {
    await delay();
    const idx = announcements.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiClientError(404, 'announcement_not_found', 'Announcement not found.');
    announcements.splice(idx, 1);
  },

  async getOverview(): Promise<OperationalOverview> {
    await delay();
    const published = events.filter((e) => e.status === 'published');
    let totalCheckedIn = 0;
    let atCapacity = 0;
    for (const e of published) {
      const att = eventAttendance[e.id]?.size ?? 0;
      totalCheckedIn += att;
      if (e.capacity > 0 && att >= e.capacity) atCapacity += 1;
    }
    const byStatus = (s: SupportQuery['status']) => queries.filter((q) => q.status === s).length;
    const open = byStatus('open');
    const assigned = byStatus('assigned');
    const inProgress = byStatus('in_progress');
    const resolved = byStatus('resolved');
    return {
      events: { active: published.length, totalCheckedIn, atCapacity },
      queries: { open, assigned, inProgress, resolved, unresolved: open + assigned + inProgress },
      hostel: {
        allocations: hostelAllocations.length,
        checkedIn: hostelAllocations.filter((a) => a.checkedIn).length,
      },
      mess: { eligible: messEligible.size },
    };
  },

  async listMealPlans(): Promise<MealPlanListResponse> {
    await delay();
    return { plans: mealPlans.filter((p) => p.active) };
  },

  async createMealPlan(req: CreateMealPlanRequest): Promise<MealPlan> {
    await delay();
    const created: MealPlan = {
      id: `plan_${Date.now()}`,
      name: req.name,
      description: req.description ?? '',
      amount: req.amount,
      currency: 'INR',
      active: req.active ?? true,
    };
    mealPlans.push(created);
    return created;
  },

  async updateMealPlan(id: string, req: UpdateMealPlanRequest): Promise<MealPlan> {
    await delay();
    const p = mealPlans.find((x) => x.id === id);
    if (!p) throw new ApiClientError(404, 'plan_not_found', 'Meal plan not found.');
    Object.assign(p, {
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.amount !== undefined ? { amount: req.amount } : {}),
      ...(req.active !== undefined ? { active: req.active } : {}),
    });
    return p;
  },

  async deleteMealPlan(id: string): Promise<void> {
    await delay();
    const idx = mealPlans.findIndex((x) => x.id === id);
    if (idx === -1) throw new ApiClientError(404, 'plan_not_found', 'Meal plan not found.');
    mealPlans.splice(idx, 1);
  },

  async startHostelCheckout(): Promise<CheckoutResponse> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    if (!hostelAllocations.some((a) => a.participantId === currentId)) {
      throw new ApiClientError(400, 'no_allocation', 'You need a hostel allocation before paying.');
    }
    const session = `sess_${Date.now()}`;
    const now = new Date().toISOString();
    const payment: MockPayment = {
      id: `pay_${Date.now()}`,
      userId: currentId,
      kind: 'hostel',
      status: 'created',
      amount: HOSTEL_FEE,
      currency: 'INR',
      planId: null,
      planName: null,
      sessionId: session,
      txnRef: null,
      createdAt: now,
      paidAt: null,
    };
    payments.push(payment);
    return {
      paymentId: payment.id,
      checkoutUrl: `/payments/mock?session=${session}&amount=${HOSTEL_FEE}&currency=INR`,
    };
  },

  async startMessCheckout(planId: string): Promise<CheckoutResponse> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const plan = mealPlans.find((p) => p.id === planId);
    if (!plan || !plan.active) {
      throw new ApiClientError(400, 'plan_inactive', 'That meal plan is not available.');
    }
    const session = `sess_${Date.now()}`;
    const now = new Date().toISOString();
    const payment: MockPayment = {
      id: `pay_${Date.now()}`,
      userId: currentId,
      kind: 'mess',
      status: 'created',
      amount: plan.amount,
      currency: 'INR',
      planId: plan.id,
      planName: plan.name,
      sessionId: session,
      txnRef: null,
      createdAt: now,
      paidAt: null,
    };
    payments.push(payment);
    return {
      paymentId: payment.id,
      checkoutUrl: `/payments/mock?session=${session}&amount=${plan.amount}&currency=INR`,
    };
  },

  async mockSettlePayment(sessionId: string, outcome: 'paid' | 'failed'): Promise<void> {
    await delay();
    const p = payments.find((x) => x.sessionId === sessionId);
    if (!p) throw new ApiClientError(404, 'payment_not_found', 'No payment for this session.');
    if (p.status === 'paid') return;
    if (outcome === 'failed') {
      p.status = 'failed';
      return;
    }
    p.status = 'paid';
    p.paidAt = new Date().toISOString();
    p.txnRef = `MOCK-${sessionId.slice(0, 12)}`;
    // Grant access on success, mirroring the backend.
    if (p.kind === 'hostel') {
      eligibility[p.userId] = { ...(eligibility[p.userId] ?? { messEligible: false }), hostelPaid: true };
    } else {
      messEligible.add(p.userId);
    }
  },

  async getMyPayments(): Promise<MyPayments> {
    await delay();
    const hostel = latestPayment(currentId, 'hostel');
    const mess = latestPayment(currentId, 'mess');
    return {
      hostel: hostel ? toPaymentOut(hostel) : null,
      mess: mess ? toPaymentOut(mess) : null,
    };
  },

  async getReconciliation(): Promise<ReconciliationResponse> {
    await delay();
    return {
      participants: participants.map((u) => ({
        id: u.id,
        fullName: u.fullName || null,
        email: u.email,
        hostelStatus: paymentDisplayStatus(latestPayment(u.id, 'hostel')),
        messStatus: paymentDisplayStatus(latestPayment(u.id, 'mess')),
      })),
    };
  },

  async getJourney(): Promise<Journey> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    return journeyFor(currentId);
  },

  async setAccommodationChoice(choice: OnboardingChoice): Promise<Journey> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const o = (onboarding[currentId] ??= {
      accommodationChoice: null,
      messChoice: null,
      messPlanId: null,
    });
    o.accommodationChoice = choice;
    return journeyFor(currentId);
  },

  async setMessChoice(choice: OnboardingChoice, planId?: string): Promise<Journey> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    if (choice === 'yes') {
      const plan = mealPlans.find((p) => p.id === planId && p.active);
      if (!plan) throw new ApiClientError(400, 'plan_inactive', 'That meal plan is not available.');
    }
    const o = (onboarding[currentId] ??= {
      accommodationChoice: null,
      messChoice: null,
      messPlanId: null,
    });
    o.messChoice = choice;
    o.messPlanId = choice === 'yes' ? (planId ?? null) : null;
    return journeyFor(currentId);
  },

  async getPendingPayments(): Promise<PendingPayments> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const o = onboarding[currentId] ?? {
      accommodationChoice: null,
      messChoice: null,
      messPlanId: null,
    };
    const items: PendingPaymentItem[] = [];
    if (o.accommodationChoice === 'yes' && !(eligibility[currentId]?.hostelPaid === true)) {
      items.push({
        kind: 'hostel',
        label: 'Hostel accommodation fee',
        amount: HOSTEL_FEE,
        currency: 'INR',
      });
    }
    if (o.messChoice === 'yes' && !messEligible.has(currentId)) {
      const plan = mealPlans.find((p) => p.id === o.messPlanId);
      if (plan) {
        items.push({ kind: 'mess', label: plan.name, amount: plan.amount, currency: 'INR' });
      }
    }
    return { items, total: items.reduce((s, i) => s + i.amount, 0), currency: 'INR' };
  },

  async registerEvent(eventId: string): Promise<RegistrationResult> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const e = events.find((x) => x.id === eventId);
    if (!e || e.status !== 'published') {
      throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    }
    const existing = eventRegistrations.find(
      (r) => r.participantId === currentId && r.eventId === eventId,
    );
    if (!existing || existing.status !== 'registered') {
      if (e.capacity > 0 && activeRegCount(eventId) >= e.capacity) {
        throw new ApiClientError(409, 'event_full', 'This event is at capacity.');
      }
      if (existing) {
        existing.status = 'registered';
      } else {
        eventRegistrations.push({
          participantId: currentId,
          eventId,
          status: 'registered',
          createdAt: new Date().toISOString(),
        });
      }
    }
    const count = activeRegCount(eventId);
    return {
      eventId,
      registered: true,
      registrationCount: count,
      spotsLeft: Math.max(e.capacity - count, 0),
    };
  },

  async cancelEventRegistration(eventId: string): Promise<void> {
    await delay();
    if (!currentId) throw new ApiClientError(401, 'not_authenticated', 'Please sign in again.');
    const reg = eventRegistrations.find(
      (r) => r.participantId === currentId && r.eventId === eventId && r.status === 'registered',
    );
    if (reg) reg.status = 'cancelled';
  },

  async listMyRegistrations(): Promise<MyRegistrationsResponse> {
    await delay();
    const mine = eventRegistrations
      .filter((r) => r.participantId === currentId && r.status === 'registered')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const registrations: MyRegistration[] = [];
    for (const r of mine) {
      const e = events.find((x) => x.id === r.eventId);
      if (!e) continue;
      registrations.push({
        eventId: e.id,
        title: e.title,
        venue: e.venue,
        eventDate: e.eventDate,
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.status,
        registeredAt: r.createdAt,
      });
    }
    return { registrations };
  },

  async devLogin(email: string): Promise<AuthResponse> {
    await delay();
    const target = email.trim().toLowerCase();
    const p = participants.find((x) => x.email.toLowerCase() === target);
    if (!p || !testAccountLabels[p.id]) {
      throw new ApiClientError(404, 'not_found', 'No test account for that email.');
    }
    currentId = p.id;
    return { session: { token: `mock.${p.id}`, participant: p }, isNewUser: false };
  },

  async listTestAccounts(): Promise<TestAccount[]> {
    await delay();
    return participants
      .filter((p) => testAccountLabels[p.id])
      .map((p) => ({
        email: p.email,
        fullName: p.fullName || null,
        role: p.role,
        label: testAccountLabels[p.id] ?? null,
      }));
  },
};

/** Resolve the derived onboarding journey for a participant (mirrors backend). */
function journeyFor(participantId: string): Journey {
  const p = participants.find((x) => x.id === participantId);
  const o = onboarding[participantId] ?? {
    accommodationChoice: null,
    messChoice: null,
    messPlanId: null,
  };
  return resolveJourney({
    profileComplete: p?.profileComplete ?? false,
    accommodationChoice: o.accommodationChoice,
    messChoice: o.messChoice,
    messPlanId: o.messPlanId,
    hasAllocation: hostelAllocations.some((a) => a.participantId === participantId),
    hostelPaid: eligibility[participantId]?.hostelPaid === true,
    messPaid: messEligible.has(participantId),
    eventsRegistered: eventRegistrations.filter(
      (r) => r.participantId === participantId && r.status === 'registered',
    ).length,
  });
}
