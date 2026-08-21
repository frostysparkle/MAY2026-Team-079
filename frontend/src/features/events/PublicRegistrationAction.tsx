import { Link } from 'react-router-dom';
import { ArrowRight, LogIn } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { useAuthStore } from '@/stores/authStore';
import type { EventView } from './eventView';
import { EventRegistrationForm } from './EventRegistrationForm';

/**
 * Registration call-to-action on an event page.
 *
 * A Super-Admin-created event has a live backend record, so it registers in
 * place — including whatever extra fields the admin configured. A hardcoded
 * catalogue event has no matching `event_id` on the backend, so it hands off to
 * the signed-in catalogue instead; making that hop visible beats a button that
 * silently finds nothing.
 */
export function PublicRegistrationAction({ view }: { view: EventView }) {
  const session = useAuthStore((s) => s.session);

  if (session === null) {
    return (
      <Link
        to={ROUTES.login}
        className="tap inline-flex w-fit items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
      >
        <LogIn size={16} strokeWidth={2.25} />
        Sign in to register
      </Link>
    );
  }

  if (session.token_type === 'staff') {
    return (
      <p className="text-sm text-muted">
        You are signed in as staff.{' '}
        <Link to={ROUTES.staffHome} className="font-semibold text-brand hover:underline">
          Open the staff area
        </Link>
        .
      </p>
    );
  }

  if (!session.full_name) {
    return (
      <Link
        to={ROUTES.completeProfile}
        className="tap inline-flex w-fit items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
      >
        Complete profile to register
        <ArrowRight size={16} strokeWidth={2.25} />
      </Link>
    );
  }

  // Live event → register right here, with the admin's configured fields.
  if (view.source === 'backend' && view.event) {
    return <EventRegistrationForm event={view.event} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Link
        to={ROUTES.events}
        className="tap inline-flex w-fit items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-white shadow-fab hover:bg-brand-dark active:scale-95"
      >
        Register in the app
        <ArrowRight size={16} strokeWidth={2.25} />
      </Link>
      <p className="text-xs text-muted">
        Opens the live catalogue, where you can register for {view.name} and see live seat counts.
      </p>
    </div>
  );
}
