import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { ROUTES } from '@/config/routes';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { PasswordField, MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '@/features/auth/PasswordField';
import { Button, IconTile, ResultBanner } from '@/components/ui';

/** POST /auth/password/reset — backend always 200s (stub, doesn't verify the token). */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.resetPassword({ token: params.get('token') ?? '', new_password: newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthLayout
        mark={<IconTile icon={ShieldCheck} tone="success" size="lg" />}
        title="Password reset"
      >
        <ResultBanner variant="success" title="All set">
          You can now sign in with your new password.
        </ResultBanner>
        <Button fullWidth onClick={() => navigate(ROUTES.login)}>
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      mark={<IconTile icon={ShieldCheck} size="lg" />}
      title="Reset Password"
      subtitle="Choose a new password for your account."
    >
      {error && (
        <ResultBanner variant="error" title="Could not reset password">
          {error}
        </ResultBanner>
      )}
      <form
        className="relative flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04]"
        onSubmit={submit}
      >
        <PasswordField
          label="New Password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          hint={PASSWORD_HINT}
          value={newPassword}
          onChange={setNewPassword}
        />
        <Button type="submit" fullWidth loading={loading}>
          Reset password
        </Button>
      </form>
    </AuthLayout>
  );
}
