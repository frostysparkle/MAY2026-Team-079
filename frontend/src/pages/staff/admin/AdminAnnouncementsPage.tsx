import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, Hostel, Mess } from '@/api/types';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ResultBanner,
  Select,
  Spinner,
  StatusBadge,
  TextInput,
  type SelectOption,
} from '@/components/ui';
import { HOUSES } from '@/config/houses';
import { currentStaff } from '@/stores/authStore';
import {
  audienceLabel,
  collectAnnouncements,
  createAnnouncement,
  encodeAudience,
  isLive,
  parseAudience,
  registrationWithAnnouncements,
  readAnnouncements,
  validateAnnouncement,
  type Announcement,
  type AnnouncementSeverity,
  type Audience,
} from '@/features/announcements/announcements';
import { formatDateTime } from '@/features/events/eventView';

/**
 * The core team's announcement desk — the sending half of Stories 8.1 and 8.2.
 *
 * ## What it writes, and where
 *
 * A notice is a row in a JSON array carried on an event's `registration` map,
 * which `PUT /events/{event_id}` stores verbatim. `features/announcements/announcements.ts`
 * explains why that is the only server-side store available and why the carrier
 * event does not limit who receives the notice.
 *
 * The PUT sends `{ registration }` and nothing else. `update_event` only `$set`s
 * the fields a request actually carries, so an announcement cannot disturb the
 * event's name, schedule, prizes, or team — and the map itself is copied key for
 * key, so it cannot disturb the event's FAQs or capacity either.
 *
 * ## Super Admin only
 *
 * `PUT /events/{event_id}` refuses anybody else, so the route guard matches the
 * API rather than promising a composer the backend would reject. Other staff
 * *receive* announcements — see the staff duty board — but cannot send them. The
 * screen says so rather than hiding the reason.
 */
