import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import { currentParticipant, currentStaff, useAuthStore } from '@/stores/authStore';
import { PasswordField, MIN_PASSWORD_LENGTH, PASSWORD_HINT } from '@/features/auth/PasswordField';
import { Button, ResultBanner, SectionHeading } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

/**
 * POST /auth/password/change — works for either token type; response rotates the
 * access token.
 *
 * Reached from both the participant area (`/app/profile/change-password`) and the
 * staff one (`/staff/change-password`), which is why the eyebrow is derived rather
 * than fixed: the page belongs to whichever dashboard the caller came from, and
 * everything below the eyebrow is identical either way.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const staff = currentStaff();
  const participant = currentParticipant();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setToken(res.access_token);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not change password.');
    } finally {
      setLoading(false);
    }
  }

  const eyebrow = staff ? (staff.designation ?? 'Staff') : (participant?.house ?? 'Participant');

  return (
    <FestivalScreen
      title="Password"
      eyebrow={eyebrow}
      subtitle="Changing this signs your other devices out."
      width="md"
      // `navigate(-1)` rather than a fixed route: the two dashboards reach this
      // page from different places, and either should land back where it started.
      back={{ label: 'Back', onClick: () => navigate(-1) }}
    >
      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        <SectionHeading title="Change Password" />

        {done && (
          <ResultBanner variant="success" title="Password changed">
            Your password has been updated.
          </ResultBanner>
        )}
        {error && (
          <ResultBanner variant="error" title="Could not change password">
            {error}
          </ResultBanner>
        )}

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <PasswordField
            label="Current Password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <PasswordField
            label="New Password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={PASSWORD_HINT}
            value={newPassword}
            onChange={setNewPassword}
          />
          <Button type="submit" fullWidth loading={loading}>
            Change password
          </Button>
        </form>
      </section>
    </FestivalScreen>
  );
}
