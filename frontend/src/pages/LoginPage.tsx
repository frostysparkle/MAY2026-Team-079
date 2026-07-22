import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import { env } from '@/config/env';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { PORTAL_LABELS, type Portal } from '@/features/auth/portal';
import { GoogleSignInButton } from '@/features/auth/GoogleSignInButton';
import { Button, ResultBanner, TextInput } from '@/components/ui';

/** Seed accounts surfaced in the mock dev sign-in for quick testing. */
const MOCK_ACCOUNTS = [
  'student@mg.study.iitm.ac.in',
  'organizer@ee.study.iitm.ac.in',
  'admin@es.study.iitm.ac.in',
  'superadmin@ds.study.iitm.ac.in',
];

/**
 * Registration / login via Google Sign-in. There is no email+password form.
 * The domain check and "already registered" handling are surfaced from the API
 * response. Real Google OAuth needs a client ID; in mock mode we provide a dev
 * sign-in that stands in for the Google account chooser.
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
      navigate(postLoginRoute(session.participant), { replace: true });
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

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <button
          type="button"
          onClick={() => navigate(ROUTES.splash)}
          className="text-sm text-muted hover:text-brand"
        >
          ← Back
        </button>
        <h1 className="mt-3 text-xl font-bold text-gray-900">{PORTAL_LABELS[portal]}</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in with your IITM Google account. Your access is verified after sign-in.
        </p>
      </div>

      {error && (
        <ResultBanner variant="error" title="Sign-in failed">
          {error}
        </ResultBanner>
      )}

      {env.useMockApi ? (
        <div className="flex flex-col gap-4 rounded-xl border border-dashed border-line p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Dev sign-in (mock)
          </p>
          <div className="flex flex-col gap-2">
            {MOCK_ACCOUNTS.map((email) => (
              <Button
                key={email}
                variant="secondary"
                fullWidth
                loading={loading}
                onClick={() => signIn(email)}
              >
                {email}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <TextInput
              label="Or any IITM email"
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
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <GoogleSignInButton onCredential={(cred) => void signIn(cred)} onError={setError} />
          {loading && <p className="text-center text-sm text-muted">Signing in…</p>}
        </div>
      )}
    </main>
  );
}
