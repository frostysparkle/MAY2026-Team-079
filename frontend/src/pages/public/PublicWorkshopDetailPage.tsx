import { Link, Navigate } from 'react-router-dom';
import { useParams } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { PublicPageChrome } from '@/features/landing/PublicPageChrome';
import { Skeleton, StatusBadge } from '@/components/ui';
import { WorkshopBookingAction } from '@/features/workshops/WorkshopBookingAction';
import { usePublicWorkshop } from '@/features/workshops/usePublicWorkshops';
import { WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { shiftLabel } from '@/features/workshops/workshopSlot';

/**
 * Public, pre-login workshop detail — the full-resolution flyer plus the day,
 * shift and venue it runs in.
 *
 * Read from the published programme (`GET /workshops/public`); booking itself
 * happens in the app shell, where live seat counts and the one-per-shift rule
 * are enforced against the authenticated API.
 */
export default function PublicWorkshopDetailPage() {
  const { workshopId = '' } = useParams<{ workshopId: string }>();
  const { view, loading } = usePublicWorkshop(workshopId);

  if (loading) {
    return (
      <PublicPageChrome active="Workshops" width="md">
        <Skeleton className="mt-10 h-96 rounded-2xl" />
      </PublicPageChrome>
    );
  }

  if (!view) return <Navigate to={ROUTES.publicWorkshops} replace />;

  return (
    <PublicPageChrome active="Workshops" width="md">
      <div className="flex flex-col gap-6">
        <div>
          <Link
            to={ROUTES.publicWorkshops}
            className="tap inline-flex items-center gap-2 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-card ring-1 ring-line transition hover:bg-surface-2 active:scale-95"
          >
            ← All workshops
          </Link>
        </div>

        <div className="animate-rise flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card ring-1 ring-line/70">
          <h1 className="text-2xl font-black tracking-tight text-ink">{view.name}</h1>

          <div className="flex flex-wrap items-center gap-2">
            {view.dayLabel && <StatusBadge tone="info">{view.dayLabel}</StatusBadge>}
            {view.slot.shift && (
              <StatusBadge tone="neutral">{shiftLabel(view.slot.shift)} shift</StatusBadge>
            )}
            {view.seatsLeft !== undefined && (
              <StatusBadge tone={view.seatsLeft > 0 ? 'success' : 'danger'}>
                {view.seatsLeft > 0 ? `${view.seatsLeft} seats left` : 'Full'}
              </StatusBadge>
            )}
          </div>

          {view.venue && (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <MapPin size={14} className="shrink-0" /> {view.venue}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Users size={14} className="shrink-0" /> Capacity {view.capacity}
          </p>

          {view.instructions && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85">
              {view.instructions}
            </p>
          )}

          <WorkshopBookingAction />
        </div>

        {/* Full-resolution flyer — for the shipped artwork the session title,
            speaker and agenda are typeset into the image itself. */}
        <div className="overflow-hidden rounded-2xl bg-surface-2 shadow-lift ring-1 ring-black/[0.06]">
          <img
            src={view.posterFull}
            alt={view.name}
            width={1191}
            height={1684}
            decoding="async"
            onError={(e) => {
              if (!e.currentTarget.src.endsWith(WORKSHOP_COVER)) {
                e.currentTarget.src = WORKSHOP_COVER;
              }
            }}
            className="block h-auto w-full object-contain"
          />
        </div>
      </div>
    </PublicPageChrome>
  );
}
