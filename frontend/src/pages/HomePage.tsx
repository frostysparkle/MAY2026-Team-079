import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { useAuthStore, hasRoleAtLeast } from '@/stores/authStore';
import { ROLE_LABELS } from '@/config/constants';
import { Card } from '@/components/ui';

/** Participant home/dashboard: a greeting hero, quick-access tiles, and a
 *  role-gated management hub. */
export default function HomePage() {
  const participant = useAuthStore((s) => s.participant);
  const firstName = participant?.fullName?.split(' ')[0] || 'there';
  const canOrganize = hasRoleAtLeast('organizer');
  const canAdmin = hasRoleAtLeast('admin');

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Greeting hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-lift">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-accent/30"
        />
        <div className="relative">
          <p className="text-sm text-white/80">Welcome back</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight">Hi, {firstName} 👋</h1>
          {participant && (
            <span className="mt-3 inline-block rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
              {ROLE_LABELS[participant.role]}
            </span>
          )}
        </div>
      </div>

      {/* Quick access */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Quick access
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <Tile to={ROUTES.myQr} icon="🔳" title="My Digital ID" subtitle="Show at checkpoints" tint="brand" />
          <Tile to={ROUTES.events} icon="📅" title="Events" subtitle="Schedule & venues" tint="violet" />
          <Tile to={ROUTES.mess} icon="🍽️" title="Mess" subtitle="Menu & pass" tint="amber" />
          <Tile to={ROUTES.hostel} icon="🏨" title="Hostel" subtitle="Allocation & check-in" tint="green" />
          <Tile to={ROUTES.announcements} icon="📣" title="Announcements" subtitle="Latest updates" tint="pink" />
          <Tile to={ROUTES.payments} icon="💳" title="Payments" subtitle="Hostel & mess fees" tint="sky" />
          <Tile to={ROUTES.help} icon="🆘" title="Help" subtitle="Queries & contacts" tint="slate" />
          <Tile to={ROUTES.profile} icon="👤" title="Profile" subtitle="Your details" tint="slate" />
        </div>
      </section>

      {(canOrganize || canAdmin) && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Manage</h2>
          <Card className="flex flex-col gap-1 p-2">
            {canAdmin && <ManageRow to={ROUTES.overview} icon="🧭" label="Operations Dashboard" />}
            {canOrganize && <ManageRow to={ROUTES.scanner} icon="📷" label="Scan QR" />}
            {canAdmin && <ManageRow to={ROUTES.dashboard} icon="📊" label="Live Crowd" />}
            {canOrganize && <ManageRow to={ROUTES.events} icon="📅" label="Manage Events" />}
            {canOrganize && <ManageRow to={ROUTES.manageMess} icon="🍽️" label="Manage Mess" />}
            {canAdmin && <ManageRow to={ROUTES.manageHostel} icon="🏨" label="Hostel Allocations" />}
            {canAdmin && <ManageRow to={ROUTES.managePayments} icon="💳" label="Payments" />}
            {canAdmin && <ManageRow to={ROUTES.manageQueries} icon="🗂️" label="Query Triage" />}
            {canAdmin && <ManageRow to={ROUTES.manageContacts} icon="📇" label="Contact Directory" />}
            {canAdmin && <ManageRow to={ROUTES.manageAnnouncements} icon="📣" label="Announcements" />}
            {canAdmin && <ManageRow to={ROUTES.users} icon="👥" label="User Management" />}
          </Card>
        </section>
      )}
    </div>
  );
}

const TINTS: Record<string, string> = {
  brand: 'bg-brand-100 text-brand',
  violet: 'bg-violet-100 text-violet-600',
  amber: 'bg-amber-100 text-amber-600',
  green: 'bg-green-100 text-green-600',
  pink: 'bg-pink-100 text-pink-600',
  sky: 'bg-sky-100 text-sky-600',
  slate: 'bg-slate-100 text-slate-600',
};

function Tile({
  to,
  icon,
  title,
  subtitle,
  tint,
}: {
  to: string;
  icon: string;
  title: string;
  subtitle: string;
  tint: keyof typeof TINTS | string;
}) {
  return (
    <Link to={to} className="block">
      <Card interactive className="flex h-full flex-col gap-2 p-4">
        <span
          aria-hidden
          className={`flex h-11 w-11 items-center justify-center rounded-2xl text-xl ${TINTS[tint] ?? TINTS.slate}`}
        >
          {icon}
        </span>
        <div>
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
      </Card>
    </Link>
  );
}

function ManageRow({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <Link
      to={to}
      className="tap flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2 active:scale-[0.99]"
    >
      <span aria-hidden className="text-lg">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium text-ink">{label}</span>
      <span aria-hidden className="text-muted">
        ›
      </span>
    </Link>
  );
}
