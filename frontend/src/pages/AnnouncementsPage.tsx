import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { Announcement, Audience } from '@/api/types';
import { Card, Skeleton, EmptyState, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const AUDIENCE_LABEL: Record<Audience, string> = {
  all_participants: 'All',
  event_registrants: 'Event',
  hostel_residents: 'Hostel',
  pors: 'PORs',
};

/**
 * Announcements feed (Epic 8, FR-8.1). Shows only the announcements targeted to
 * the signed-in user's audience groups (filtered server-side). Doubles as the
 * in-app "last updated" channel (FR-1.2 fallback).
 */
export default function AnnouncementsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [items, setItems] = useState<Announcement[]>([]);

  async function load() {
    setStatus('loading');
    try {
      const { announcements } = await api.listAnnouncements();
      setItems(announcements);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Announcements</h1>
        <p className="text-sm text-muted">Official updates from the core team.</p>
      </div>

      {status === 'loading' && (
        <>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </>
      )}
      {status === 'error' && (
        <ErrorState description="Could not load announcements." onRetry={() => void load()} />
      )}
      {status === 'loaded' && items.length === 0 && (
        <EmptyState title="No announcements yet" description="Updates will appear here." icon="📣" />
      )}

      {status === 'loaded' &&
        items.map((a) => (
          <Card key={a.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-gray-900">{a.title}</p>
              <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                {AUDIENCE_LABEL[a.audience]}
              </span>
            </div>
            <p className="whitespace-pre-line text-sm text-gray-700">{a.body}</p>
            <p className="text-xs text-muted">
              {a.senderName ?? 'Core Team'} · {a.createdAt.slice(0, 10)}
            </p>
          </Card>
        ))}
    </div>
  );
}
