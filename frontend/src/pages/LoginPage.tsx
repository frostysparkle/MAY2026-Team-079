import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import { resolvePostLoginRoute } from '@/features/auth/postLoginRoute';
import { type Portal } from '@/features/auth/portal';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Button, ResultBanner, TextInput } from '@/components/ui';

type Mode = 'login' | 'register';

/** Per-portal heading copy — consistent with the landing's Register/Sign-in language. */
const PORTAL_COPY: Record<Portal, { title: string; subtitle: string }> = {
  student: {
    title: 'Welcome to Paradox',
    subtitle: 'Register or sign in with your email to get your pass.',
  },
  organizer: {
    title: 'Organizer sign-in',
    subtitle: 'Sign in with your email. Access is verified after sign-in.',
  },
  admin: {
    title: 'Admin sign-in',
    subtitle: 'Sign in with your email. Access is verified after sign-in.',
  },
};

/**
 * Email + password registration and login. Wrapped in the shared branded
 * AuthLayout so it carries the same identity as the landing. New registrations
 * are routed to Complete Your Profile via `resolvePostLoginRoute`.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const portal = (location.state as { portal?: Portal } | null)?.portal ?? 'student';
  const setSession = useAuthStore((s) => s.setSession);

  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { session } =
        mode === 'register'
          ? await api.register({ email: email.trim(), password, fullName: fullName.trim() })
          : await api.login({ email: email.trim(), password });
      setSession(session.token, session.participant);
      navigate(await resolvePostLoginRoute(session.participant), { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'email_already_registered') {
          setError('That email is already registered. Try signing in instead.');
        } else if (err.code === 'invalid_credentials') {
          setError('Incorrect email or password.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
  }

  const copy = PORTAL_COPY[portal];
  const isRegister = mode === 'register';

  return (
    <AuthLayout title={copy.title} subtitle={copy.subtitle} onBack={() => navigate(ROUTES.splash)}>
      {error && (
        <ResultBanner variant="error" title={isRegister ? 'Registration failed' : 'Sign-in failed'}>
          {error}
        </ResultBanner>
      )}

      <div className="flex flex-col gap-4 rounded-3xl bg-surface/90 p-6 shadow-lift ring-1 ring-black/[0.04] backdrop-blur">
        <div className="flex rounded-2xl bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              !isRegister ? 'bg-surface text-ink shadow-card' : 'text-muted'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              isRegister ? 'bg-surface text-ink shadow-card' : 'text-muted'
            }`}
          >
            Register
          </button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          {isRegister && (
            <TextInput
              label="Full name"
              type="text"
              placeholder="Your name"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          )}
          <TextInput
            label="Email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextInput
            label="Password"
            type="password"
            placeholder={isRegister ? 'At least 8 characters' : 'Your password'}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={isRegister ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            fullWidth
            loading={loading}
            disabled={!email.trim() || !password}
          >
            {isRegister ? 'Create account' : 'Sign in'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted">
          {isRegister ? 'Already have an account? ' : 'New to Paradox? '}
          <button
            type="button"
            className="font-semibold text-brand hover:underline"
            onClick={() => switchMode(isRegister ? 'login' : 'register')}
          >
            {isRegister ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>

      <p className="text-center text-xs text-muted">
        By continuing you agree to use your identity for fest access.
      </p>
    </AuthLayout>
  );
}
