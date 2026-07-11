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
