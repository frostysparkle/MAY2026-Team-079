import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, X } from 'lucide-react';
import { path, ROUTES } from '@/config/routes';
import { formatDateTime } from './eventView';
import { CHANGE_FIELD_LABEL, type EventChange } from './eventChanges';

/**
 * "Your event moved" — the participant-facing half of Story 1.2.
 *
 * Sits above the fold on the dashboard and on My Registrations, because a venue
 * change is only worth anything before the participant has set off. Each alert
 * survives reloads until it is dismissed, so opening the app on the way to a
 * venue still shows a change noticed yesterday.
 *
 * Rendered as a plain labelled section rather than a live region: these persist
 * across loads, and a live region would re-announce every one of them on every
 * navigation.
 */
export function EventChangeAlerts({
  changes,
  onDismiss,
  onDismissAll,
}: {
  changes: EventChange[];
  onDismiss: (changeId: string) => void;
  onDismissAll: () => void;
}) {
  if (changes.length === 0) return null;

  return (
    <section
      aria-labelledby="event-change-heading"
      className="animate-pop flex flex-col gap-3 rounded-2xl bg-warning-bg p-4 ring-1 ring-inset ring-black/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-warning">
          <CalendarClock size={16} strokeWidth={2.5} className="shrink-0" />
          <h2 id="event-change-heading" className="text-sm font-black tracking-tight">
            {changes.length === 1
              ? 'A round you are registered for has moved'
              : `${changes.length} rounds you are registered for have moved`}
          </h2>
        </div>
        {changes.length > 1 && (
          <button
            type="button"
            onClick={onDismissAll}
            className="tap shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-warning underline-offset-2 hover:underline active:scale-95"
          >
            Dismiss all
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {changes.map((change) => (
          <li
            key={change.id}
            className="flex items-start gap-3 rounded-xl bg-surface p-3 shadow-card ring-1 ring-black/[0.04]"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={path(ROUTES.eventDetail, { eventId: change.eventId })}
                className="text-sm font-bold text-ink hover:text-brand"
              >
                {change.eventName}
              </Link>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {change.roundName} · {CHANGE_FIELD_LABEL[change.field]}
              </p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink">
                {change.from && (
                  <>
                    <s className="text-muted">{display(change.field, change.from)}</s>
                    <span aria-hidden className="text-muted">
                      →
                    </span>
                  </>
                )}
                <strong className="inline-flex items-center gap-1 font-bold text-ink">
                  {change.field === 'venue' && <MapPin size={13} className="shrink-0" />}
                  {display(change.field, change.to)}
                </strong>
              </p>
            </div>

            <button
              type="button"
              onClick={() => onDismiss(change.id)}
              aria-label={`Dismiss the ${CHANGE_FIELD_LABEL[change.field].toLowerCase()} change for ${change.eventName}`}
              className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink active:scale-90"
            >
              <X size={15} strokeWidth={2.5} />
            </button>
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-relaxed text-warning/80">
        Checked against what this device last saw. Changes made before you first opened an event are
        not listed.
      </p>
    </section>
  );
}

/** A venue is printed as written; a time is formatted the way rounds are elsewhere. */
function display(field: EventChange['field'], value: string): string {
  return field === 'venue' ? value : formatDateTime(value);
}
