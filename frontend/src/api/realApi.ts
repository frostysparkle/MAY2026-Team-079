/**
 * Real backend client — a thin fetch wrapper implementing ApiClient 1:1 against
 * the actual FastAPI routes (see backend/main.py, backend/routers/*.py).
 */
import type { ApiClient } from './ApiClient';
import { ApiClientError } from './ApiClient';
import type {
  FastApiErrorBody,
  RegisterRequest,
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  ProfileCompleteRequest,
  ScanQRRequest,
  MessCreateRequest,
  MessAssignTeamRequest,
  MessMenuRequest,
  HostelCreateRequest,
  HostelAssignTeamRequest,
  EventRegistrationInput,
  EventCreateRequest,
  EventUpdateRequest,
  EventTeamAssignRequest,
  ParticipantTeamUpdateRequest,
  IssueCreateRequest,
  IssueUpdateRequest,
  ParticipantAdminUpdateRequest,
  QueryCreateRequest,
  QueryUpdateRequest,
  QueryReplyRequest,
  WorkshopCreateRequest,
  WorkshopUpdateRequest,
  WorkshopAssignVolunteerRequest,
  WorkshopParticipantUpdateRequest,
  BackendTeamCreateRequest,
  BackendTeamUpdateRequest,
} from './types';
import { env } from '@/config/env';

