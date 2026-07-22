/**
 * Real backend client.
 *
 * Integration uses a HYBRID approach: the backend speaks snake_case and carries
 * a `roles` array, while the app keeps its camelCase types with a single `role`.
 * This module is the only place that bridges the two — every response is mapped
 * into the shapes declared in `./types`, so no component or the mock changes.
 *
 * Endpoint paths and shapes are the agreed contract in `docs/api-contract.md`.
 */
import type { ApiClient } from './ApiClient';
import { ApiClientError } from './ApiClient';
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
  UserListItem,
  ScanResultCode,
  EventItem,
  EventListResponse,
  CreateEventRequest,
  UpdateEventRequest,
  EventStatus,
  SupportQuery,
  QueryListResponse,
  RaiseQueryRequest,
  UpdateQueryRequest,
  QueryCategory,
  QueryStatus,
  QueryTeam,
  Contact,
  ContactListResponse,
  CreateContactRequest,
  UpdateContactRequest,
  ContactCategory,
  Meal,
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
  CrowdStatus,
  DashboardEvent,
  AttendanceDashboardResponse,
} from './types';
import { ROLES, type Role } from '@/config/constants';
import { env } from '@/config/env';

/** JWT is persisted by the auth store under this key. */
const TOKEN_KEY = 'pc_token';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    let code = 'error';
    let message = res.statusText;
    try {
      const body = await res.json();
      code = body.code ?? code;
      message = body.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(res.status, code, message);
  }
  // 204/empty bodies are not expected on the current contract, but guard anyway.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ----------------------------------------------------------- mappers --- */

/** Backend user/participant object (snake_case). */
interface BackendUser {
  id: string;
  email: string;
  roles?: string[];
  status?: string;
  email_verified?: boolean;
  profile_complete?: boolean;
  created_at?: string;
  photo_url?: string | null;
  profile?: {
    full_name?: string | null;
    age?: number | null;
    gender?: Participant['gender'];
    phone?: string | null;
    country?: string | null;
    state?: string | null;
    city?: string | null;
    program?: Participant['program'];
    course_stage?: Participant['courseStage'];
    course_stage_other?: string | null;
  } | null;
}

/** Pick the highest-ranked role from the backend `roles` array. */
function highestRole(roles: string[] | undefined): Role {
  const known = (roles ?? []).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
  if (known.length === 0) return 'participant';
  return known.reduce((best, r) => (ROLES.indexOf(r) > ROLES.indexOf(best) ? r : best));
}

/** Backend event object (snake_case). */
interface BackendEvent {
  id: string;
  title: string;
  venue: string;
  event_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  instructions: string;
  status: EventStatus;
  created_at?: string | null;
}

function toEvent(e: BackendEvent): EventItem {
  return {
    id: e.id,
    title: e.title,
    venue: e.venue,
    eventDate: e.event_date,
    startTime: e.start_time,
    endTime: e.end_time,
    capacity: e.capacity,
    instructions: e.instructions,
    status: e.status,
    createdAt: e.created_at ?? new Date(0).toISOString(),
  };
}

/** Map the app's camelCase event request into the backend's snake_case body. */
function fromEventRequest(req: CreateEventRequest | UpdateEventRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.title !== undefined) body.title = req.title;
  if (req.venue !== undefined) body.venue = req.venue;
  if (req.eventDate !== undefined) body.event_date = req.eventDate;
  if (req.startTime !== undefined) body.start_time = req.startTime;
  if (req.endTime !== undefined) body.end_time = req.endTime;
  if (req.capacity !== undefined) body.capacity = req.capacity;
  if (req.instructions !== undefined) body.instructions = req.instructions;
  if (req.status !== undefined) body.status = req.status;
  return body;
}

interface BackendQuery {
  id: string;
  participant_id: string;
  category: QueryCategory;
  description: string;
  status: QueryStatus;
  assigned_team: QueryTeam | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function toQuery(q: BackendQuery): SupportQuery {
  return {
    id: q.id,
    participantId: q.participant_id,
    category: q.category,
    description: q.description,
    status: q.status,
    assignedTeam: q.assigned_team,
    createdAt: q.created_at ?? new Date(0).toISOString(),
    updatedAt: q.updated_at ?? new Date(0).toISOString(),
  };
}

interface BackendContact {
  id: string;
  name: string;
  role: string;
  category: ContactCategory;
  phone: string;
  email: string | null;
  is_emergency: boolean;
}

function toContact(c: BackendContact): Contact {
  return {
    id: c.id,
    name: c.name,
    role: c.role,
    category: c.category,
    phone: c.phone,
    email: c.email,
    isEmergency: c.is_emergency,
  };
}

function fromContactRequest(
  req: CreateContactRequest | UpdateContactRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.name !== undefined) body.name = req.name;
  if (req.role !== undefined) body.role = req.role;
  if (req.category !== undefined) body.category = req.category;
  if (req.phone !== undefined) body.phone = req.phone;
  if (req.email !== undefined) body.email = req.email;
  if (req.isEmergency !== undefined) body.is_emergency = req.isEmergency;
  return body;
}

