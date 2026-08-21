import { Link } from 'react-router-dom';
import { AlertTriangle, Info, Megaphone, Siren, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { audienceLabel, type Announcement, type AnnouncementSeverity } from './announcements';
import { formatDateTime } from '@/features/events/eventView';

/**
 * Official announcements as a participant or staff member reads them — the
 * delivered half of Stories 8.1 and 8.2.
 *
 * Only notices addressed to this reader ever reach here; the audience filtering
 * happens in `visibleTo` before the list is handed over. The audience is still
 * printed on each row, because "you are being told this as a resident of Ganga
 * Block" is the difference between a notice a person acts on and one they ignore.
 *
 * A plain labelled section rather than a live region, for the same reason
 * `EventChangeAlerts` is: these persist across loads, and a live region would
 * re-announce all of them on every navigation.
 */

const SEVERITY: Record<
  AnnouncementSeverity,
  { icon: LucideIcon; panel: string; accent: string; label: string }
> = {
  info: {
    icon: Info,
    panel: 'bg-brand-light ring-black/[0.03]',
    accent: 'text-brand-700',
    label: 'Notice',
  },
  important: {
    icon: AlertTriangle,
    panel: 'bg-warning-bg ring-black/[0.03]',
    accent: 'text-warning',
    label: 'Important',
  },
  urgent: {
    icon: Siren,
    panel: 'bg-danger-bg ring-black/[0.03]',
    accent: 'text-danger',
    label: 'Urgent',
  },
};

/** The loudest severity in a batch, so a mixed panel takes its tone from the worst news. */
function loudest(announcements: readonly Announcement[]): AnnouncementSeverity {
  if (announcements.some((a) => a.severity === 'urgent')) return 'urgent';
  if (announcements.some((a) => a.severity === 'important')) return 'important';
  return 'info';
}

export function AnnouncementFeed({
  announcements,
  names = {},
  onDismiss,
  onDismissAll,
  limit,
  moreTo,
  heading,
}: {
  announcements: Announcement[];
  /** Entity id → display name, so an audience reads as a place rather than an id. */
  names?: Record<string, string>;
  onDismiss?: (announcementId: string) => void;
  onDismissAll?: () => void;
  /** Show at most this many, with a link to the rest. Unset shows everything. */
  limit?: number;
  /** Where "See all" goes when `limit` hides some. */
  moreTo?: string;
  heading?: string;
}) {
  if (announcements.length === 0) return null;

  const shown = typeof limit === 'number' ? announcements.slice(0, limit) : announcements;
  const hidden = announcements.length - shown.length;
  const tone = SEVERITY[loudest(shown)];

  return (
    <section
      aria-labelledby="announcements-heading"
      className={cn(
        'animate-pop flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset',
        tone.panel,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className={cn('flex items-center gap-2', tone.accent)}>
          <Megaphone size={16} strokeWidth={2.5} className="shrink-0" />
          <h2 id="announcements-heading" className="text-sm font-black tracking-tight">
            {heading ??
              (announcements.length === 1
                ? 'One announcement for you'
                : `${announcements.length} announcements for you`)}
          </h2>
        </div>
        {onDismissAll && shown.length > 1 && (
          <button
            type="button"
            onClick={onDismissAll}
            className={cn(
              'tap shrink-0 rounded-full px-3 py-1 text-xs font-semibold underline-offset-2 hover:underline active:scale-95',
              tone.accent,
            )}
          >
            Dismiss all
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {shown.map((announcement) => (
          <AnnouncementRow
            key={announcement.id}
            announcement={announcement}
            names={names}
            onDismiss={onDismiss}
          />
        ))}
      </ul>

      {hidden > 0 && moreTo && (
        <Link
          to={moreTo}
          className={cn('text-xs font-semibold underline-offset-2 hover:underline', tone.accent)}
        >
          See {hidden} more {hidden === 1 ? 'announcement' : 'announcements'}
        </Link>
      )}
    </section>
  );
}

function AnnouncementRow({
  announcement,
  names,
  onDismiss,
}: {
  announcement: Announcement;
  names: Record<string, string>;
  onDismiss?: (announcementId: string) => void;
}) {
  const tone = SEVERITY[announcement.severity];
  const Icon = tone.icon;

  return (
    <li className="flex items-start gap-3 rounded-xl bg-surface p-3 shadow-card ring-1 ring-black/[0.04]">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide',
            tone.accent,
          )}
        >
          <Icon size={12} strokeWidth={2.5} className="shrink-0" />
          {tone.label}
          <span aria-hidden className="text-muted">
            ·
          </span>
          <span className="font-medium normal-case tracking-normal text-muted">
            {audienceLabel(announcement.audience, names)}
          </span>
        </p>

        <h3 className="mt-0.5 text-sm font-bold text-ink">{announcement.title}</h3>
        {/* Sent as typed, including line breaks — an announcement is somebody's words. */}
        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">
          {announcement.body}
        </p>

        <p className="mt-1.5 text-[11px] text-muted">
          {formatDateTime(announcement.postedAt)}
          {announcement.postedBy ? ` · ${announcement.postedBy}` : ''}
          {announcement.expiresAt ? ` · until ${formatDateTime(announcement.expiresAt)}` : ''}
        </p>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={() => onDismiss(announcement.id)}
          aria-label={`Dismiss announcement: ${announcement.title}`}
          className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink active:scale-90"
        >
          <X size={15} strokeWidth={2.5} />
        </button>
      )}
    </li>
  );
}
