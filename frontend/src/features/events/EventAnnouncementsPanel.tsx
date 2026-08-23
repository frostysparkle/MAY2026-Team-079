import { useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { ApiClientError } from '@/api';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  DetailPanel,
  EmptyState,
  ResultBanner,
  Select,
  Spinner,
  StatusBadge,
  TextArea,
} from '@/components/ui';
import type { EventAnnouncementsState } from './useEventAnnouncements';
import {
  EMPTY_DRAFT,
  MESSAGE_MAX,
  formatAnnouncementTime,
  priorityLabel,
  priorityTone,
  validateDraft,
  PRIORITIES,
  draftToRequest,
  type AnnouncementDraft,
} from './announcements';

/**
 * An event's own announcements — Story 8.2.
 *
 * One component for both audiences, the same way `QueryThread` is one
 * component for a participant and a query-team member: the list is identical
 * either way, and `canPublish` is the only thing that changes what renders.
 * Used on the participant's own event page (`canPublish={false}`) and on the
 * organiser's screens — the staff dashboard's event-duty section and the admin
 * event editor — where an Event Head or Super Admin can compose one.
 *
 * `POST /events/{id}/announcements` restricts publishing to the event's own
 * Event Head or a Super Admin (`backend/routers/events.py`); a plain team
 * member sees the list with no compose control, matching what the endpoint
 * would refuse them anyway.
 */
export function EventAnnouncementsPanel({
  state,
  canPublish,
}: {
  state: EventAnnouncementsState;
  /** Whether this caller may compose one — an Event Head, or a Super Admin. */
  canPublish: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const errors = validateDraft(draft);
  const shown = touched ? errors : {};

  function startComposing() {
    setComposing(true);
  }

  function cancelComposing() {
    setComposing(false);
    setDraft(EMPTY_DRAFT);
    setTouched(false);
    setSendError(null);
  }

  async function submit() {
    setTouched(true);
    const request = draftToRequest(draft);
    if (!request) return;

    setSubmitting(true);
    setSendError(null);
    try {
      await state.publish(request);
      setDraft(EMPTY_DRAFT);
      setTouched(false);
      setComposing(false);
    } catch (e) {
      setSendError(e instanceof ApiClientError ? e.message : 'Could not publish that.');
    } finally {
      setSubmitting(false);
    }
  }

  // A read failure that is not "you may not read this" (handled silently by the
  // hook) — worth a banner, but never worth hiding the compose control an Event
  // Head still has the right to use.
  const readError = state.error;

  return (
    <DetailPanel
      title="Announcements"
      meta={state.announcements.length > 0 ? `${state.announcements.length}` : undefined}
      trailing={
        canPublish &&
        !composing && (
          <Button size="sm" onClick={startComposing}>
            <Megaphone size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> New
          </Button>
        )
      }
    >
      {readError && (
        <ResultBanner variant="error" title="Could not load announcements">
          {readError}
        </ResultBanner>
      )}

      {composing && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
          <TextArea
            id="announcement-message"
            label="Message"
            required
            rows={3}
            maxLength={MESSAGE_MAX}
            value={draft.message}
            error={shown.message}
            hint="Every registrant for this event sees this, next time they open it."
            onChange={(e) => setDraft((current) => ({ ...current, message: e.target.value }))}
          />
          <Select
            label="Priority"
            value={draft.priority}
            onChange={(e) =>
              setDraft((current) => ({
                ...current,
                priority: e.target.value as AnnouncementDraft['priority'],
              }))
            }
            options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          />

          {sendError && (
            <ResultBanner variant="error" title="Not sent">
              {sendError}
            </ResultBanner>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={cancelComposing}>
              Cancel
            </Button>
            <Button onClick={submit} loading={submitting}>
              <Send size={BUTTON_ICON.md} strokeWidth={BUTTON_ICON_STROKE} /> Publish
            </Button>
          </div>
        </div>
      )}

      {state.loading ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner label="Loading announcements" />
        </div>
      ) : state.announcements.length === 0 ? (
        !composing && (
          <EmptyState
            icon={Megaphone}
            title="No announcements yet"
            description={
              canPublish
                ? 'Post one when something registrants need to know changes.'
                : 'Anything the organisers publish about this event appears here.'
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {state.announcements.map((announcement) => (
            <li
              key={announcement.announcement_id}
              className="rounded-2xl bg-surface-2 p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-relaxed text-ink">
                  {announcement.message}
                </p>
                <StatusBadge tone={priorityTone(announcement.priority)}>
                  {priorityLabel(announcement.priority)}
                </StatusBadge>
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-muted">
                {formatAnnouncementTime(announcement.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </DetailPanel>
  );
}