interface BackendMenuItem {
  id: string;
  location: string;
  meal: Meal;
  items: string;
  start_time: string;
  end_time: string;
}

function toMenuItem(m: BackendMenuItem): MessMenuItem {
  return {
    id: m.id,
    location: m.location,
    meal: m.meal,
    items: m.items,
    startTime: m.start_time,
    endTime: m.end_time,
  };
}

function fromMenuRequest(
  req: CreateMessMenuRequest | UpdateMessMenuRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (req.location !== undefined) body.location = req.location;
  if (req.meal !== undefined) body.meal = req.meal;
  if (req.items !== undefined) body.items = req.items;
  if (req.startTime !== undefined) body.start_time = req.startTime;
  if (req.endTime !== undefined) body.end_time = req.endTime;
  return body;
}

interface BackendEligibility {
  id: string;
  full_name: string | null;
  email: string;
  eligible: boolean;
}

function toEligibility(e: BackendEligibility): MessEligibilityItem {
  return { id: e.id, fullName: e.full_name, email: e.email, eligible: e.eligible };
}

interface BackendAllocation {
  id: string;
  participant_id: string;
  hostel_block: string;
  room: string;
  instructions: string;
  coordinator: string | null;
  checked_in: boolean;
  checked_in_at: string | null;
  full_name?: string | null;
  email?: string | null;
}

function toAllocation(a: BackendAllocation): HostelAllocation {
  return {
    id: a.id,
    participantId: a.participant_id,
    hostelBlock: a.hostel_block,
    room: a.room,
    instructions: a.instructions,
    coordinator: a.coordinator,
    checkedIn: a.checked_in,
    checkedInAt: a.checked_in_at,
  };
}

function toAllocationWithParticipant(a: BackendAllocation): HostelAllocationWithParticipant {
  return {
    ...toAllocation(a),
    fullName: a.full_name ?? null,
    email: a.email ?? null,
  };
}

/** Map a backend user object into the app's Participant type. */
function toParticipant(user: BackendUser): Participant {
  const p = user.profile ?? {};
  return {
    id: user.id,
    email: user.email,
    fullName: p.full_name ?? '',
    role: highestRole(user.roles),
    age: p.age ?? null,
    gender: p.gender ?? null,
    phone: p.phone ?? null,
    country: p.country ?? null,
    state: p.state ?? null,
    city: p.city ?? null,
    program: p.program ?? null,
    courseStage: p.course_stage ?? null,
    courseStageOther: p.course_stage_other ?? null,
    photoUrl: user.photo_url ?? null,
    profileComplete: user.profile_complete ?? false,
    createdAt: user.created_at ?? new Date(0).toISOString(),
  };
}

/* ------------------------------------------------------------ client --- */

