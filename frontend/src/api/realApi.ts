/**
 * Real backend client. Not exercised in Sprint 1 (no backend yet) but written
 * to the same ApiClient contract so it drops in by flipping VITE_USE_MOCK_API.
 * Endpoint paths are the proposed contract to confirm with the backend dev.
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
} from './types';
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
  return res.json() as Promise<T>;
}

export const realApi: ApiClient = {
  loginWithGoogle: (req: GoogleLoginRequest) =>
    request<GoogleLoginResponse>('/auth/google', { method: 'POST', body: JSON.stringify(req) }),

  completeProfile: (req: CompleteProfileRequest) =>
    request<CompleteProfileResponse>('/profile/complete', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  listUsers: () => request<ListUsersResponse>('/admin/users'),

  assignRole: (req: AssignRoleRequest) =>
    request<AssignRoleResponse>(`/admin/participants/${req.participantId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role: req.role }),
    }),

  provisionSecret: (req: ProvisionSecretRequest) =>
    request<ProvisionSecretResponse>('/qr/provision', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  verifyScan: (req: VerifyScanRequest) =>
    request<VerifyScanResponse>('/scan/verify', { method: 'POST', body: JSON.stringify(req) }),
};
