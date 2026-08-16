import { useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { api } from '@/api';
import { ROUTES } from '@/config/routes';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Button, IconTile, ResultBanner, TextInput } from '@/components/ui';

/** POST /auth/password/forgot — backend always 200s (stub) and never discloses whether the account exists. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.forgotPassword({ email: email.trim() });
      setMessage(res.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      backTo={ROUTES.login}
      mark={<IconTile icon={KeyRound} size="lg" />}
      title="Forgot Password"
      subtitle="We'll send a reset link to your email."
    >
      {message && (
        <ResultBanner variant="success" title="Request sent">
          {message}
        </ResultBanner>
      )}

      <form
        className="relative flex flex-col gap-4 rounded-3xl bg-surface p-4 shadow-lift ring-1 ring-black/[0.04]"
        onSubmit={submit}
      >
        <TextInput
          label="Email"
          type="email"
          icon={Mail}
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" fullWidth loading={loading}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