export const realApi: ApiClient = {
  async loginWithGoogle(req: GoogleLoginRequest): Promise<GoogleLoginResponse> {
    const body = await request<{
      access_token: string;
      is_new_user: boolean;
      user: BackendUser;
    }>('/auth/google', {
      method: 'POST',
      // Frontend calls this "idToken"; the backend field is "credential".
      body: JSON.stringify({ credential: req.idToken }),
    });
    return {
      session: { token: body.access_token, participant: toParticipant(body.user) },
      isNewUser: body.is_new_user,
    };
  },

  async completeProfile(req: CompleteProfileRequest): Promise<CompleteProfileResponse> {
    const body = await request<{ participant: BackendUser }>('/profile/complete', {
      method: 'POST',
      body: JSON.stringify({
        full_name: req.fullName,
        age: req.age,
        gender: req.gender,
        phone: req.phone,
        country: req.country,
        state: req.state,
        city: req.city,
        program: req.program,
        course_stage: req.courseStage,
        course_stage_other: req.courseStageOther ?? null,
        photo_data_url: req.photoDataUrl,
      }),
    });
    return { participant: toParticipant(body.participant) };
  },

  async listUsers(): Promise<ListUsersResponse> {
    const body = await request<{
      users: Array<{
        id: string;
        full_name?: string | null;
        email: string;
        roles?: string[];
        created_at?: string;
      }>;
    }>('/admin/users');
    const users: UserListItem[] = body.users.map((u) => ({
      id: u.id,
      fullName: u.full_name || '(profile incomplete)',
      email: u.email,
      role: highestRole(u.roles),
      createdAt: u.created_at ?? new Date(0).toISOString(),
    }));
    return { users };
  },

  async assignRole(req: AssignRoleRequest): Promise<AssignRoleResponse> {
    const body = await request<{ participant_id: string; role: Role }>(
      `/admin/participants/${req.participantId}/role`,
      { method: 'PATCH', body: JSON.stringify({ role: req.role }) },
    );
    return { participantId: body.participant_id, role: body.role };
  },

  async provisionSecret(req: ProvisionSecretRequest): Promise<ProvisionSecretResponse> {
    const body = await request<{
      participant_id: string;
      checkpoint_context: ProvisionSecretRequest['checkpointContext'];
      secret_base32: string;
    }>('/qr/provision', {
      method: 'POST',
      body: JSON.stringify({ checkpoint_context: req.checkpointContext }),
    });
    return {
      participantId: body.participant_id,
      checkpointContext: body.checkpoint_context,
      secretBase32: body.secret_base32,
    };
  },

  async verifyScan(req: VerifyScanRequest): Promise<VerifyScanResponse> {
    const body = await request<{
      result: ScanResultCode;
      participant?: { id: string; full_name?: string | null; photo_url?: string | null };
      detail?: string;
    }>('/scan/verify', {
      method: 'POST',
      body: JSON.stringify({
        participant_id: req.participantId,
        current_code: req.currentCode,
        checkpoint_context: req.checkpointContext,
        ...(req.eventId ? { event_id: req.eventId } : {}),
      }),
    });
    return {
      result: body.result,
      participant: body.participant
        ? {
            id: body.participant.id,
            fullName: body.participant.full_name ?? '',
            photoUrl: body.participant.photo_url ?? null,
          }
        : undefined,
      detail: body.detail,
    };
  },

  async listEvents(): Promise<EventListResponse> {
    const body = await request<{ events: BackendEvent[] }>('/events');
    return { events: body.events.map(toEvent) };
  },

  async getEvent(id: string): Promise<EventItem> {
    return toEvent(await request<BackendEvent>(`/events/${id}`));
  },

  async createEvent(req: CreateEventRequest): Promise<EventItem> {
    return toEvent(
      await request<BackendEvent>('/events', {
        method: 'POST',
        body: JSON.stringify(fromEventRequest(req)),
      }),
    );
  },

  async updateEvent(id: string, req: UpdateEventRequest): Promise<EventItem> {
    return toEvent(
      await request<BackendEvent>(`/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fromEventRequest(req)),
      }),
    );
  },

  async raiseQuery(req: RaiseQueryRequest): Promise<SupportQuery> {
    return toQuery(
      await request<BackendQuery>('/queries', {
        method: 'POST',
        body: JSON.stringify({ category: req.category, description: req.description }),
      }),
    );
  },

  async listMyQueries(): Promise<QueryListResponse> {
    const body = await request<{ queries: BackendQuery[] }>('/queries');
    return { queries: body.queries.map(toQuery) };
  },

  async listAllQueries(): Promise<QueryListResponse> {
    const body = await request<{ queries: BackendQuery[] }>('/queries/manage');
    return { queries: body.queries.map(toQuery) };
  },

  async updateQuery(id: string, req: UpdateQueryRequest): Promise<SupportQuery> {
    const payload: Record<string, unknown> = {};
    if (req.status !== undefined) payload.status = req.status;
    if (req.assignedTeam !== undefined) payload.assigned_team = req.assignedTeam;
    return toQuery(
      await request<BackendQuery>(`/queries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    );
  },

  async listContacts(): Promise<ContactListResponse> {
    const body = await request<{ contacts: BackendContact[] }>('/contacts');
    return { contacts: body.contacts.map(toContact) };
  },

  async createContact(req: CreateContactRequest): Promise<Contact> {
    return toContact(
      await request<BackendContact>('/contacts', {
        method: 'POST',
        body: JSON.stringify(fromContactRequest(req)),
      }),
    );
  },

  async updateContact(id: string, req: UpdateContactRequest): Promise<Contact> {
    return toContact(
      await request<BackendContact>(`/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fromContactRequest(req)),
      }),
    );
  },

  async deleteContact(id: string): Promise<void> {
    await request<void>(`/contacts/${id}`, { method: 'DELETE' });
  },

  async listMessMenu(): Promise<MessMenuListResponse> {
    const body = await request<{ items: BackendMenuItem[] }>('/mess/menu');
    return { items: body.items.map(toMenuItem) };
  },

  async createMessMenu(req: CreateMessMenuRequest): Promise<MessMenuItem> {
    return toMenuItem(
      await request<BackendMenuItem>('/mess/menu', {
        method: 'POST',
        body: JSON.stringify(fromMenuRequest(req)),
      }),
    );
  },

  async updateMessMenu(id: string, req: UpdateMessMenuRequest): Promise<MessMenuItem> {
    return toMenuItem(
      await request<BackendMenuItem>(`/mess/menu/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(fromMenuRequest(req)),
      }),
    );
  },

  async deleteMessMenu(id: string): Promise<void> {
    await request<void>(`/mess/menu/${id}`, { method: 'DELETE' });
  },

  async getMessPass(): Promise<MessPass> {
    const body = await request<{ participant_id: string; eligible: boolean }>('/mess/pass');
    return { participantId: body.participant_id, eligible: body.eligible };
  },

  async listMessEligibility(): Promise<MessEligibilityListResponse> {
    const body = await request<{ participants: BackendEligibility[] }>('/mess/eligibility');
    return { participants: body.participants.map(toEligibility) };
  },

  async setMessEligibility(id: string, eligible: boolean): Promise<MessEligibilityItem> {
    return toEligibility(
      await request<BackendEligibility>(`/mess/eligibility/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ eligible }),
      }),
    );
  },

  async getMessStats(): Promise<MessStats> {
    const body = await request<{ eligible_count: number }>('/mess/stats');
    return { eligibleCount: body.eligible_count };
  },

  async getMyAllocation(): Promise<MyAllocationResponse> {
    const body = await request<{ allocation: BackendAllocation | null }>('/hostel/allocation');
    return { allocation: body.allocation ? toAllocation(body.allocation) : null };
  },

  async listAllocations(): Promise<AllocationListResponse> {
    const body = await request<{ allocations: BackendAllocation[] }>('/hostel/allocations');
    return { allocations: body.allocations.map(toAllocationWithParticipant) };
  },

  async createAllocation(req: CreateAllocationRequest): Promise<HostelAllocation> {
    return toAllocation(
      await request<BackendAllocation>('/hostel/allocations', {
        method: 'POST',
        body: JSON.stringify({
          participant_id: req.participantId,
          hostel_block: req.hostelBlock,
          room: req.room,
          instructions: req.instructions ?? '',
          coordinator: req.coordinator ?? null,
        }),
      }),
    );
  },

  async updateAllocation(id: string, req: UpdateAllocationRequest): Promise<HostelAllocation> {
    const body: Record<string, unknown> = {};
    if (req.hostelBlock !== undefined) body.hostel_block = req.hostelBlock;
    if (req.room !== undefined) body.room = req.room;
    if (req.instructions !== undefined) body.instructions = req.instructions;
    if (req.coordinator !== undefined) body.coordinator = req.coordinator;
    return toAllocation(
      await request<BackendAllocation>(`/hostel/allocations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
  },

  async deleteAllocation(id: string): Promise<void> {
    await request<void>(`/hostel/allocations/${id}`, { method: 'DELETE' });
  },

  async getEventAttendance(eventId: string): Promise<EventAttendance> {
    const b = await request<{
      event_id: string;
      capacity: number;
      attendance: number;
      remaining: number;
      at_capacity: boolean;
    }>(`/attendance/events/${eventId}`);
    return {
      eventId: b.event_id,
      capacity: b.capacity,
      attendance: b.attendance,
      remaining: b.remaining,
      atCapacity: b.at_capacity,
    };
  },

  async getEventCrowd(eventId: string): Promise<EventCrowd> {
    const b = await request<{ event_id: string; status: CrowdStatus }>(
      `/attendance/events/${eventId}/crowd`,
    );
    return { eventId: b.event_id, status: b.status };
  },

  async getAttendanceDashboard(): Promise<AttendanceDashboardResponse> {
    const b = await request<{
      events: Array<{
        event_id: string;
        title: string;
        venue: string;
        capacity: number;
        attendance: number;
        remaining: number;
        at_capacity: boolean;
        status: CrowdStatus;
      }>;
    }>('/attendance/dashboard');
    const events: DashboardEvent[] = b.events.map((e) => ({
      eventId: e.event_id,
      title: e.title,
      venue: e.venue,
      capacity: e.capacity,
      attendance: e.attendance,
      remaining: e.remaining,
      atCapacity: e.at_capacity,
      status: e.status,
    }));
    return { events };
  },
};
