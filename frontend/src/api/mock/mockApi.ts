/**
 * In-memory mock implementation of ApiClient, shaped like the real backend's
 * Mongo collections (participants, backend_teams, mess, hostels, events,
 * workshops, audit_logs) so it mirrors real error branches — not just happy
 * paths — since the whole test suite exercises this, not a stub.
 *
 * QR scanning uses real crypto.subtle RSA-OAEP keypairs per participant
 * (generated lazily on first login/scan), so the issue → scan → verify flow
 * behaves like production, including the fact that the decrypted payload is
 * a possession-proof only — identity comes from the plaintext participant_id,
 * exactly like backend/dependencies.py::verify_qr.
 */
import type { ApiClient } from '@/api/ApiClient';
import { ApiClientError } from '@/api/ApiClient';
import type {
  AuditLogEntry,
  AuditLogFilter,
  EventLogsResponse,
  BackendTeamCreateRequest,
  BackendTeamCreateResponse,
  BackendTeamMember,
  BackendTeamUpdateRequest,
  ChangePasswordRequest,
  ChangePasswordResponse,
  Event,
  EventCreateRequest,
  EventParticipant,
  EventParticipationResponse,
  EventRegistrationInput,
  EventScanResponse,
  EventTeamAssignRequest,
  EventUpdateRequest,
  ForgotPasswordRequest,
  Hostel,
  HostelAssignTeamRequest,
  HostelCreateRequest,
  HostelScanResponse,
  HostelStatisticsResponse,
  LoginRequest,
  MealSlot,
  MessAssignTeamRequest,
  MessCreateRequest,
  MessScanResponse,
  MessStatisticsResponse,
  MessageResponse,
  ParticipantStatisticsResponse,
  Mess,
  MyEventRegistration,
  MyWorkshopRegistration,
  MyHostelResponse,
  MyMessResponse,
  ParticipantLoginResponse,
  ParticipantTeamUpdateRequest,
  ProfileCompleteRequest,
  ProfileCompleteResponse,
  PublicEventRecord,
  PublicWorkshopRecord,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  ScanQRRequest,
  StaffLoginResponse,
  Workshop,
  WorkshopAssignVolunteerRequest,
  WorkshopCreateRequest,
  WorkshopLogsResponse,
  WorkshopUpdateRequest,
} from '@/api/types';
import { IITM_EMAIL_PATTERN } from '@/config/constants';
import {
  seedAuditLogs,
  seedBackendTeams,
  seedEventLogs,
  seedEvents,
  seedHostels,
  seedMess,
  seedParticipants,
  seedWorkshopLogs,
  seedWorkshops,
  type MockBackendTeamMember,
  type MockParticipant,
} from './fixtures';

const db = {
  participants: seedParticipants(),
  backendTeams: seedBackendTeams(),
  mess: seedMess(),
  hostels: seedHostels(),
  events: seedEvents(),
  workshops: seedWorkshops(),
  auditLogs: seedAuditLogs(),
  eventLogs: seedEventLogs(),
  workshopLogs: seedWorkshopLogs(),
};

let currentParticipantId: string | null = null;
let currentStaffId: string | null = null;

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();

/**
 * Append to the audit trail, exactly where `backend/logger.py::log_audit` would.
 *
 * The mock used to skip this entirely, so the trail never grew past its seed and
 * the dashboard's log views had nothing to show for anything done in the session.
 * Every call here mirrors a real `log_audit(...)` call site one-for-one — same
 * action name, same `target_id`, same `details` keys — because the audit trail is
 * the only record of mess and hostel scans, and the per-entity log views read it
 * by `target_id`.
 *
 * `actor` is passed rather than read from the session: a participant registering
 * for an event is the actor of that entry, not the staff member who is signed in.
 */
function recordAudit(
  actor: string,
  action: string,
  targetId: string | null = null,
  details: Record<string, unknown> = {},
): void {
  db.auditLogs.push({
    actor_id: actor,
    action,
    target_id: targetId,
    details,
    timestamp: now(),
  });
}

/** The actor id for whoever is signed in, staff or participant. */
function currentActor(): string {
  return currentStaffId ?? currentParticipantId ?? 'unknown';
}

/**
 * What an HTTP response actually hands a caller: a detached copy.
 *
 * List endpoints must never return `db.x` directly. Two things go wrong when
 * they do. A caller can mutate the "database" by editing the response — and,
 * more subtly, a mutating write (`db.events.splice(...)`) keeps the same array
 * identity, so a re-fetch resolves to a reference React has already seen and
 * `useMemo`/`useEffect` deps never fire. Real fetches always produce new objects,
 * so the mock does too.
 */
const snapshot = <T>(value: T): T => structuredClone(value);

/* ---------------------------------------------------------- auth helpers --- */

function requireParticipant(): MockParticipant {
  if (currentStaffId) {
    throw new ApiClientError(403, 'Participant credentials required. Use /auth/login.');
  }
  if (!currentParticipantId) throw new ApiClientError(401, 'Invalid authentication credentials');
  const p = db.participants.find((x) => x.participant_id === currentParticipantId);
  if (!p) throw new ApiClientError(401, 'Participant not found');
  return p;
}

function requireStaff(): MockBackendTeamMember {
  if (currentParticipantId) {
    throw new ApiClientError(403, 'Staff credentials required. Use /auth/admin/login.');
  }
  if (!currentStaffId) throw new ApiClientError(401, 'Invalid authentication credentials');
  const s = db.backendTeams.find((x) => x.paradox_id === currentStaffId);
  if (!s) throw new ApiClientError(401, 'Staff member not found');
  return s;
}

function requireSuperAdmin(message: string): MockBackendTeamMember {
  const s = requireStaff();
  if (s.role !== 'super_admin') throw new ApiClientError(403, message);
  return s;
}

function requireAuth(): void {
  if (!currentParticipantId && !currentStaffId) {
    throw new ApiClientError(401, 'Invalid authentication credentials');
  }
}

