import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, Home, Lock, Mail, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { ResultBanner, Spinner } from '@/components/ui';

/**
 * Staff / volunteer sign-in — `POST /auth/admin/login`.
 *
 * Shares the participant sign-in card design so the two entry points read as one
 * product, but stays a separate screen because it hits a different backend
 * endpoint and issues a `staff` token rather than a `participant` one. There are
 * no tabs here: staff accounts are provisioned by a Super Admin, never
 * self-registered.
 */

/** Seed account surfaced in the mock dev quick-fill for local testing. */

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const setStaffSession = useAuthStore((s) => s.setStaffSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await api.adminLogin({ email: email.trim(), password });
      setStaffSession(session);
      navigate(postLoginRoute(session), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Could not sign in. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout size="xs" align="top" fit>
      {/* Centred header */}
      <div className="flex flex-col items-center text-center">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white shadow-lift">
          <ShieldCheck size={22} strokeWidth={2} />
        </div>
        <h1 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
          Staff <span className="text-gradient">sign-in</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Use the credentials issued by your Super Admin. Any email domain is accepted.
        </p>
      </div>

      {error && (
        <ResultBanner variant="error" title="Sign-in failed">
          {error}
        </ResultBanner>
      )}

      {/* Card + card-anchored home control */}
      <div className="relative">
        <button
          type="button"
          onClick={() => navigate(ROUTES.splash)}
          aria-label="Back to landing page"
          title="Back to landing page"
          className="tap mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface/90 text-brand shadow-card ring-1 ring-brand/15 backdrop-blur transition hover:bg-brand hover:text-white hover:shadow-fab active:scale-95 sm:absolute sm:-left-[3.75rem] sm:top-3 sm:mb-0"
        >
          <Home size={20} strokeWidth={1.9} />
        </button>

        <div className="rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04] sm:p-5">
          <form className="flex flex-col gap-3" onSubmit={signIn}>
            {/* Email */}
            <div className="flex flex-col gap-1">
              <label htmlFor="staff-email" className="text-sm font-semibold text-ink">
                Email{' '}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="relative">
                <Mail
                  aria-hidden
                  size={20}
                  strokeWidth={1.8}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="staff-email"
                  type="email"
                  placeholder="you@paradox.dev"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-input bg-surface py-2 pl-10 pr-3 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1">
              <label htmlFor="staff-password" className="text-sm font-semibold text-ink">
                Password{' '}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="relative">
                <Lock
                  aria-hidden
                  size={20}
                  strokeWidth={1.8}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  id="staff-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-input bg-surface py-2 pl-10 pr-11 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="tap absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                >
                  {showPassword ? (
                    <EyeOff size={20} strokeWidth={1.8} />
                  ) : (
                    <Eye size={20} strokeWidth={1.8} />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={!email.trim() || !password || loading}
              className="tap group mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-accent py-2.5 text-sm font-semibold text-white shadow-fab transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size={16} />}
              Sign in
              {!loading && (
                <ArrowRight
                  size={16}
                  strokeWidth={2}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              )}
            </button>
          </form>

          <div className="mt-3.5 border-t border-line pt-3 text-center text-sm text-muted">
            Attending as a student?{' '}
            <button
              type="button"
              className="font-semibold text-brand hover:underline"
              onClick={() => navigate(ROUTES.login)}
            >
              Participant sign-in
            </button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