export default function AdminAnnouncementsPage() {
  const staff = currentStaff();

  const [events, setEvents] = useState<Event[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [messHalls, setMessHalls] = useState<Mess[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Composer
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<AnnouncementSeverity>('info');
  const [audienceRaw, setAudienceRaw] = useState('everyone');
  const [expiresAt, setExpiresAt] = useState('');
  const [carrier, setCarrier] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    Promise.all([api.listEvents(), api.listHostels(), api.listMess()])
      .then(([e, h, m]) => {
        setEvents(e);
        setHostels(h);
        setMessHalls(m);
      })
      .catch((e) =>
        setLoadError(
          e instanceof ApiClientError ? e.message : 'Could not load the festival catalogue.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const event of events) map[event.event_id] = event.name;
    for (const hostel of hostels) map[hostel.hostel_id] = hostel.name;
    for (const hall of messHalls) map[hall.mess_id] = hall.name;
    return map;
  }, [events, hostels, messHalls]);

  const audienceOptions = useMemo<SelectOption[]>(
    () => buildAudienceOptions(events, hostels, messHalls),
    [events, hostels, messHalls],
  );

  const carrierOptions = useMemo<SelectOption[]>(
    () => events.map((e) => ({ value: e.event_id, label: e.name })),
    [events],
  );

  const audience = parseAudience(audienceRaw);

  /**
   * Filing a notice on the event it is about keeps the two together, so an
   * organiser reading the event record finds the notices that concern it. For a
   * fest-wide notice the choice is arbitrary — the map is only storage — so the
   * first event stands in until the sender says otherwise.
   */
  const effectiveCarrier = useMemo(() => {
    if (carrier) return carrier;
    if (audience && 'id' in audience && names[audience.id] && isEventAudience(audience)) {
      return audience.id;
    }
    return events[0]?.event_id ?? '';
  }, [carrier, audience, names, events]);

  /**
   * The board, split on whether a notice is still being shown to anybody.
   *
   * `visibleTo` already drops an expired notice on every reading surface, so
   * counting the whole stored array as "standing" here told the sender a notice
   * was live when no participant could see it — the one figure this screen
   * exists to report, wrong in the direction that matters.
   *
   * Expired rows are **kept on screen** rather than filtered out, because
   * withdrawing one is only reachable from this list: hiding them would leave
   * dead rows in the carrier event's map with no way to remove them. They are
   * labelled and counted separately instead.
   */
  const board = useMemo(() => {
    const all = collectAnnouncements(events);
    const now = new Date();
    return {
      standing: all.filter((a) => isLive(a, now)),
      expired: all.filter((a) => !isLive(a, now)),
      total: all.length,
    };
  }, [events]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    setSent(null);

    const problem = validateAnnouncement({
      title,
      body,
      audience,
      carrierEventId: effectiveCarrier,
    });
    if (problem || !audience) {
      setSendError(problem ?? 'Choose who this announcement is for.');
      return;
    }

    const host = events.find((event) => event.event_id === effectiveCarrier);
    if (!host) {
      setSendError('That event no longer exists. Reload and pick another.');
      return;
    }

    setSending(true);
    try {
      const announcement = createAnnouncement({
        title,
        body,
        audience,
        severity,
        // The designation is what a participant recognises; the paradox_id is the
        // fallback so a notice is never unattributed.
        postedBy: staff?.designation?.trim() || staff?.id,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        carrierEventId: host.event_id,
      });

      const existing = readAnnouncements(host.registration, host.event_id);
      await api.updateEvent(host.event_id, {
        registration: registrationWithAnnouncements(host.registration, [
          announcement,
          ...existing,
        ]) as Event['registration'],
      });

      setTitle('');
      setBody('');
      setExpiresAt('');
      setSent(`Sent to ${audienceLabel(audience, names).toLowerCase()}.`);
      // Re-read rather than patching local state, so what the board shows is what
      // is actually stored.
      load();
    } catch (err) {
      setSendError(
        err instanceof ApiClientError ? err.message : 'Could not send the announcement.',
      );
    } finally {
      setSending(false);
    }
  }

  async function remove(announcement: Announcement) {
    const host = events.find((event) => event.event_id === announcement.carrierEventId);
    if (!host) {
      setSendError('That announcement’s event record no longer exists.');
      setPendingDelete(null);
      return;
    }

    setDeleting(true);
    try {
      const kept = readAnnouncements(host.registration, host.event_id).filter(
        (a) => a.id !== announcement.id,
      );
      await api.updateEvent(host.event_id, {
        registration: registrationWithAnnouncements(
          host.registration,
          kept,
        ) as Event['registration'],
      });
      setPendingDelete(null);
      load();
    } catch (err) {
      setSendError(err instanceof ApiClientError ? err.message : 'Could not delete it.');
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <FestivalScreen title="Announcements" eyebrow="Super Admin">
        <ErrorState title="Could not load" description={loadError} />
      </FestivalScreen>
    );
  }

  if (loading) {
    return (
      <FestivalScreen title="Announcements" eyebrow="Super Admin">
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="Announcements"
      eyebrow="Super Admin"
      subtitle="Send an official announcement, and choose exactly who is told."
      width="xl"
    >
      <ResultBanner variant="warning" title="Announcements are public">
        An announcement is stored on an event record, and event records are readable without signing
        in. The audience decides who is <strong>shown</strong> an announcement, not who is able to
        find it — so do not put anything confidential here. Delivery is on next open, not push: the
        backend has no subscription store to send to.
      </ResultBanner>

      <form onSubmit={send} className="flex flex-col gap-5">
        {sendError && (
          <ResultBanner variant="error" title="Not sent">
            {sendError}
          </ResultBanner>
        )}
        {sent && (
          <ResultBanner variant="success" title="Announcement sent">
            {sent}
          </ResultBanner>
        )}

        <Card className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-black tracking-tight text-ink">New announcement</h2>
            <p className="text-xs text-muted">
              Everyone in the audience sees it the next time they open the app.
            </p>
          </div>

          <TextInput
            label="Headline"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Round 2 has moved to CLT"
          />

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">
              Message
              <span className="text-danger" aria-hidden>
                {' '}
                *
              </span>
            </span>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What has changed, what to do about it, and by when."
              className="w-full rounded-lg border border-input bg-surface p-3 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
            <span className="text-xs text-muted">Line breaks are kept as you type them.</span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Who is told"
              required
              value={audienceRaw}
              onChange={(e) => setAudienceRaw(e.target.value)}
              options={audienceOptions}
              hint="Only these people are shown it."
            />
            <Select
              label="Emphasis"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as AnnouncementSeverity)}
              options={[
                { value: 'info', label: 'Notice' },
                { value: 'important', label: 'Important' },
                { value: 'urgent', label: 'Urgent' },
              ]}
            />
            <TextInput
              label="Stop showing it after"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              hint="Optional. Blank means it stands until you delete it."
            />
            <Select
              label="Filed on"
              value={effectiveCarrier}
              onChange={(e) => setCarrier(e.target.value)}
              options={carrierOptions}
              hint="Storage only — the API has no fest-level record. It does not limit the audience."
            />
          </div>

          <div>
            <Button type="submit" loading={sending} disabled={events.length === 0}>
              <Send size={15} strokeWidth={2.5} /> Send announcement
            </Button>
          </div>
        </Card>
      </form>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-black tracking-tight text-ink">On the board</h2>
            <p className="text-xs text-muted">
              Every announcement currently stored, newest first — whoever sent it.
            </p>
          </div>
          <StatusBadge tone={board.standing.length > 0 ? 'info' : 'neutral'}>
            {board.standing.length} standing
          </StatusBadge>
        </div>

        {board.total === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Nothing announced yet"
            description="Announcements you send appear here, and you can withdraw any of them."
          />
        ) : (
          <>
            {board.standing.length > 0 && (
              <ul className="flex flex-col gap-2">
                {board.standing.map((announcement) => (
                  <AnnouncementRow
                    key={announcement.id}
                    announcement={announcement}
                    names={names}
                    onWithdraw={setPendingDelete}
                  />
                ))}
              </ul>
            )}

            {board.expired.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2 border-t border-input pt-3">
                  <h3 className="text-sm font-bold text-ink">
                    Expired — {board.expired.length}{' '}
                    {board.expired.length === 1 ? 'notice' : 'notices'}
                  </h3>
                  <p className="text-[11px] text-muted">
                    Past their &ldquo;stop showing&rdquo; time. Nobody is shown these; they are
                    still stored, so withdraw them to clear the record.
                  </p>
                </div>
                <ul className="flex flex-col gap-2">
                  {board.expired.map((announcement) => (
                    <AnnouncementRow
                      key={announcement.id}
                      announcement={announcement}
                      names={names}
                      onWithdraw={setPendingDelete}
                      expired
                    />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Withdraw this announcement?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" stops being shown to everyone. This cannot be undone.`
            : undefined
        }
        confirmLabel="Withdraw"
        loading={deleting}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </FestivalScreen>
  );
}

/**
 * One row on the board, shared by the standing and expired lists.
 *
 * Shared rather than duplicated so an expired notice cannot drift into showing
 * different information from a live one — the only difference is the badge and
 * the muted tone.
 */
function AnnouncementRow({
  announcement,
  names,
  onWithdraw,
  expired = false,
}: {
  announcement: Announcement;
  names: Record<string, string>;
  onWithdraw: (announcement: Announcement) => void;
  expired?: boolean;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-2xl bg-surface-2 p-3${expired ? ' opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <span>
            {audienceLabel(announcement.audience, names)} · {announcement.severity}
          </span>
          {expired && <StatusBadge tone="neutral">Expired</StatusBadge>}
        </p>
        <h3 className="text-sm font-bold text-ink">{announcement.title}</h3>
        <p className="mt-0.5 whitespace-pre-line text-sm text-ink">{announcement.body}</p>
        <p className="mt-1 text-[11px] text-muted">
          {formatDateTime(announcement.postedAt)}
          {announcement.postedBy ? ` · ${announcement.postedBy}` : ''}
          {` · filed on ${names[announcement.carrierEventId] ?? announcement.carrierEventId}`}
          {announcement.expiresAt
            ? `${expired ? ' · expired ' : ' · until '}${formatDateTime(announcement.expiresAt)}`
            : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onWithdraw(announcement)}
        aria-label={`Withdraw announcement: ${announcement.title}`}
        className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-danger-bg hover:text-danger active:scale-90"
      >
        <Trash2 size={15} strokeWidth={2} />
      </button>
    </li>
  );
}

/** Whether this audience is scoped to an event, so it can double as the carrier. */
function isEventAudience(audience: Audience): boolean {
  return audience.kind === 'event' || audience.kind === 'event_team';
}

/**
 * The audience list, grouped from broadest to narrowest.
 *
 * Built from the live catalogue rather than a fixed list so a block added this
 * morning is addressable this afternoon. Houses come from `config/houses.ts`
 * because `profile.house` is free text on the backend and has no endpoint to
 * enumerate.
 */
function buildAudienceOptions(
  events: readonly Event[],
  hostels: readonly Hostel[],
  messHalls: readonly Mess[],
): SelectOption[] {
  const option = (audience: Audience, label: string): SelectOption => ({
    value: encodeAudience(audience),
    label,
  });

  return [
    option({ kind: 'everyone' }, 'Everyone'),
    option({ kind: 'participants' }, 'All participants'),
    option({ kind: 'staff' }, 'All staff'),
    // The value must be the house string exactly as `profile.house` stores it;
    // only the label drops the redundant suffix.
    ...HOUSES.map((house) =>
      option({ kind: 'house', id: house }, `House — ${house.replace(/\s+House$/i, '')}`),
    ),
    ...events.map((e) => option({ kind: 'event', id: e.event_id }, `Registered for — ${e.name}`)),
    ...hostels.map((h) => option({ kind: 'hostel', id: h.hostel_id }, `Residents of — ${h.name}`)),
    ...messHalls.map((m) => option({ kind: 'mess', id: m.mess_id }, `Diners at — ${m.name}`)),
    ...events.map((e) => option({ kind: 'event_team', id: e.event_id }, `Event team — ${e.name}`)),
    ...hostels.map((h) =>
      option({ kind: 'hostel_team', id: h.hostel_id }, `Block team — ${h.name}`),
    ),
    ...messHalls.map((m) => option({ kind: 'mess_team', id: m.mess_id }, `Mess team — ${m.name}`)),
  ];
}