/* ------------------------------------------------------------- RSA / QR --- */

const keypairs = new Map<
  string,
  { publicKey: CryptoKey; privateKey: CryptoKey; publicPem: string }
>();

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pemFromDer(der: ArrayBuffer): string {
  const b64 = arrayBufferToBase64(der);
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

async function ensureKeypair(participantId: string) {
  let kp = keypairs.get(participantId);
  if (!kp) {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    kp = { publicKey: pair.publicKey, privateKey: pair.privateKey, publicPem: pemFromDer(spki) };
    keypairs.set(participantId, kp);
  }
  return kp;
}

/** Mirrors backend/dependencies.py::verify_qr: expiry + decrypt as possession-proof only. */
async function verifyQr(body: ScanQRRequest): Promise<MockParticipant> {
  const participant =
    db.participants.find((p) => p.participant_id === body.participant_id) ??
    db.participants.find((p) => p.email === body.participant_id);
  if (!participant) throw new ApiClientError(404, 'Scanned user not found');

  const kp = keypairs.get(participant.participant_id);
  if (!kp) throw new ApiClientError(400, 'User missing private key');

  const qrTimestamp = new Date(body.timestamp).getTime();
  if (Number.isNaN(qrTimestamp)) throw new ApiClientError(400, 'Invalid timestamp format');
  if (Date.now() - qrTimestamp > 60_000) throw new ApiClientError(400, 'QR Code expired');

  try {
    const ciphertext = base64ToArrayBuffer(body.data);
    const plaintext = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, kp.privateKey, ciphertext);
    JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new ApiClientError(400, 'Invalid or corrupted QR code');
  }
  return participant;
}

function toParticipantLoginResponse(
  p: MockParticipant,
  token: string,
  publicKey: string,
): ParticipantLoginResponse {
  return {
    id: p.participant_id,
    email: p.email,
    access_token: token,
    token_type: 'participant',
    full_name: p.profile.full_name,
    dob: p.profile.dob,
    house: p.profile.house,
    gender: p.profile.gender,
    phone: p.profile.phone,
    country: p.profile.country,
    state: p.profile.state,
    city: p.profile.city,
    address: p.profile.address,
    program: p.profile.program,
    course_stage: p.profile.course_stage,
    photo: p.photo,
    public_key: publicKey,
  };
}

function generateParticipantId(email: string): string {
  const match = /^([^@]+)@([a-z]+)\.study\.iitm\.ac\.in$/i.exec(email.toLowerCase());
  if (!match) return email.split('@')[0].toUpperCase();
  const [, roll, program] = match;
  return `${program}${roll}`.toUpperCase();
}

/* ------------------------------------------------------------- workshops --- */

function stripWorkshopTeamIfNeeded(ws: Workshop[]): Workshop[] {
  const staff = currentStaffId
    ? db.backendTeams.find((s) => s.paradox_id === currentStaffId)
    : null;
  if (staff?.role === 'super_admin') return ws;
  return ws.map(({ workshop_team: _workshop_team, ...rest }) => rest);
}

function findWorkshop(workshopId: string): Workshop | undefined {
  return db.workshops.find((w) => w.workshop_id === workshopId || w.slot_id === workshopId);
}

/* ------------------------------------------------------------------ mock --- */

