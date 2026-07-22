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
};
