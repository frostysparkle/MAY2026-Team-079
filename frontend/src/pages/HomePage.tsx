import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { Announcement, MyPayments, MyRegistration } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { useAuthStore, hasRoleAtLeast } from '@/stores/authStore';
import { ROLE_LABELS } from '@/config/constants';
import { useJourney } from '@/features/journey/useJourney';
import { stepProgress } from '@/features/journey/steps';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const ANNOUNCE_SEEN_KEY = 'paradox.announcements.lastSeenAt';

function monthAbbr(isoDate: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[Number(isoDate.slice(5, 7)) - 1] ?? '';
}

const PAY_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  created: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  not_started: 'bg-surface-2 text-muted',
};
const PAY_LABEL: Record<string, string> = {
  paid: 'Paid',
  created: 'Pending',
  pending: 'Pending',
  failed: 'Failed',
  not_started: 'Not started',
};

/**
 * Student home/dashboard (spec: student-experience-redesign, Req 8). Surfaces
 * the next thing to do: continue setup while onboarding is incomplete, upcoming
 * event passes, booking/payment status, and the latest announcements — each
 * with its own loading / empty / error / success state.
 */
export default function HomePage() {
  const participant = useAuthStore((s) => s.participant);
  const firstName = participant?.fullName?.split(' ')[0] || 'there';
  const isStaff = hasRoleAtLeast('organizer');

  const { journey } = useJourney();
  const [status, setStatus] = useState<Status>('loading');
  const [regs, setRegs] = useState<MyRegistration[]>([]);
  const [payments, setPayments] = useState<MyPayments | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const [r, p, a] = await Promise.all([
        api.listMyRegistrations(),
        api.getMyPayments(),
        api.listAnnouncements(),
      ]);
      setRegs(
        [...r.registrations].sort((x, y) =>
          `${x.eventDate}${x.startTime}`.localeCompare(`${y.eventDate}${y.startTime}`),
        ),
      );
      setPayments(p);
      setAnnouncements(a.announcements);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const latestAnnounceAt = announcements[0]?.createdAt ?? '';
  const lastSeen = typeof localStorage !== 'undefined' ? localStorage.getItem(ANNOUNCE_SEEN_KEY) : null;
  const hasUnread = Boolean(latestAnnounceAt) && latestAnnounceAt !== lastSeen;

  const markAnnouncementsSeen = () => {
    if (latestAnnounceAt) localStorage.setItem(ANNOUNCE_SEEN_KEY, latestAnnounceAt);
  };

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* Greeting hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-lift">
        <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-accent/30" />
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

      {/* Continue setup — only while onboarding is incomplete. */}
      {journey && !journey.complete && (
        <Link to={ROUTES.onboarding} className="block">
          <Card interactive className="flex items-center gap-3 border-l-4 border-brand">
            <span aria-hidden className="text-2xl">🚀</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">Finish setting up</p>
              <p className="text-xs text-muted">
                Step {stepProgress(journey).current} of {stepProgress(journey).total} · pick up where you left off
              </p>
            </div>
            <span aria-hidden className="text-muted">›</span>
          </Card>
        </Link>
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      {/* My events */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="My events" to={ROUTES.passes} linkLabel="My Pass" />
        {status === 'loading' && <Skeleton className="h-20" />}
        {status === 'error' && (
          <ErrorState description="Could not load your events." onRetry={() => void load()} />
        )}
        {status === 'loaded' && regs.length === 0 && (
          <EmptyState
            title="No events yet"
            description="Register for events to see your passes here."
            icon="🎟️"
            action={
              <Link to={ROUTES.events} className="text-sm font-semibold text-brand hover:underline">
                Browse events
              </Link>
            }
          />
        )}
        {status === 'loaded' &&
          regs.slice(0, 3).map((r) => (
            <Link key={r.eventId} to={ROUTES.eventDetail(r.eventId)} className="block">
              <Card interactive className="flex gap-3">
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-100 text-brand">
                  <span className="text-base font-black leading-none">{r.eventDate.slice(8, 10)}</span>
                  <span className="text-[10px] font-semibold uppercase">{monthAbbr(r.eventDate)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{r.title}</p>
                  <p className="truncate text-xs text-muted">
                    {r.venue} · {r.startTime}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
      </section>

      {/* Bookings & payment status */}
      <section className="flex flex-col gap-3">
        <SectionHeader title="Bookings & payments" to={ROUTES.payments} linkLabel="Manage" />
        {status === 'loading' && <Skeleton className="h-16" />}
        {status === 'loaded' && payments && (
          <Card className="flex flex-col gap-2">
            <StatusRow label="Hostel fee" status={payments.hostel?.status ?? 'not_started'} />
            <StatusRow label="Mess fee" status={payments.mess?.status ?? 'not_started'} />
          </Card>
        )}
      </section>

      {/* Announcements */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Announcements</h2>
            {hasUnread && (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                New
              </span>
            )}
          </div>
          <Link
            to={ROUTES.announcements}
            onClick={markAnnouncementsSeen}
            className="text-xs font-semibold text-brand hover:underline"
          >
            See all
          </Link>
        </div>
        {status === 'loading' && <Skeleton className="h-16" />}
        {status === 'loaded' && announcements.length === 0 && (
          <EmptyState title="No announcements yet" description="Updates will appear here." icon="📣" />
        )}
        {status === 'loaded' &&
          announcements.slice(0, 2).map((a) => (
            <Card key={a.id} className="flex flex-col gap-1">
              <p className="font-semibold text-ink">{a.title}</p>
              <p className="line-clamp-2 text-sm text-muted">{a.body}</p>
            </Card>
          ))}
      </section>
      </div>

      {/* Quick links */}
      <section className="flex flex-col gap-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Quick links</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Tile to={ROUTES.passes} icon="🎟️" title="My Pass" subtitle="Digital ID & passes" tint="brand" />
          <Tile to={ROUTES.events} icon="📅" title="Events" subtitle="Schedule & venues" tint="violet" />
          <Tile to={ROUTES.mess} icon="🍽️" title="Mess" subtitle="Menu & pass" tint="amber" />
          <Tile to={ROUTES.hostel} icon="🏨" title="Hostel" subtitle="Allocation & check-in" tint="green" />
          <Tile to={ROUTES.help} icon="🆘" title="Help" subtitle="Queries & contacts" tint="slate" />
          <Tile to={ROUTES.more} icon="⋯" title="More" subtitle="Everything else" tint="sky" />
        </div>
      </section>

      {isStaff && (
        <Link to={ROUTES.more} className="block">
          <Card interactive className="flex items-center gap-3">
            <span aria-hidden className="text-xl">🛠️</span>
            <span className="flex-1 text-sm font-semibold text-ink">Management tools</span>
            <span aria-hidden className="text-muted">›</span>
          </Card>
        </Link>
      )}
    </div>
  );
}

function SectionHeader({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <Link to={to} className="text-xs font-semibold text-brand hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}

function StatusRow({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink">{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAY_BADGE[status] ?? PAY_BADGE.not_started}`}
      >
        {PAY_LABEL[status] ?? status}
      </span>
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