export const mockApi: ApiClient = {
  // ---- auth ----
  async register({ email, password }: RegisterRequest): Promise<RegisterResponse> {
    await delay();
    if (!IITM_EMAIL_PATTERN.test(email)) {
      throw new ApiClientError(400, 'Must be an @*.study.iitm.ac.in email');
    }
    const lower = email.toLowerCase();
    if (
      db.participants.some((p) => p.email.toLowerCase() === lower) ||
      db.backendTeams.some((s) => s.email.toLowerCase() === lower)
    ) {
      throw new ApiClientError(400, 'Email already registered');
    }
    const participant_id = generateParticipantId(email);
    db.participants.push({
      participant_id,
      email: lower,
      password,
      profile: {
        full_name: null,
        dob: null,
        house: null,
        gender: null,
        phone: null,
        country: null,
        state: null,
        city: null,
        address: null,
        program: null,
        course_stage: null,
      },
      photo: null,
      mess: { registered: false, mess_id: null, entries: [] },
      accommodation: { registered: false, hostel_id: null, room: null, logged_in: false },
      events: [],
      workshops: [],
      created_at: new Date().toISOString(),
    });
    return { message: 'Registration successful', participant_id };
  },

  async login({ email, password }: LoginRequest): Promise<ParticipantLoginResponse> {
    await delay();
    const p = db.participants.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!p || p.password !== password) throw new ApiClientError(401, 'Invalid credentials');
    currentParticipantId = p.participant_id;
    currentStaffId = null;
    const kp = await ensureKeypair(p.participant_id);
    return toParticipantLoginResponse(p, `mock.participant.${p.participant_id}`, kp.publicPem);
  },

  async adminLogin({ email, password }: LoginRequest): Promise<StaffLoginResponse> {
    await delay();
    const s = db.backendTeams.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!s || s.password !== password) throw new ApiClientError(401, 'Invalid credentials');
    currentStaffId = s.paradox_id;
    currentParticipantId = null;
    return {
      id: s.paradox_id,
      email: s.email,
      access_token: `mock.staff.${s.paradox_id}`,
      token_type: 'staff',
      role: s.role,
      department: s.department,
      designation: s.designation,
    };
  },

  async forgotPassword(_req: ForgotPasswordRequest) {
    await delay();
    return {
      message: 'If the account exists, a reset link has been sent.',
      dev_reset_url: 'http://localhost:5173/reset-password?token=mock_token_123',
    };
  },

  async resetPassword(_req: ResetPasswordRequest): Promise<MessageResponse> {
    await delay();
    return { message: 'Password reset successfully.' };
  },

  async changePassword({
    current_password,
    new_password,
  }: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    await delay();
    if (currentParticipantId) {
      const p = db.participants.find((x) => x.participant_id === currentParticipantId)!;
      if (p.password !== current_password)
        throw new ApiClientError(400, 'Incorrect current password');
      p.password = new_password;
      return {
        message: 'Password changed successfully.',
        access_token: `mock.participant.${p.participant_id}`,
      };
    }
    if (currentStaffId) {
      const s = db.backendTeams.find((x) => x.paradox_id === currentStaffId)!;
      if (s.password !== current_password)
        throw new ApiClientError(400, 'Incorrect current password');
      s.password = new_password;
      return {
        message: 'Password changed successfully.',
        access_token: `mock.staff.${s.paradox_id}`,
      };
    }
    throw new ApiClientError(401, 'Invalid authentication credentials');
  },

  // ---- profile ----
  async completeProfile(req: ProfileCompleteRequest): Promise<ProfileCompleteResponse> {
    await delay();
    const p = requireParticipant();
    p.profile = {
      full_name: req.full_name,
      dob: req.dob,
      house: req.house,
      gender: req.gender,
      phone: req.phone,
      mess_preference: req.mess_preference,
      country: req.country,
      state: req.state,
      city: req.city,
      address: req.address,
      emergency_contact: req.emergency_contact,
      program: req.program,
      course_stage: req.course_stage,
    };
    if (req.photo) p.photo = req.photo;
    return {
      full_name: req.full_name,
      dob: req.dob,
      house: req.house,
      gender: req.gender,
      phone: req.phone,
      mess_preference: req.mess_preference,
      country: req.country,
      state: req.state,
      city: req.city,
      address: req.address,
      emergency_contact: req.emergency_contact,
      program: req.program,
      course_stage: req.course_stage,
      photo: p.photo,
    };
  },

  // ---- mess ----
  async listMess(): Promise<Mess[]> {
    await delay();
    requireAuth();
    return snapshot(db.mess);
  },
  async createMess(req: MessCreateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    // Stored as an array even when none were chosen, matching what the backend
    // writes, so consumers never have to handle both missing and empty.
    db.mess.push({ ...req, cuisines: req.cuisines ?? [], mess_team: [] });
    recordAudit(currentActor(), 'CREATE_MESS', req.mess_id, { capacity: req.capacity });
    return { message: 'Mess created' };
  },
  async assignMessTeam(messId, req: MessAssignTeamRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const mess = db.mess.find((m) => m.mess_id === messId);
    if (!mess) throw new ApiClientError(404, 'Mess not found');
    mess.mess_team ??= [];
    if (req.user_id && mess.mess_team.some((t) => t.user_id === req.user_id)) {
      throw new ApiClientError(409, 'Team member already assigned to this mess');
    }
    mess.mess_team.push({
      user_id: req.user_id ?? null,
      role: req.role,
      name: req.name,
      phone: req.phone,
      logging: req.role === 'other',
    });
    recordAudit(currentActor(), 'ASSIGN_MESS_TEAM', messId, {
      team_user_id: req.user_id,
      role: req.role,
    });
    return { message: 'Team member assigned' };
  },
  async toggleMessScan(messId, userId, logging): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const mess = db.mess.find((m) => m.mess_id === messId);
    const member = mess?.mess_team?.find((t) => t.user_id === userId);
    if (member) member.logging = logging;
    return { message: 'Scanning toggled' };
  },
  async allocateMess(): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    let allocated = 0;
    for (const p of db.participants) {
      if (p.mess.mess_id) continue;
      const pref = p.profile.mess_preference ?? 'veg';
      const match = db.mess.find((m) => m.preference === pref);
      if (match) {
        p.mess.mess_id = match.mess_id;
        p.mess.registered = true;
        p.mess.entries =
          p.mess.entries.length > 0
            ? p.mess.entries
            : Array.from({ length: 5 }, () => ({
                breakfast: { logged: false },
                lunch: { logged: false },
                dinner: { logged: false },
              }));
        allocated++;
      }
    }
    // Not tied to one hall, so `target_id` stays null — same as the backend.
    recordAudit(currentActor(), 'ALLOCATE_MESSES', null, { allocated_count: allocated });
    return { message: `Allocated ${allocated} participants` };
  },
  async myMess(): Promise<MyMessResponse> {
    await delay();
    const p = requireParticipant();
    const mess = p.mess.mess_id
      ? (db.mess.find((m) => m.mess_id === p.mess.mess_id) ?? null)
      : null;
    return { allotted_mess: p.mess.mess_id, mess_details: mess, slots: p.mess.entries };
  },
  async scanMess(messId, slot: MealSlot, day, body: ScanQRRequest): Promise<MessScanResponse> {
    await delay();
    const staff = requireStaff();
    const mess = db.mess.find((m) => m.mess_id === messId);
    if (!mess) throw new ApiClientError(404, 'Mess not found');
    const member = mess.mess_team?.find((t) => t.user_id === staff.paradox_id);
    if (!member) throw new ApiClientError(403, 'Not authorized to scan for this mess');
    if (!member.logging) throw new ApiClientError(403, 'Scanning disabled for you');
    const participant = await verifyQr(body);
    if (participant.mess.mess_id !== messId) {
      throw new ApiClientError(400, 'Participant not allotted to this mess');
    }
    const entry = participant.mess.entries[day - 1];
    if (!entry) throw new ApiClientError(400, 'Day entry not found');
    if (!(slot in entry)) throw new ApiClientError(400, 'Slot not found');
    if (entry[slot].logged)
      throw new ApiClientError(400, `Already logged in for ${slot} on day ${day}`);
    entry[slot].logged = true;
    // The only record that this participant ate this meal on this day.
    recordAudit(staff.paradox_id, 'MESS_SCAN', messId, {
      participant_id: participant.participant_id,
      slot,
      day,
    });
    return { message: 'Scan successful, entry allowed' };
  },
  async messStatistics(messId): Promise<MessStatisticsResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const mess = db.mess.find((m) => m.mess_id === messId);
    if (!mess) throw new ApiClientError(404, 'Mess not found');
    const allotted = db.participants.filter((p) => p.mess.mess_id === messId);
    return {
      total_allocated: allotted.length,
      capacity: mess.capacity,
      allotted_participants: allotted.map((p) => ({
        participant_id: p.participant_id,
        name: p.profile.full_name,
        email: p.email,
        phone: p.profile.phone,
      })),
    };
  },

  // ---- hostels ----
  async listHostels(): Promise<Hostel[]> {
    await delay();
    requireAuth();
    return snapshot(db.hostels);
  },
  async createHostel(req: HostelCreateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    db.hostels.push({ ...req, hostel_team: [] });
    recordAudit(currentActor(), 'CREATE_HOSTEL', req.hostel_id, { capacity: req.capacity });
    return { message: 'Hostel created' };
  },
  async assignHostelTeam(hostelId, req: HostelAssignTeamRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const hostel = db.hostels.find((h) => h.hostel_id === hostelId);
    if (!hostel) throw new ApiClientError(404, 'Hostel not found');
    hostel.hostel_team ??= [];
    if (req.user_id && hostel.hostel_team.some((t) => t.user_id === req.user_id)) {
      throw new ApiClientError(409, 'Team member already assigned to this hostel');
    }
    hostel.hostel_team.push({
      user_id: req.user_id ?? null,
      role: req.role,
      name: req.name,
      phone: req.phone,
      logging: req.role === 'other',
    });
    recordAudit(currentActor(), 'ASSIGN_HOSTEL_TEAM', hostelId, {
      team_user_id: req.user_id,
      role: req.role,
    });
    return { message: 'Team member assigned' };
  },
  async toggleHostelScan(hostelId, userId, logging): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const hostel = db.hostels.find((h) => h.hostel_id === hostelId);
    const member = hostel?.hostel_team?.find((t) => t.user_id === userId);
    if (member) member.logging = logging;
    return { message: 'Scanning toggled' };
  },
  async allocateHostels(): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    let allocated = 0;
    for (const p of db.participants) {
      if (!p.accommodation.registered || p.accommodation.hostel_id) continue;
      const gender = (p.profile.gender ?? 'male').toLowerCase();
      const match = db.hostels.find((h) => h.gender.toLowerCase() === gender || h.gender === 'any');
      if (match) {
        p.accommodation.hostel_id = match.hostel_id;
        p.accommodation.room = String(100 + allocated);
        allocated++;
      }
    }
    recordAudit(currentActor(), 'ALLOCATE_HOSTELS', null, { allocated_count: allocated });
    return { message: `Allocated ${allocated} participants` };
  },
  async registerForAccommodation(): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    if (p.accommodation.hostel_id) {
      throw new ApiClientError(400, 'Accommodation already allotted');
    }
    p.accommodation.registered = true;
    recordAudit(p.participant_id, 'ACCOMMODATION_REGISTER', null);
    return { message: 'Accommodation requested' };
  },
  async cancelAccommodationRequest(): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    if (p.accommodation.hostel_id) {
      throw new ApiClientError(400, 'Accommodation already allotted');
    }
    p.accommodation.registered = false;
    recordAudit(p.participant_id, 'ACCOMMODATION_CANCEL', null);
    return { message: 'Accommodation request withdrawn' };
  },
  async myHostel(): Promise<MyHostelResponse> {
    await delay();
    const p = requireParticipant();
    const hostel = p.accommodation.hostel_id
      ? db.hostels.find((h) => h.hostel_id === p.accommodation.hostel_id)
      : undefined;
    return {
      assigned_hostel: p.accommodation.hostel_id,
      room: p.accommodation.room,
      logged_in: p.accommodation.logged_in,
      registered: p.accommodation.registered,
      volunteers: (hostel?.hostel_team ?? []).map((t) => ({
        name: t.name ?? t.role,
        phone: t.phone ?? 'N/A',
      })),
    };
  },
  async scanHostel(hostelId, action, body: ScanQRRequest): Promise<HostelScanResponse> {
    await delay();
    const staff = requireStaff();
    const hostel = db.hostels.find((h) => h.hostel_id === hostelId);
    if (!hostel) throw new ApiClientError(404, 'Hostel not found');
    const member = hostel.hostel_team?.find((t) => t.user_id === staff.paradox_id);
    if (!member) throw new ApiClientError(403, 'Not authorized to scan for this hostel');
    if (!member.logging) throw new ApiClientError(403, 'Scanning disabled for you');
    const participant = await verifyQr(body);
    if (participant.accommodation.hostel_id !== hostelId) {
      throw new ApiClientError(400, 'Participant not allotted to this hostel');
    }
    if (action === 'entry') {
      if (participant.accommodation.logged_in)
        throw new ApiClientError(400, 'Participant is already inside');
      participant.accommodation.logged_in = true;
    } else if (action === 'exit') {
      if (!participant.accommodation.logged_in)
        throw new ApiClientError(400, 'Participant is already outside');
      participant.accommodation.logged_in = false;
    } else {
      throw new ApiClientError(400, "Invalid action. Must be 'entry' or 'exit'");
    }
    // `HOSTEL_ENTRY` / `HOSTEL_EXIT` — the action name is the only thing that
    // distinguishes the two, since the participant only stores a current boolean.
    recordAudit(staff.paradox_id, `HOSTEL_${action.toUpperCase()}`, hostelId, {
      participant_id: participant.participant_id,
    });
    return { message: `Scan successful, ${action} allowed` };
  },
  async hostelStatistics(hostelId): Promise<HostelStatisticsResponse> {
    await delay();
    requireSuperAdmin('Not authorized');
    const hostel = db.hostels.find((h) => h.hostel_id === hostelId);
    if (!hostel) throw new ApiClientError(404, 'Hostel not found');
    const allotted = db.participants.filter((p) => p.accommodation.hostel_id === hostelId);
    return {
      total_allocated: allotted.length,
      capacity: hostel.capacity,
      currently_inside: allotted.filter((p) => p.accommodation.logged_in).length,
      allotted_participants: allotted.map((p) => ({
        participant_id: p.participant_id,
        name: p.profile.full_name,
        email: p.email,
        room: p.accommodation.room,
      })),
    };
  },

  // ---- events ----
  async listEvents(): Promise<Event[]> {
    await delay();
    requireAuth();
    return snapshot(db.events);
  },
  /**
   * The public brochure. No `requireAuth()` — matching `GET /events/public`,
   * which a signed-out visitor must be able to read — and it returns the same
   * published-fields-only projection, so the mock cannot accidentally hand the
   * public pages data the real endpoint withholds.
   */
  async listPublicEvents(): Promise<PublicEventRecord[]> {
    await delay();
    return db.events.map((e) => ({
      event_id: e.event_id,
      event_type: e.event_type,
      name: e.name,
      description: e.description,
      poster: e.poster,
      team: e.team,
      open: e.open,
      prize_money: e.prize_money,
      registration: e.registration,
      schedule: e.schedule,
    }));
  },
  async createEvent(req: EventCreateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can create events');
    db.events.push({
      ...req,
      poster: req.poster ?? '',
      open: true,
      prize_money: req.prize_money ?? [],
      schedule: req.schedule ?? [],
      registration_fields: req.registration_fields ?? [],
      event_team: [],
    });
    recordAudit(currentActor(), 'CREATE_EVENT', req.event_id);
    return { message: 'Event created' };
  },
  async updateEvent(eventId, req: EventUpdateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can edit this event');
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    const changed = Object.entries(req).filter(([, v]) => v !== undefined);
    Object.assign(event, Object.fromEntries(changed));
    recordAudit(currentActor(), 'UPDATE_EVENT', eventId, {
      fields_updated: changed.map(([field]) => field),
    });
    return { message: 'Event updated' };
  },
  async deleteEvent(eventId): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can edit this event');
    const idx = db.events.findIndex((e) => e.event_id === eventId);
    if (idx === -1) throw new ApiClientError(404, 'Event not found');
    db.events.splice(idx, 1);
    for (const p of db.participants) p.events = p.events.filter((r) => r.event_id !== eventId);
    // The event is gone but its trail is not: an audit log that vanished with the
    // thing it describes would be no use to an audit.
    recordAudit(currentActor(), 'DELETE_EVENT', eventId);
    return { message: 'Event deleted' };
  },
  async assignEventTeam(eventId, req: EventTeamAssignRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can assign event teams');
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    event.event_team.push({ user_id: req.user_id, role: req.role });
    recordAudit(currentActor(), 'ASSIGN_EVENT_TEAM', eventId, {
      assigned_user: req.user_id,
      role: req.role,
    });
    return { message: 'Event team assigned' };
  },
  async registerForEvent(eventId, req?: EventRegistrationInput): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    if (!event.open) throw new ApiClientError(400, 'Registration is closed for this event');
    if (p.events.some((r) => r.event_id === eventId)) {
      throw new ApiClientError(409, 'User is already registered for this event.');
    }
    const linkedStaff = db.backendTeams.find((s) => s.admin_id === p.participant_id);
    if (linkedStaff && event.event_team.some((m) => m.user_id === linkedStaff.paradox_id)) {
      throw new ApiClientError(
        403,
        'Event team members cannot register as participants for their own event.',
      );
    }
    p.events.push({
      event_id: eventId,
      team_id: req?.team_name ?? null,
      team_role: req?.team_name ? 'leader' : 'member',
      registration_data: req?.registration_data ?? {},
    });
    // The participant is the actor here, not whoever is administering.
    recordAudit(p.participant_id, 'EVENT_REGISTER', eventId);
    return { message: 'Registered for event successfully.' };
  },
  async editEventRegistration(eventId, req): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    if (!event.open) throw new ApiClientError(400, 'Registration is closed');
    const reg = p.events.find((r) => r.event_id === eventId);
    if (reg) reg.registration_data = req.registration_data ?? {};
    return { message: 'Registration updated' };
  },
  async cancelEventRegistration(eventId): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    if (!event.open) throw new ApiClientError(400, 'Registration is closed');
    p.events = p.events.filter((r) => r.event_id !== eventId);
    recordAudit(p.participant_id, 'EVENT_DEREGISTER', eventId);
    return { message: 'Deregistered successfully' };
  },
  async myEventRegistrations(): Promise<MyEventRegistration[]> {
    await delay();
    if (!currentParticipantId) return [];
    const p = db.participants.find((x) => x.participant_id === currentParticipantId);
    return p?.events ?? [];
  },
  async eventParticipation(eventId): Promise<EventParticipationResponse> {
    await delay();
    const staff = requireStaff();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    const isSuperAdmin = staff.role === 'super_admin';
    const isEventTeam = event.event_team.some((m) => m.user_id === staff.paradox_id);
    const isUhc = staff.department === 'uhc';
    const isDeptAdmin = staff.department === event.event_type;
    if (!isSuperAdmin && !isEventTeam && !isUhc && !isDeptAdmin) {
      throw new ApiClientError(403, 'Not authorized to view participation details');
    }
    let participants: EventParticipant[] = db.participants
      .filter((p) => p.events.some((r) => r.event_id === eventId))
      .map((p) => {
        const reg = p.events.find((r) => r.event_id === eventId)!;
        return {
          participant_id: p.participant_id,
          name: p.profile.full_name,
          email: p.email,
          phone: p.profile.phone,
          house: p.profile.house,
          team_id: reg.team_id,
          team_role: reg.team_role,
        };
      });
    if (isUhc && !isSuperAdmin && !isEventTeam) {
      const house = staff.email.includes('-') ? staff.email.split('-')[0].toLowerCase() : null;
      participants = house ? participants.filter((p) => p.house?.toLowerCase() === house) : [];
    }
    const eventTeamDetails = event.event_team.map((m) => {
      const s = db.backendTeams.find((x) => x.paradox_id === m.user_id);
      return { user_id: m.user_id, role: m.role, name: s?.designation ?? m.role, phone: '' };
    });
    const response: EventParticipationResponse = {
      count: participants.length,
      participants,
      event_team: eventTeamDetails,
    };
    if (!isUhc) {
      response.total_daily_scans = db.eventLogs.filter(
        (l) => l.event_id === eventId && l.day === today(),
      ).length;
    }
    return response;
  },
  async allocateEventTeams(eventId): Promise<MessageResponse> {
    await delay();
    const staff = requireStaff();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    const isEventHead = event.event_team.some(
      (m) => m.user_id === staff.paradox_id && m.role === 'event_head',
    );
    if (!isEventHead)
      throw new ApiClientError(403, 'Only Event Heads are authorized to allocate teams');
    if (event.team.max <= 1) return { message: 'Not a team event' };
    const unteamed = db.participants.filter((p) => {
      const reg = p.events.find((r) => r.event_id === eventId);
      return reg && !reg.team_id;
    });
    let created = 0;
    for (let i = 0; i < unteamed.length; i += event.team.max) {
      const chunk = unteamed.slice(i, i + event.team.max);
      if (chunk.length < event.team.min) continue;
      const teamId = `TE_MX_${Date.now()}_${created}`;
      for (const p of chunk) {
        const reg = p.events.find((r) => r.event_id === eventId)!;
        reg.team_id = teamId;
        reg.team_role = 'member';
      }
      created++;
    }
    recordAudit(currentActor(), 'ALLOCATE_EVENT_TEAMS', eventId, { teams_created: created });
    return { message: `Allocated ${created} teams` };
  },
  async updateParticipantTeam(
    eventId,
    participantId,
    req: ParticipantTeamUpdateRequest,
  ): Promise<MessageResponse> {
    await delay();
    const staff = requireStaff();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    const isEventHead = event.event_team.some(
      (m) => m.user_id === staff.paradox_id && m.role === 'event_head',
    );
    if (!isEventHead)
      throw new ApiClientError(403, 'Only Event Heads are authorized to modify participant teams');
    const p = db.participants.find((x) => x.participant_id === participantId);
    const reg = p?.events.find((r) => r.event_id === eventId);
    if (!reg) throw new ApiClientError(404, 'Participant not registered for this event');
    if (req.team_id !== undefined) reg.team_id = req.team_id;
    if (req.team_role !== undefined)
      reg.team_role = req.team_role as MyEventRegistration['team_role'];
    return { message: 'Participant team updated' };
  },
  async scanEvent(eventId, body: ScanQRRequest): Promise<EventScanResponse> {
    await delay();
    const staff = requireStaff();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    if (!event.event_team.some((m) => m.user_id === staff.paradox_id)) {
      throw new ApiClientError(403, 'Not authorized to scan for this event');
    }
    const participant = await verifyQr(body);
    const isParticipating = participant.events.some((r) => r.event_id === eventId);
    if (isParticipating) {
      const day = today();
      const already = db.eventLogs.some(
        (l) =>
          l.event_id === eventId &&
          l.participant_id === participant.participant_id &&
          l.scanned_by === staff.paradox_id &&
          l.day === day,
      );
      if (!already) {
        db.eventLogs.push({
          event_id: eventId,
          participant_id: participant.participant_id,
          scanned_by: staff.paradox_id,
          day,
          timestamp: now(),
        });
      }
    }
    return {
      name: participant.profile.full_name,
      email: participant.email,
      is_participating: isParticipating,
    };
  },
  async myDailyEventScans(eventId): Promise<{ daily_unique_scans: number }> {
    await delay();
    const staff = requireStaff();
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event || !event.event_team.some((m) => m.user_id === staff.paradox_id)) {
      throw new ApiClientError(403, 'Not authorized');
    }
    const count = db.eventLogs.filter(
      (l) => l.event_id === eventId && l.scanned_by === staff.paradox_id && l.day === today(),
    ).length;
    return { daily_unique_scans: count };
  },
  async eventLogs(eventId): Promise<EventLogsResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can view logs');
    const event = db.events.find((e) => e.event_id === eventId);
    if (!event) throw new ApiClientError(404, 'Event not found');
    return {
      logs: snapshot(
        db.eventLogs
          .filter((l) => l.event_id === eventId)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      ),
    };
  },

  // ---- workshops ----
  /**
   * Deliberately does NOT call `requireAuth()` — this mirrors
   * `GET /workshops/public`, which a signed-out visitor must be able to read.
   * Returns the same published-fields-only projection as the real endpoint, so
   * the mock cannot hand the public pages data the backend withholds.
   */
  async listPublicWorkshops(): Promise<PublicWorkshopRecord[]> {
    await delay();
    return db.workshops.map((w) => ({
      workshop_id: w.workshop_id,
      slot_id: w.slot_id,
      name: w.name,
      venue: w.venue,
      capacity: w.capacity,
      registration_count: w.registration_count,
      instructions: w.instructions,
    }));
  },
  async listWorkshops(): Promise<Workshop[]> {
    await delay();
    requireAuth();
    return stripWorkshopTeamIfNeeded(db.workshops);
  },
  async createWorkshop(req: WorkshopCreateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can create workshops');
    db.workshops.push({ ...req, registration_count: 0, participant_count: 0, workshop_team: [] });
    recordAudit(currentActor(), 'CREATE_WORKSHOP', req.workshop_id, { capacity: req.capacity });
    return { message: 'Workshop created' };
  },
  async updateWorkshop(workshopId, req: WorkshopUpdateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can edit workshops');
    const ws = findWorkshop(workshopId);
    if (!ws) throw new ApiClientError(404, 'Workshop not found');
    Object.assign(ws, Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined)));
    // The backend records no details for this one, so neither does the mock.
    recordAudit(currentActor(), 'UPDATE_WORKSHOP', ws.workshop_id);
    return { message: 'Workshop updated' };
  },
  async deleteWorkshop(workshopId): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can delete workshops');
    const idx = db.workshops.findIndex((w) => w.workshop_id === workshopId);
    if (idx === -1) throw new ApiClientError(404, 'Workshop not found');
    db.workshops.splice(idx, 1);
    for (const p of db.participants)
      p.workshops = p.workshops.filter((w) => w.workshop_id !== workshopId);
    recordAudit(currentActor(), 'DELETE_WORKSHOP', workshopId);
    return { message: 'Workshop deleted' };
  },
  async assignWorkshopVolunteer(
    workshopId,
    req: WorkshopAssignVolunteerRequest,
  ): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can assign volunteers');
    const ws = findWorkshop(workshopId);
    if (!ws) throw new ApiClientError(404, 'Workshop not found');
    ws.workshop_team ??= [];
    ws.workshop_team.push({
      user_id: req.user_id,
      role: req.role ?? 'workshop_volunteer',
      attendance: req.attendance ?? true,
    });
    return { message: 'Volunteer assigned' };
  },
  async toggleWorkshopScan(workshopId, userId, attendance): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can toggle scanning');
    const ws = findWorkshop(workshopId);
    const member = ws?.workshop_team?.find((v) => v.user_id === userId);
    if (member) member.attendance = attendance;
    return { message: 'Volunteer scanning toggled' };
  },
  async myWorkshopRegistrations(): Promise<MyWorkshopRegistration[]> {
    await delay();
    if (!currentParticipantId) return [];
    const p = db.participants.find((x) => x.participant_id === currentParticipantId);
    return (p?.workshops ?? []).map((entry) => {
      const ws = db.workshops.find((w) => w.workshop_id === entry.workshop_id);
      return {
        workshop_id: ws?.workshop_id ?? null,
        slot_id: entry.slot_id,
        name: ws?.name ?? null,
        venue: ws?.venue ?? null,
        booking_type: entry.booking_type,
        attended: entry.attended,
      };
    });
  },
  async workshopLogs(workshopId): Promise<WorkshopLogsResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can view logs');
    const ws = findWorkshop(workshopId);
    if (!ws) throw new ApiClientError(404, 'Workshop not found');
    // This used to always return an empty list, so the log view had nothing to
    // render no matter how many bookings or scans had happened.
    return {
      logs: snapshot(
        db.workshopLogs
          .filter((l) => l.workshop_id === ws.workshop_id)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      ),
    };
  },
  async registerForWorkshop(workshopId): Promise<MessageResponse> {
    await delay();
    const p = requireParticipant();
    const ws = findWorkshop(workshopId);
    if (!ws) throw new ApiClientError(404, 'Workshop not found');
    if (ws.registration_count >= ws.capacity) throw new ApiClientError(400, 'Workshop is full');
    if (p.workshops.some((w) => w.workshop_id === ws.workshop_id)) {
      throw new ApiClientError(400, 'Already registered for this workshop');
    }
    if (p.workshops.some((w) => w.slot_id === ws.slot_id)) {
      throw new ApiClientError(400, 'Already registered for another workshop in this time slot');
    }
    ws.registration_count += 1;
    p.workshops.push({
      slot_id: ws.slot_id,
      booking_type: 'pre-registered',
      workshop_id: ws.workshop_id,
      attended: false,
    });
    db.workshopLogs.push({
      workshop_id: ws.workshop_id,
      action: 'registration',
      participant_id: p.participant_id,
      timestamp: now(),
    });
    return { message: 'Successfully registered for workshop' };
  },
  async workshopAttendance(workshopId, scanType, body: ScanQRRequest): Promise<MessageResponse> {
    await delay();
    const staff = requireStaff();
    const ws = findWorkshop(workshopId);
    if (!ws) throw new ApiClientError(404, 'Workshop not found');
    const member = ws.workshop_team?.find((v) => v.user_id === staff.paradox_id);
    if (!member) throw new ApiClientError(403, 'Not authorized to scan for this workshop');
    if (!member.attendance) throw new ApiClientError(403, 'Scanning disabled for this volunteer');
    const participant = await verifyQr(body);

    if (
      participant.workshops.some(
        (w) => w.attended && w.slot_id === ws.slot_id && w.workshop_id !== ws.workshop_id,
      )
    ) {
      throw new ApiClientError(
        400,
        'Participant already marked present for another workshop in this slot',
      );
    }

    if (scanType === 'pre-registered') {
      const existing = participant.workshops.find(
        (w) => w.workshop_id === ws.workshop_id && w.booking_type !== 'on-spot',
      );
      if (!existing)
        throw new ApiClientError(400, 'Participant not pre-registered for this workshop');
      if (existing.attended) return { message: 'Attendee already marked present' };
      existing.attended = true;
      ws.participant_count += 1;
      db.workshopLogs.push({
        workshop_id: ws.workshop_id,
        action: 'attendance',
        scan_type: 'pre-registered',
        participant_id: participant.participant_id,
        scanned_by: staff.paradox_id,
        timestamp: now(),
      });
      return { message: 'Pre-registered attendee marked present' };
    }
    if (scanType === 'on-spot') {
      const existingForWs = participant.workshops.find((w) => w.workshop_id === ws.workshop_id);
      if (existingForWs?.attended) return { message: 'Attendee already marked present' };
      const maxOnSpot = Math.floor(ws.capacity * 0.1);
      const currentOnSpot = db.participants.filter((p) =>
        p.workshops.some((w) => w.workshop_id === ws.workshop_id && w.booking_type === 'on-spot'),
      ).length;
      if (currentOnSpot >= maxOnSpot)
        throw new ApiClientError(400, 'Max on-spot capacity (10%) reached');
      participant.workshops = participant.workshops.filter((w) => w.slot_id !== ws.slot_id);
      participant.workshops.push({
        slot_id: ws.slot_id,
        booking_type: 'on-spot',
        workshop_id: ws.workshop_id,
        attended: true,
      });
      ws.registration_count += 1;
      ws.participant_count += 1;
      db.workshopLogs.push({
        workshop_id: ws.workshop_id,
        action: 'attendance',
        scan_type: 'on-spot',
        participant_id: participant.participant_id,
        scanned_by: staff.paradox_id,
        timestamp: now(),
      });
      return { message: 'On-spot registration successful and marked present' };
    }
    throw new ApiClientError(400, 'Invalid scan_type');
  },

  // ---- backend teams ----
  async listBackendTeams(): Promise<BackendTeamMember[]> {
    await delay();
    requireSuperAdmin('Only Super Admins can view backend teams');
    return db.backendTeams.map(({ password: _password, ...rest }) => rest);
  },
  async createBackendTeam(req: BackendTeamCreateRequest): Promise<BackendTeamCreateResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can manage backend teams');
    if (db.backendTeams.some((s) => s.email.toLowerCase() === req.email.toLowerCase())) {
      throw new ApiClientError(400, 'Email already registered in backend teams');
    }
    const paradox_id = `BT${Date.now()}`;
    const linkedParticipant = db.participants.find(
      (p) => p.email.toLowerCase() === req.email.toLowerCase(),
    );
    db.backendTeams.push({
      paradox_id,
      email: req.email,
      password: req.password,
      role: req.role,
      department: req.department,
      designation: req.designation,
      admin_id: linkedParticipant?.participant_id ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { message: 'Backend team member created', paradox_id };
  },
  async updateBackendTeam(paradoxId, req: BackendTeamUpdateRequest): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can manage backend teams');
    const s = db.backendTeams.find((x) => x.paradox_id === paradoxId);
    if (s)
      Object.assign(s, Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined)));
    return { message: 'Backend team updated successfully' };
  },
  async deleteBackendTeam(paradoxId): Promise<MessageResponse> {
    await delay();
    requireSuperAdmin('Only Super Admins can manage backend teams');
    db.backendTeams = db.backendTeams.filter((x) => x.paradox_id !== paradoxId);
    return { message: 'Backend team deleted' };
  },

  // ---- participants ----
  /**
   * Mirrors `backend/routers/participants.py` field for field, including the
   * detail that the `by_*` splits only count participants who completed a
   * profile — the seed deliberately contains one account that never did, so a
   * test that assumed `by_house` totals `total_registered` would fail here
   * exactly as it would against the real backend.
   */
  async participantStatistics(): Promise<ParticipantStatisticsResponse> {
    await delay();
    requireSuperAdmin('Not authorized');

    const byHouse: Record<string, number> = {};
    const byProgram: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    const byGender: Record<string, number> = {};
    const signups: Record<string, number> = {};
    const bump = (into: Record<string, number>, key: string | null | undefined) => {
      if (key) into[key] = (into[key] ?? 0) + 1;
    };

    let profileComplete = 0;
    let messRegistered = 0;
    let messAllotted = 0;
    let hostelRegistered = 0;
    let hostelAllotted = 0;
    let onCampus = 0;
    let withEvents = 0;
    let withWorkshops = 0;

    for (const p of db.participants) {
      if (p.profile.full_name) profileComplete += 1;
      bump(byHouse, p.profile.house);
      bump(byProgram, p.profile.program);
      bump(byStage, p.profile.course_stage);
      bump(byGender, p.profile.gender);

      if (p.mess.registered) messRegistered += 1;
      if (p.mess.mess_id) messAllotted += 1;
      if (p.accommodation.registered) hostelRegistered += 1;
      if (p.accommodation.hostel_id) hostelAllotted += 1;
      if (p.accommodation.logged_in) onCampus += 1;
      if (p.events.length > 0) withEvents += 1;
      if (p.workshops.length > 0) withWorkshops += 1;

      bump(signups, p.created_at.slice(0, 10));
    }

    return {
      total_registered: db.participants.length,
      profile_complete: profileComplete,
      profile_incomplete: db.participants.length - profileComplete,
      mess_registered: messRegistered,
      mess_allotted: messAllotted,
      hostel_registered: hostelRegistered,
      hostel_allotted: hostelAllotted,
      hostel_pending: Math.max(0, hostelRegistered - hostelAllotted),
      currently_on_campus: onCampus,
      with_event_registrations: withEvents,
      with_workshop_registrations: withWorkshops,
      by_house: byHouse,
      by_program: byProgram,
      by_course_stage: byStage,
      by_gender: byGender,
      // Sorted here for the same reason the backend sorts: the client renders it
      // as a trend and should not have to trust insertion order.
      signups_by_day: Object.fromEntries(
        Object.entries(signups).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };
  },

  // ---- audit ----
  async auditLogs(limit = 100, filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
    await delay();
    requireSuperAdmin('Only Super Admins can view audit logs');
    // Filter before the limit, exactly as Mongo does: applying `limit` first would
    // drop an entity's older entries before they could ever be matched.
    return snapshot(
      db.auditLogs
        .filter((l) => filter.target_id === undefined || l.target_id === filter.target_id)
        .filter((l) => filter.action === undefined || l.action === filter.action)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit),
    );
  },
};

/** Test-only escape hatch to reset module-level session/db state between test files. */
export function __resetMockApiForTests(): void {
  currentParticipantId = null;
  currentStaffId = null;
  db.participants = seedParticipants();
  db.backendTeams = seedBackendTeams();
  db.mess = seedMess();
  db.hostels = seedHostels();
  db.events = seedEvents();
  db.workshops = seedWorkshops();
  db.auditLogs = seedAuditLogs();
  db.eventLogs = seedEventLogs();
  db.workshopLogs = seedWorkshopLogs();
  keypairs.clear();
}
