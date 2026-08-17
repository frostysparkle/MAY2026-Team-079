import { useNavigate } from 'react-router-dom';
import { GraduationCap, ShieldCheck } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { AuroraBackdrop, Button } from '@/components/ui';

/**
 * Splash / entry landing. The backend has exactly two logins with different
 * response shapes (participant vs staff) — this picker routes straight to
 * the matching page. No portal state is carried; the real role is always
 * resolved server-side after sign-in.
 */
export default function SplashPage() {
  const navigate = useNavigate();

  return (
    <main className="relative mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-8 overflow-hidden p-6">
      <AuroraBackdrop />

      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-2xl font-bold text-white shadow-fab">
          P
        </div>
        <div>
          <h1 className="text-gradient text-3xl font-black tracking-tight">Paradox Connect</h1>
          <p className="mt-1.5 text-sm text-muted">One platform for the Paradox fest</p>
        </div>
      </div>

      <div className="relative flex w-full flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          className="justify-start gap-3 pl-4"
          onClick={() => navigate(ROUTES.login)}
        >
          <GraduationCap size={20} strokeWidth={2} />
          I&apos;m a Participant
        </Button>
        <Button
          size="lg"
          fullWidth
          variant="secondary"
          className="justify-start gap-3 pl-4"
          onClick={() => navigate(ROUTES.adminLogin)}
        >
          <ShieldCheck size={20} strokeWidth={2} />
          I&apos;m Staff / Volunteer
        </Button>
      </div>

      <p className="relative max-w-xs text-center text-xs text-muted">
        Participants sign in with their IITM email. Staff and volunteers use the credentials issued
        by a Super Admin.
      </p>
    </main>
  );
}
