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
} from '@/api/types';
import { IITM_EMAIL_DOMAINS, TOTP } from '@/config/constants';
import { verifyCode } from '@/lib/totp';
import {
  seedParticipants,
  seedEvents,
  seedContacts,
  seedQueries,
  seedMessMenu,
} from './fixtures';

const participants: Participant[] = seedParticipants();
const events: EventItem[] = seedEvents();
const contacts: Contact[] = seedContacts();
const queries: SupportQuery[] = seedQueries();
const messMenu: MessMenuItem[] = seedMessMenu();
// Explicit mess-pass holders (Epic 4). Only these verify at the mess checkpoint.
const messEligible = new Set<string>(['p_participant']);
let currentId: string | null = null;

// Used-code registry for replay protection: `${id}:${ctx}:${step}` -> true.
const usedCodes = new Set<string>();

// Minimal mock eligibility (not part of the shared API type) so the scanner can
// demonstrate payment_pending / not_eligible live.
const eligibility: Record<string, { hostelPaid: boolean; messEligible: boolean }> = {
  p_participant: { hostelPaid: false, messEligible: true },
};

const delay = (ms = 160) => new Promise((r) => setTimeout(r, ms));

const isIitmEmail = (email: string) => IITM_EMAIL_DOMAINS.some((d) => email.endsWith(d));

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
  async loginWithGoogle({ idToken }: GoogleLoginRequest): Promise<GoogleLoginResponse> {
    await delay();
    // In mock mode the "idToken" is simply the chosen Google email.
    const email = idToken.trim().toLowerCase();
    if (!isIitmEmail(email)) {
      throw new ApiClientError(
        403,
        'invalid_domain',
        'Please sign in with a valid IITM email address.',
      );
    }
    const existing = participants.find((p) => p.email === email);
    if (existing) {
      currentId = existing.id;
      return { session: { token: `mock.${existing.id}`, participant: existing }, isNewUser: false };
    }
    const created: Participant = {
      id: `p_${Date.now()}`,
      email,
      fullName: '',
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
    currentId = created.id;
    return { session: { token: `mock.${created.id}`, participant: created }, isNewUser: true };
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

    return {
      result: 'valid',
      participant: { id: p.id, fullName: p.fullName || p.email, photoUrl: p.photoUrl },
      detail: checkpointContext === 'hostel' ? 'Hostel A · Room 214' : undefined,
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
    return { events: sorted };
  },

  async getEvent(id: string): Promise<EventItem> {
    await delay();
    const me = participants.find((p) => p.id === currentId);
    const canManage = me ? me.role !== 'participant' : false;
    const e = events.find((x) => x.id === id);
    if (!e || (!canManage && e.status !== 'published')) {
      throw new ApiClientError(404, 'event_not_found', 'Event not found.');
    }
    return e;
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
};
