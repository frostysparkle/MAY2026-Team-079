import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRoute } from '@/features/auth/postLoginRoute';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { MIN_PASSWORD_LENGTH } from '@/features/auth/PasswordField';
import { ImpossibleTriangle } from '@/features/landing/ParadoxHeadline';
import { ResultBanner, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Email + password sign-in and registration on one screen: a centred
 * "Welcome to Paradox" header, a card with Sign in / Register tabs,
 * icon-prefixed inputs, a password reveal toggle, and a gradient primary action.
 *
 * Only participants sign in here (`POST /auth/login` / `POST /auth/register`).
 * Staff and volunteers authenticate against a different backend endpoint and
 * have their own screen at `/admin/login`, reachable from the public menu.
 *
 * The initial tab comes from navigation state — `navigate('/login', { state: {
 * mode: 'register' } })` — or from the `/register` route, which renders this
 * same component. A bare visit to `/login` opens on sign-in.
 */

type Mode = 'login' | 'register';

/** Seed account surfaced in the mock dev quick-fill for local testing. */

const FORM_ID = 'auth-form';

/* --------------------------------------------------------------- icons --- */

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="m4 7 8 6 8-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect
        x="4.5"
        y="10"
        width="15"
        height="10"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M9.5 5.8A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.6M6.4 6.5A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 3.3-.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M9.9 9.9a3 3 0 0 0 4.2 4.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 19a6.5 6.5 0 0 1 13 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function UserPlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="9.5" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3.5 19a6 6 0 0 1 12 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M19 8v6m3-3h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M5 12h14m0 0-5-5m5 5-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="m3.5 11 8.5-7 8.5 7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 10v9.5h13V10M9.5 19.5v-5h5v5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ----------------------------------------------------------------- page --- */

export default function LoginPage({ initialMode }: { initialMode?: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const setParticipantSession = useAuthStore((s) => s.setParticipantSession);

  const navState = location.state as { mode?: Mode } | null;

  const [mode, setMode] = useState<Mode>(initialMode ?? navState?.mode ?? 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  const isRegister = mode === 'register';

  /** Switching tabs clears the error and password but keeps the email typed. */
  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setShowPassword(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isRegister) {
        // The backend does not return a session on register — it requires an
        // explicit sign-in afterwards, so drop the user onto the Sign in tab.
        await api.register({ email: email.trim(), password });
        setRegistered(true);
        switchMode('login');
      } else {
        const session = await api.login({ email: email.trim(), password });
        setParticipantSession(session);
        navigate(postLoginRoute(session), { replace: true });
      }
    } catch (err) {
      const fallback = isRegister
        ? 'Could not register. Please try again.'
        : 'Could not sign in. Please try again.';
      setError(err instanceof ApiClientError ? err.message : fallback);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout size="xs" align="top" fit>
      {/* Centred header */}
      <div className="flex flex-col items-center text-center">
        <ImpossibleTriangle className="mb-1.5 h-9 w-9 opacity-80" />
        <h1 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
          {isRegister ? 'Join ' : 'Welcome to '}
          <span className="text-gradient">Paradox</span>
        </h1>
        {isRegister && (
          <p className="mt-1 text-sm text-muted">Create your account to get started</p>
        )}
      </div>

      {registered && !isRegister && (
        <ResultBanner variant="success" title="Account created">
          Sign in with your new password.
        </ResultBanner>
      )}

      {error && (
        <ResultBanner variant="error" title={isRegister ? 'Registration failed' : 'Sign-in failed'}>
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
          <HomeIcon className="h-5 w-5" />
        </button>

        <div className="rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04] sm:p-5">
          {/* Tabs. A real tablist, not two buttons: the "Sign in" tab and the
              "Sign in" submit button would otherwise share one accessible name,
              leaving screen-reader and keyboard users unable to tell them apart. */}
          <div role="tablist" aria-label="Account" className="flex rounded-full bg-surface-2 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={!isRegister}
              aria-controls={FORM_ID}
              onClick={() => switchMode('login')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                !isRegister ? 'bg-surface text-brand shadow-card' : 'text-muted hover:text-ink',
              )}
            >
              <UserIcon className="h-4 w-4" />
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRegister}
              aria-controls={FORM_ID}
              onClick={() => switchMode('register')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                isRegister ? 'bg-surface text-brand shadow-card' : 'text-muted hover:text-ink',
              )}
            >
              <UserPlusIcon className="h-4 w-4" />
              Register
            </button>
          </div>

          <form
            id={FORM_ID}
            role="tabpanel"
            className="mt-3.5 flex flex-col gap-3"
            onSubmit={submit}
          >
            {/* Email */}
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-sm font-semibold text-ink">
                Email{' '}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
                  <MailIcon className="h-5 w-5" />
                </span>
                <input
                  id="email"
                  type="email"
                  placeholder="example@ds.study.iitm.ac.in"
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
              <label htmlFor="password" className="text-sm font-semibold text-ink">
                Password{' '}
                <span className="text-danger" aria-hidden>
                  *
                </span>
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">
                  <LockIcon className="h-5 w-5" />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={
                    isRegister ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'
                  }
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  required
                  minLength={isRegister ? MIN_PASSWORD_LENGTH : undefined}
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
                    <EyeOffIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            {/* Password recovery */}
            {!isRegister && (
              <div className="flex justify-end">
                <Link
                  to={ROUTES.forgotPassword}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!email.trim() || !password || loading}
              className="tap group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-accent py-2.5 text-sm font-semibold text-white shadow-fab transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && <Spinner size={16} />}
              {isRegister ? 'Create account' : 'Sign in'}
              {!loading && (
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-3.5 border-t border-line pt-3 text-center text-sm text-muted">
            {isRegister ? 'Already have an account? ' : 'New to Paradox? '}
            <button
              type="button"
              className="font-semibold text-brand hover:underline"
              onClick={() => switchMode(isRegister ? 'login' : 'register')}
            >
              {isRegister ? 'Sign in' : 'Create one'}
            </button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
