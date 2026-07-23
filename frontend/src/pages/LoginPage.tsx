import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import { env } from '@/config/env';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { resolvePostLoginRoute } from '@/features/auth/postLoginRoute';
import { type Portal } from '@/features/auth/portal';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { GoogleSignInButton } from '@/features/auth/GoogleSignInButton';
import { Button, ResultBanner, TextInput } from '@/components/ui';

/** Seed accounts surfaced in the mock dev sign-in for quick testing. */
const MOCK_ACCOUNTS = [
  { email: 'student@mg.study.iitm.ac.in', label: 'Student' },
  { email: 'organizer@ee.study.iitm.ac.in', label: 'Organizer' },
  { email: 'admin@es.study.iitm.ac.in', label: 'Admin' },
  { email: 'superadmin@ds.study.iitm.ac.in', label: 'Super Admin' },
];

/** Per-portal heading copy — consistent with the landing's Register/Sign-in language. */
const PORTAL_COPY: Record<Portal, { title: string; subtitle: string }> = {
  student: {
    title: 'Welcome to Paradox',
    subtitle: 'Register or sign in with your IITM college email to get your pass.',
  },
  organizer: {
    title: 'Organizer sign-in',
    subtitle: 'Sign in with your IITM account. Access is verified after sign-in.',
  },
  admin: {
    title: 'Admin sign-in',
    subtitle: 'Sign in with your IITM account. Access is verified after sign-in.',
  },
};

/**
 * Registration / login via Google Sign-in — no email+password form. Wrapped in
 * the shared branded AuthLayout so it carries the same identity as the landing.
 * The domain check and "already registered" handling are surfaced from the API.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const portal = (location.state as { portal?: Portal } | null)?.portal ?? 'student';
  const setSession = useAuthStore((s) => s.setSession);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockEmail, setMockEmail] = useState('');

  async function signIn(idToken: string) {
    setError(null);
    setLoading(true);
    try {
      const { session } = await api.loginWithGoogle({ idToken });
      setSession(session.token, session.participant);
      navigate(await resolvePostLoginRoute(session.participant), { replace: true });
    } catch (e) {
      if (e instanceof ApiClientError) {
        // Distinct, specific messages for the expected rejections. Covers both
        // the mock codes and the real backend codes (docs/api-contract.md).
        if (e.code === 'invalid_domain' || e.code === 'google_account_not_allowed') {
          setError('That is not a valid IITM email. Please use your @*.study.iitm.ac.in account.');
        } else if (e.code === 'already_registered' || e.code === 'identity_conflict') {
          setError('This Google account is already registered. Try signing in again.');
        } else {
          setError(e.message);
        }
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  const copy = PORTAL_COPY[portal];

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle} onBack={() => navigate(ROUTES.splash)}>
      {error && (
        <ResultBanner variant="error" title="Sign-in failed">
          {error}
        </ResultBanner>
      )}

      <div className="flex flex-col gap-4 rounded-3xl bg-surface/90 p-6 shadow-lift ring-1 ring-black/[0.04] backdrop-blur">
        {env.useMockApi ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-bold text-ink">Continue with Google</p>
              <p className="text-xs text-muted">
                Verified against your college domain. Only IITM emails are allowed.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {MOCK_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  disabled={loading}
                  onClick={() => signIn(acct.email)}
                  className="tap flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left hover:-translate-y-0.5 hover:shadow-card active:scale-[0.99] disabled:opacity-50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand">
                      {acct.label[0]}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{acct.label}</span>
                      <span className="block truncate text-xs text-muted">{acct.email}</span>
                    </span>
                  </span>
                  <span aria-hidden className="text-muted">
                    →
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs font-medium text-muted">or any IITM email</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <div className="flex flex-col gap-2">
              <TextInput
                label="College email"
                type="email"
                placeholder="you@ds.study.iitm.ac.in"
                value={mockEmail}
                onChange={(e) => setMockEmail(e.target.value)}
              />
              <Button
                fullWidth
                loading={loading}
                disabled={!mockEmail.trim()}
                onClick={() => signIn(mockEmail.trim())}
              >
                Continue
              </Button>
            </div>

            <p className="rounded-xl bg-surface-2 px-3 py-2 text-center text-[11px] font-medium text-muted">
              Dev sign-in (mock) — stands in for the Google account chooser.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-full">
              <p className="text-sm font-bold text-ink">Continue with Google</p>
              <p className="mt-0.5 text-xs text-muted">
                Verified against your college domain. Only IITM emails are allowed.
              </p>
            </div>
            <GoogleSignInButton onCredential={(cred) => void signIn(cred)} onError={setError} />
            {loading && <p className="text-center text-sm text-muted">Signing in…</p>}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted">
        By continuing you agree to use your verified IITM identity for fest access.
      </p>
    </AuthLayout>
  );
}
