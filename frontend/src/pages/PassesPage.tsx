import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api';
import type { MyRegistration } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { DigitalIdCard } from '@/features/qr/DigitalIdCard';
import { Card, EmptyState, ErrorState, ListItem, Skeleton } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

function monthAbbr(isoDate: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(isoDate.slice(5, 7));
  return months[m - 1] ?? '';
}

/**
 * My Pass — the student's single stop for entry (spec: student-experience
 * redesign, Req 9). Shows the on-device digital ID QR plus every event they’re
 * registered for, each linking to its schedule and entry instructions, with the
 * announcements feed one tap away.
 */
export default function PassesPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [registrations, setRegistrations] = useState<MyRegistration[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const { registrations } = await api.listMyRegistrations();
      const sorted = [...registrations].sort((a, b) =>
        `${a.eventDate}${a.startTime}`.localeCompare(`${b.eventDate}${b.startTime}`),
      );
      setRegistrations(sorted);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">My Pass</h1>
        <p className="text-sm text-muted">Your digital ID and event passes in one place.</p>
      </div>

      <DigitalIdCard />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">My events</h2>
          <Link to={ROUTES.events} className="text-xs font-semibold text-brand hover:underline">
            Full schedule
          </Link>
        </div>

        {status === 'loading' && (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )}

        {status === 'error' && (
          <ErrorState description="Could not load your events." onRetry={() => void load()} />
        )}

        {status === 'loaded' && registrations.length === 0 && (
          <EmptyState
            title="No event passes yet"
            description="Register for events to get your passes here."
            icon="🎟️"
            action={
              <Link to={ROUTES.events} className="text-sm font-semibold text-brand hover:underline">
                Browse events
              </Link>
            }
          />
        )}

        {status === 'loaded' &&
          registrations.map((r) => (
            <Link key={r.eventId} to={ROUTES.eventDetail(r.eventId)} className="block">
              <Card interactive className="flex gap-3">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-100 text-brand">
                  <span className="text-lg font-black leading-none">{r.eventDate.slice(8, 10)}</span>
                  <span className="text-[10px] font-semibold uppercase">{monthAbbr(r.eventDate)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{r.title}</p>
                  <p className="truncate text-sm text-muted">{r.venue}</p>
                  <p className="mt-1 text-xs text-muted">
                    {r.startTime}–{r.endTime}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
      </section>

      <Card className="p-2">
        <Link to={ROUTES.announcements}>
          <ListItem
            leading={<span className="text-lg">📣</span>}
            title="Announcements"
            subtitle="Latest updates and schedule changes"
            trailing={<span className="text-muted">›</span>}
          />
        </Link>
      </Card>
    </div>
  );
}