/** JWT is persisted by the auth store under this key. */
const TOKEN_KEY = 'pc_token';

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

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
    let message = res.statusText;
    try {
      const body = (await res.json()) as FastApiErrorBody;
      message = body.detail ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(res.status, message);
  }
  // Some 200s have no body (rare here, but be defensive).
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const realApi: ApiClient = {
  // ---- auth ----
  register: (req: RegisterRequest) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(req) }),
  login: (req: LoginRequest) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(req) }),
  adminLogin: (req: LoginRequest) =>
    request('/auth/admin/login', { method: 'POST', body: JSON.stringify(req) }),
  forgotPassword: (req: ForgotPasswordRequest) =>
    request('/auth/password/forgot', { method: 'POST', body: JSON.stringify(req) }),
  resetPassword: (req: ResetPasswordRequest) =>
    request('/auth/password/reset', { method: 'POST', body: JSON.stringify(req) }),
  changePassword: (req: ChangePasswordRequest) =>
    request('/auth/password/change', { method: 'POST', body: JSON.stringify(req) }),

  // ---- profile ----
  completeProfile: (req: ProfileCompleteRequest) =>
    request('/profile/complete', { method: 'PATCH', body: JSON.stringify(req) }),

  // ---- mess ----
  listMess: () => request('/mess'),
  createMess: (req: MessCreateRequest) =>
    request('/mess', { method: 'POST', body: JSON.stringify(req) }),
  assignMessTeam: (messId, req: MessAssignTeamRequest) =>
    request(`/mess/${messId}/team`, { method: 'POST', body: JSON.stringify(req) }),
  toggleMessScan: (messId, userId, logging) =>
    request(`/mess/${messId}/team/${userId}/toggle_scan${qs({ logging })}`, { method: 'PUT' }),
  updateMessMenu: (messId, req: MessMenuRequest) =>
    request(`/mess/${messId}/menu`, { method: 'PUT', body: JSON.stringify(req) }),
  allocateMess: () => request('/mess/allocate', { method: 'POST' }),
  myMess: () => request('/mess/my_mess'),
  scanMess: (messId, slot, day, body: ScanQRRequest) =>
    request(`/mess/${messId}/scan${qs({ slot, day })}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  messStatistics: (messId) => request(`/mess/${messId}/statistics`),

  // ---- hostels ----
  listHostels: () => request('/hostels'),
  createHostel: (req: HostelCreateRequest) =>
    request('/hostels', { method: 'POST', body: JSON.stringify(req) }),
  assignHostelTeam: (hostelId, req: HostelAssignTeamRequest) =>
    request(`/hostels/${hostelId}/team`, { method: 'POST', body: JSON.stringify(req) }),
  toggleHostelScan: (hostelId, userId, logging) =>
    request(`/hostels/${hostelId}/team/${userId}/toggle_scan${qs({ logging })}`, {
      method: 'PUT',
    }),
  allocateHostels: () => request('/hostels/allocate', { method: 'POST' }),
  myHostel: () => request('/hostels/my_hostel'),
  registerForAccommodation: () => request('/hostels/register', { method: 'POST' }),
  cancelAccommodationRequest: () => request('/hostels/register', { method: 'DELETE' }),
  scanHostel: (hostelId, action, body: ScanQRRequest) =>
    request(`/hostels/${hostelId}/scan${qs({ action })}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  hostelStatistics: (hostelId) => request(`/hostels/${hostelId}/statistics`),

  // ---- events ----
  listEvents: () => request('/events'),
  listPublicEvents: () => request('/events/public'),
  createEvent: (req: EventCreateRequest) =>
    request('/events', { method: 'POST', body: JSON.stringify(req) }),
  updateEvent: (eventId, req: EventUpdateRequest) =>
    request(`/events/${eventId}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteEvent: (eventId) => request(`/events/${eventId}`, { method: 'DELETE' }),
  assignEventTeam: (eventId, req: EventTeamAssignRequest) =>
    request(`/events/${eventId}/team`, { method: 'POST', body: JSON.stringify(req) }),
  registerForEvent: (eventId, req?: EventRegistrationInput) =>
    request(`/events/${eventId}/register`, { method: 'POST', body: JSON.stringify(req ?? {}) }),
  editEventRegistration: (eventId, req) =>
    request(`/events/${eventId}/register`, { method: 'PUT', body: JSON.stringify(req) }),
  cancelEventRegistration: (eventId) =>
    request(`/events/${eventId}/register`, { method: 'DELETE' }),
  myEventRegistrations: () => request('/events/my_registrations'),
  eventParticipation: (eventId) => request(`/events/${eventId}/participation`),
  allocateEventTeams: (eventId) => request(`/events/${eventId}/allocate_teams`, { method: 'POST' }),
  updateParticipantTeam: (eventId, participantId, req: ParticipantTeamUpdateRequest) =>
    request(`/events/${eventId}/participant_teams/${participantId}`, {
      method: 'PUT',
      body: JSON.stringify(req),
    }),
  scanEvent: (eventId, body: ScanQRRequest) =>
    request(`/events/${eventId}/scan`, { method: 'POST', body: JSON.stringify(body) }),
  myDailyEventScans: (eventId) => request(`/events/${eventId}/my_daily_scans`),
  eventCapacityCounts: (eventId) => request(`/events/${eventId}/capacity`),
  eventLogs: (eventId) => request(`/events/${eventId}/logs`),

  // ---- workshops ----
  listPublicWorkshops: () => request('/workshops/public'),
  listWorkshops: () => request('/workshops'),
  createWorkshop: (req: WorkshopCreateRequest) =>
    request('/workshops', { method: 'POST', body: JSON.stringify(req) }),
  updateWorkshop: (workshopId, req: WorkshopUpdateRequest) =>
    request(`/workshops/${workshopId}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteWorkshop: (workshopId) => request(`/workshops/${workshopId}`, { method: 'DELETE' }),
  assignWorkshopVolunteer: (workshopId, req: WorkshopAssignVolunteerRequest) =>
    request(`/workshops/${workshopId}/volunteers`, { method: 'POST', body: JSON.stringify(req) }),
  // The backend declares this handler as
  // `toggle_volunteer_scan(workshop_id, volunteer_user_id, attendance)` against
  // the path `/{workshop_id}/volunteers/{user_id}/toggle_scan` — so `user_id` in
  // the path is never read, and `volunteer_user_id` is a *required query
  // parameter*. Sending only `attendance` is a 422. The id therefore goes in
  // both places: the path keeps the URL honest, the query is what the handler
  // actually binds. Unlike the mess and hostel equivalents, whose team id is a
  // real path parameter.
  toggleWorkshopScan: (workshopId, userId, attendance) =>
    request(
      `/workshops/${workshopId}/volunteers/${userId}/toggle_scan${qs({
        volunteer_user_id: userId,
        attendance,
      })}`,
      { method: 'PUT' },
    ),
  workshopLogs: (workshopId) => request(`/workshops/${workshopId}/logs`),
  workshopParticipation: (workshopId) => request(`/workshops/${workshopId}/participation`),
  updateWorkshopParticipant: (workshopId, participantId, req: WorkshopParticipantUpdateRequest) =>
    request(`/workshops/${workshopId}/participants/${participantId}`, {
      method: 'PATCH',
      body: JSON.stringify(req),
    }),
  removeWorkshopVolunteer: (workshopId, userId) =>
    request(`/workshops/${workshopId}/volunteers/${userId}`, { method: 'DELETE' }),
  myWorkshopRegistrations: () => request('/workshops/my_registrations'),
  registerForWorkshop: (workshopId) =>
    request(`/workshops/${workshopId}/register`, { method: 'POST' }),
  workshopAttendance: (workshopId, scanType, body: ScanQRRequest) =>
    request(`/workshops/${workshopId}/attendance${qs({ scan_type: scanType })}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ---- backend teams ----
  listBackendTeams: () => request('/backend_teams'),
  createBackendTeam: (req: BackendTeamCreateRequest) =>
    request('/backend_teams', { method: 'POST', body: JSON.stringify(req) }),
  updateBackendTeam: (paradoxId, req: BackendTeamUpdateRequest) =>
    request(`/backend_teams/${paradoxId}`, { method: 'PUT', body: JSON.stringify(req) }),
  deleteBackendTeam: (paradoxId) => request(`/backend_teams/${paradoxId}`, { method: 'DELETE' }),

  // ---- participants ----
  participantStatistics: () => request('/participants/statistics'),
  listParticipants: (filter = {}, limit = 200) =>
    request(`/participants${qs({ limit, q: filter.q, house: filter.house })}`),
  updateParticipant: (participantId, req: ParticipantAdminUpdateRequest) =>
    request(`/participants/${participantId}`, { method: 'PATCH', body: JSON.stringify(req) }),

  // ---- queries ----
  raiseQuery: (req: QueryCreateRequest) =>
    request('/queries', { method: 'POST', body: JSON.stringify(req) }),
  myQueries: () => request('/queries/mine'),
  listQueries: (filter = {}, limit = 100) =>
    request(`/queries${qs({ limit, status: filter.status, category: filter.category })}`),
  updateQuery: (queryId, req: QueryUpdateRequest) =>
    request(`/queries/${queryId}`, { method: 'PATCH', body: JSON.stringify(req) }),
  replyToQuery: (queryId, req: QueryReplyRequest) =>
    request(`/queries/${queryId}/replies`, { method: 'POST', body: JSON.stringify(req) }),

  // ---- issues ----
  reportIssue: (req: IssueCreateRequest) =>
    request('/issues', { method: 'POST', body: JSON.stringify(req) }),
  myIssues: () => request('/issues/mine'),
  // `qs` drops undefined keys, so an unfiltered call sends only `limit`.
  listIssues: (filter = {}, limit = 100) =>
    request(
      `/issues${qs({
        limit,
        status: filter.status,
        facility_type: filter.facility_type,
        facility_id: filter.facility_id,
      })}`,
    ),
  updateIssue: (issueId, req: IssueUpdateRequest) =>
    request(`/issues/${issueId}`, { method: 'PATCH', body: JSON.stringify(req) }),

  // ---- audit ----
  // `qs` drops undefined keys, so an unfiltered call sends only `limit`.
  auditLogs: (limit = 100, filter = {}) =>
    request(
      `/audit-logs${qs({
        limit,
        target_id: filter.target_id,
        action: filter.action,
        since: filter.since,
        until: filter.until,
      })}`,
    ),
  auditLogSummary: (filter = {}) =>
    request(
      `/audit-logs/summary${qs({
        target_id: filter.target_id,
        action: filter.action,
        since: filter.since,
        until: filter.until,
      })}`,
    ),
};
