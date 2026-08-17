import { Link } from 'react-router-dom';
import { ArrowRight, LogIn } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';

/**
 * Booking call-to-action on a public workshop page.
 *
 * The public flyers are static artwork with no backend `workshop_id` behind
 * them, so booking always happens in the app shell, where live seat counts and
 * the one-per-shift rule are enforced against the real API.
 */
export function WorkshopBookingAction() {
  const session = useAuthStore((s) => s.session);

  if (session === null) {
    return (
      <Link
        to={ROUTES.login}
        className="tap inline-flex w-fit items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
      >
        <LogIn size={16} strokeWidth={2.25} />
        Sign in to book
      </Link>
    );
  }

  if (session.token_type === 'staff') {
    return (
      <p className="text-sm text-muted">
        You are signed in as staff.{' '}
        <Link to={ROUTES.staffHome} className="font-semibold text-brand hover:underline">
          Open the staff dashboard
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Link
        to={ROUTES.workshops}
        className="tap inline-flex w-fit items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
      >
        Book in the app
        <ArrowRight size={16} strokeWidth={2.25} />
      </Link>
      <p className="text-xs text-muted">
        Opens the live workshop list with seat counts updating in real time.
      </p>
    </div>
  );
}
