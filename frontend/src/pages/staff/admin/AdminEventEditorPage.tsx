import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type {
  Event,
  PrizeMoney,
  RegistrationField,
  ScheduleRound,
} from '@/api/types';
import { ROUTES } from '@/config/routes';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  Button,
  Card,
  ErrorState,
  FieldErrors,
  ResultBanner,
  Select,
  Spinner,
  TextInput,
} from '@/components/ui';
import type { FieldError } from '@/api/errors';
import {
  readEventExtras,
  readRegistrationWindow,
  writeEventRegistration,
  type EventFaq,
  type EventMetaRow,
} from '@/features/events/eventExtras';
import { EventTeamPanel } from '@/features/events/EventTeamPanel';
import { EventAnnouncementsPanel } from '@/features/events/EventAnnouncementsPanel';
import { useEventAnnouncements } from '@/features/events/useEventAnnouncements';
import { serverGeneratedIdPlaceholder } from '@/lib/serverGeneratedId';

/**
 * Super Admin event authoring — create a new event or edit an existing one, in
 * the same shape the hardcoded festival catalogue uses, so a new event renders
 * identically to a hardcoded one.
 *
 * Every field maps onto the frozen backend `Event` schema. The ones the schema
 * has no column for — rulebook, FAQs, per-field dropdown choices, capacity, and
 * the entry requirements — ride in the open `registration` map; see
 * `features/events/eventExtras.ts`.
 *
 * `save()` rebuilds that map from scratch on every write, so any key the form
 * does not read here would be dropped on the next edit. Adding a piggybacked
 * field means teaching both `hydrate()` and `save()` about it.
 */

const EVENT_TYPES = [
  { value: 'technical', label: 'Technicals' },
  { value: 'culturals', label: 'Culturals' },
  { value: 'sports', label: 'Sports' },
  { value: 'others', label: 'Others (not shown in the public catalogue)' },
];

const FIELD_TYPES = ['text', 'number', 'email', 'phone', 'url', 'select', 'checkbox'].map((t) => ({
  value: t,
  label: t[0].toUpperCase() + t.slice(1),
}));

/** A registration field plus the choices we store separately for `select`. */
interface FieldDraft extends RegistrationField {
  options: string;
}

/**
 * A prize plus the text actually printed on the tile. The schema's amount is an
 * integer, but real prizes read "₹10000 each" or "25 Plaques", so the wording is
 * kept alongside the number.
 */
interface PrizeDraft extends PrizeMoney {
  display: string;
}

/**
 * A round plus the time as it should read. Rounds are often announced as
 * "10 Jun, 03:30 pm" or just "1 Jun", which no timestamp pair can express.
 */
interface RoundDraft extends ScheduleRound {
  when: string;
}

export default function AdminEventEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { eventId } = useParams<{ eventId?: string }>();
  const isEdit = Boolean(eventId);

  /**
   * The action menu's "Event team" entry navigates here with
   * `state: { focus: 'team' }`, because the panel sits below a long form. Without
   * this the admin lands at the top of the editor with no sign of what they asked
   * for.
   */
  const teamRef = useRef<HTMLDivElement | null>(null);
  const wantsTeam = (location.state as { focus?: string } | null)?.focus === 'team';

  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);

  // Basics. No `id` field: `POST /events` mints the event id itself.
  const [name, setName] = useState('');
  const [eventType, setEventType] = useState('technical');
  const [description, setDescription] = useState('');
  const [poster, setPoster] = useState('');

  // Team rule
  const [teamMin, setTeamMin] = useState(1);
  const [teamMax, setTeamMax] = useState(1);
  const [house, setHouse] = useState(false);
  const [allowSingle, setAllowSingle] = useState(true);

  // Registration window + extras
  const [regStart, setRegStart] = useState('');
  const [regEnd, setRegEnd] = useState('');
  const [rulebook, setRulebook] = useState('');
  /** Held as text so the box can be genuinely empty; parsed on save. */
  const [capacity, setCapacity] = useState('');

  // Entry requirements
  const [reportingTime, setReportingTime] = useState('');
  const [idProof, setIdProof] = useState('');
  const [allowedItems, setAllowedItems] = useState('');

  // Repeatable sections
  const [prizes, setPrizes] = useState<PrizeDraft[]>([]);
  const [rounds, setRounds] = useState<RoundDraft[]>([]);
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [faqs, setFaqs] = useState<EventFaq[]>([]);
  const [meta, setMeta] = useState<EventMetaRow[]>([]);
  const [entryRules, setEntryRules] = useState<string[]>([]);

  /**
   * The saved record, held alongside the form's own fields.
   *
   * The form is the *draft*; this is what the server currently holds. The team
   * panel below needs the latter — `event_team` is written by its own route, not
   * by this form's save, so it must not be mixed into the draft or a save would
   * try to round-trip it.
   */
  const [record, setRecord] = useState<Event | null>(null);

  // Story 8.2. A Super Admin may always publish, per `create_announcement` in
  // `backend/routers/events.py` — unlike the staff dashboard's duty section,
  // this screen needs no Event Head check. Only meaningful once the event
  // exists, so it is skipped entirely on `new`.
  const announcements = useEventAnnouncements(eventId ?? '');

  useEffect(() => {
    if (!eventId) return;
    api
      .listEvents()
      .then((all) => {
        const found = all.find((e) => e.event_id === eventId);
        if (!found) {
          setLoadError('That event no longer exists.');
          return;
        }
        setRecord(found);
        hydrate(found);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load the event.'),
      )
      .finally(() => setLoading(false));

    function hydrate(event: Event) {
      const extras = readEventExtras(event.registration);
      const window = readRegistrationWindow(event.registration);

      setName(event.name);
      setEventType(event.event_type);
      setDescription(event.description);
      setPoster(event.poster ?? '');
      setTeamMin(event.team?.min ?? 1);
      setTeamMax(event.team?.max ?? 1);
      setHouse(event.team?.house_vs_house_event ?? false);
      setAllowSingle(event.team?.allow_single_registration ?? true);
      setRegStart(window.startTime ?? '');
      setRegEnd(window.endTime ?? '');
      setRulebook(extras.rulebook ?? '');
      setCapacity(extras.capacity ? String(extras.capacity) : '');
      setReportingTime(extras.entry.reportingTime ?? '');
      setIdProof(extras.entry.idProof ?? '');
      setAllowedItems(extras.entry.allowedItems.join(', '));
      setEntryRules(extras.entry.rules);
      setPrizes(
        (event.prize_money ?? []).map((p, i) => ({ ...p, display: extras.prizeAmounts[i] ?? '' })),
      );
      setRounds((event.schedule ?? []).map((r, i) => ({ ...r, when: extras.roundWhen[i] ?? '' })));
      setFaqs(extras.faqs);
      setMeta(extras.meta);
      setFields(
        (event.registration_fields ?? []).map((f) => ({
          ...f,
          options: (extras.fieldOptions[f.field_id] ?? []).join(', '),
        })),
      );
    }
  }, [eventId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setBusy(true);

    const fieldOptions: Record<string, string[]> = {};
    for (const f of fields) {
      if (f.type !== 'select') continue;
      const choices = f.options
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (choices.length > 0) fieldOptions[f.field_id] = choices;
    }

    // Drop blank rows first, so the display lists stay aligned with the columns
    // they annotate.
    const keptPrizes = prizes.filter((p) => p.position.trim());
    const keptRounds = rounds.filter((r) => r.name.trim());

    const registration = writeEventRegistration({
      startTime: regStart,
      endTime: regEnd,
      rulebook,
      faqs,
      fieldOptions,
      meta,
      prizeAmounts: keptPrizes.map((p) => p.display),
      roundWhen: keptRounds.map((r) => r.when),
      // A blank, zero, or non-numeric box means "no published limit" — the
      // writer drops anything that is not a positive whole number.
      capacity: Number(capacity),
      entry: {
        reportingTime,
        idProof,
        allowedItems: allowedItems.split(',').map((item) => item.trim()),
        rules: entryRules,
      },
    });

    const payload = {
      event_type: eventType,
      name: name.trim(),
      description: description.trim(),
      poster: poster.trim(),
      team: {
        min: teamMin,
        max: teamMax,
        house_vs_house_event: house,
        allow_single_registration: allowSingle,
      },
      prize_money: keptPrizes.map(({ position, amount }) => ({ position, amount })),
      registration,
      schedule: keptRounds.map(({ when: _when, ...round }) => round),
      registration_fields: fields
        .filter((f) => f.field_id.trim() && f.label.trim())
        .map(({ field_id, label, type, required }) => ({ field_id, label, type, required })),
    };

    try {
      if (isEdit && eventId) {
        await api.updateEvent(eventId, payload);
      } else {
        // `event_id` is required by the schema but ignored by the handler, which
        // generates the real id. See `serverGeneratedIdPlaceholder`.
        await api.createEvent({ ...payload, event_id: serverGeneratedIdPlaceholder(name) });
      }
      navigate(ROUTES.adminEvents);
    } catch (err) {
      setSaveError(err instanceof ApiClientError ? err.message : 'Could not save the event.');
      // A 422 names the fields it rejected — worth listing on a form this long,
      // where "the request was invalid" leaves an admin hunting.
      setSaveFieldErrors(err instanceof ApiClientError ? err.fieldErrors : []);
    } finally {
      setBusy(false);
    }
  }

  // Once the form has rendered, take the admin to the panel they asked for.
  // Guarded because `scrollIntoView` is not implemented in jsdom, where every
  // test that renders this page would otherwise throw.
  useEffect(() => {
    if (!wantsTeam || loading) return;
    teamRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [wantsTeam, loading]);

  /** Re-reads the record only — the form keeps whatever is typed into it. */
  function refreshRecord() {
    if (!eventId) return;
    api
      .listEvents()
      .then((all) => setRecord(all.find((e) => e.event_id === eventId) ?? null))
      .catch(() => undefined);
  }

  const back = { label: 'Events', onClick: () => navigate(ROUTES.adminEvents) };

  if (loadError) {
    return (
      <FestivalScreen title="Edit event" back={back}>
        <ErrorState title="Could not load event" description={loadError} />
      </FestivalScreen>
    );
  }

  if (loading) {
    return (
      <FestivalScreen title="Edit event" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title={isEdit ? 'Edit event' : 'New event'}
      subtitle={
        isEdit
          ? `${name || 'This event'} — changes show on the public page as soon as you save.`
          : 'A new event appears in the public catalogue as soon as you create it.'
      }
      back={back}
    >
      <form onSubmit={save} className="flex flex-col gap-5">
        {saveError && (
          <ResultBanner variant="error" title="Could not save">
            <div className="flex flex-col gap-2">
              <p>{saveError}</p>
              <FieldErrors errors={saveFieldErrors} />
            </div>
          </ResultBanner>
        )}

        {/* Two-column on desktop: the long-form content beside the settings. */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Basics">
            <TextInput
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hustlepreneurs"
            />
            <Select
              label="Category"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              options={EVENT_TYPES}
            />
            <TextInput
              label="Poster URL"
              value={poster}
              onChange={(e) => setPoster(e.target.value)}
              placeholder="/images/events/posters/22.avif"
              hint="Leave blank to use the category artwork."
            />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-ink">Description</span>
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the event is, who it's for, and how it runs."
                className="w-full rounded-lg border border-input bg-surface p-3 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <TextInput
              label="Rulebook URL"
              value={rulebook}
              onChange={(e) => setRulebook(e.target.value)}
              placeholder="https://docs.google.com/document/…"
            />
          </Section>

          <div className="flex flex-col gap-5">
            <Section title="Team">
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Min size"
                  type="number"
                  min={1}
                  value={String(teamMin)}
                  onChange={(e) => setTeamMin(Math.max(1, Number(e.target.value) || 1))}
                />
                <TextInput
                  label="Max size"
                  type="number"
                  min={1}
                  value={String(teamMax)}
                  onChange={(e) => setTeamMax(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <Checkbox
                checked={house}
                onChange={setHouse}
                label="Teams must be within one house"
              />
              <Checkbox
                checked={allowSingle}
                onChange={setAllowSingle}
                label="Allow registering without a full team"
              />
            </Section>

            <Section title="Registration">
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Opens"
                  type="datetime-local"
                  value={regStart}
                  onChange={(e) => setRegStart(e.target.value)}
                />
                <TextInput
                  label="Closes"
                  type="datetime-local"
                  value={regEnd}
                  onChange={(e) => setRegEnd(e.target.value)}
                />
              </div>
              <TextInput
                label="Capacity"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 120"
                hint="Entries this event admits. Leave blank if there is no published limit."
              />
            </Section>

            <Section
              title="Entry requirements"
              description="Shown together on the event page under “Before You Go”."
            >
              <TextInput
                label="Reporting time"
                value={reportingTime}
                onChange={(e) => setReportingTime(e.target.value)}
                placeholder="e.g. 30 minutes before your round"
              />
              <TextInput
                label="ID proof required"
                value={idProof}
                onChange={(e) => setIdProof(e.target.value)}
                placeholder="e.g. Institute ID card"
              />
              <TextInput
                label="Allowed items"
                value={allowedItems}
                onChange={(e) => setAllowedItems(e.target.value)}
                placeholder="Laptop, charger, water bottle"
                hint="Comma-separated."
              />
            </Section>
          </div>
        </div>

        <Repeatable
          title="Entry rules"
          description="One rule per line, listed at the gate section of the event page."
          items={entryRules}
          onAdd={() => setEntryRules([...entryRules, ''])}
          onRemove={(i) => setEntryRules(entryRules.filter((_, idx) => idx !== i))}
          render={(rule, i) => (
            <TextInput
              label={`Rule ${i + 1}`}
              value={rule}
              onChange={(e) =>
                setEntryRules(entryRules.map((r, idx) => (idx === i ? e.target.value : r)))
              }
              placeholder="e.g. Entry closes 10 minutes after the round begins."
            />
          )}
        />

        <Repeatable
          title="Prizes"
          description="Shown as tiles on the event page."
          items={prizes}
          onAdd={() => setPrizes([...prizes, { position: '', amount: 0, display: '' }])}
          onRemove={(i) => setPrizes(prizes.filter((_, idx) => idx !== i))}
          render={(prize, i) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <TextInput
                label="Position"
                value={prize.position}
                onChange={(e) => setPrizes(patch(prizes, i, { position: e.target.value }))}
                placeholder="e.g. Winner"
              />
              <TextInput
                label="Amount (₹)"
                type="number"
                min={0}
                value={String(prize.amount)}
                onChange={(e) =>
                  setPrizes(patch(prizes, i, { amount: Number(e.target.value) || 0 }))
                }
              />
              <TextInput
                label="Shown as"
                value={prize.display}
                onChange={(e) => setPrizes(patch(prizes, i, { display: e.target.value }))}
                placeholder="e.g. ₹10000 each"
                hint="Optional. Overrides the amount on the tile."
              />
            </div>
          )}
        />

        <Repeatable
          title="Rounds & timeline"
          description="Each round becomes a numbered step on the event page."
          items={rounds}
          onAdd={() =>
            setRounds([
              ...rounds,
              { name: '', description: '', start_time: '', end_time: '', venue: '', when: '' },
            ])
          }
          onRemove={(i) => setRounds(rounds.filter((_, idx) => idx !== i))}
          render={(round, i) => (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label="Round name"
                  value={round.name}
                  onChange={(e) => setRounds(patch(rounds, i, { name: e.target.value }))}
                  placeholder="e.g. Online Submission"
                />
                <TextInput
                  label="Venue"
                  value={round.venue ?? ''}
                  onChange={(e) => setRounds(patch(rounds, i, { venue: e.target.value }))}
                  placeholder="e.g. KV Ground, or Online"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label="Starts"
                  type="datetime-local"
                  value={round.start_time}
                  onChange={(e) => setRounds(patch(rounds, i, { start_time: e.target.value }))}
                />
                <TextInput
                  label="Ends"
                  type="datetime-local"
                  value={round.end_time}
                  onChange={(e) => setRounds(patch(rounds, i, { end_time: e.target.value }))}
                />
              </div>
              <TextInput
                label="Time shown"
                value={round.when}
                onChange={(e) => setRounds(patch(rounds, i, { when: e.target.value }))}
                placeholder="e.g. 10 Jun, 03:30 pm"
                hint="Optional. Overrides the dates above on the event page."
              />
              <TextInput
                label="Description"
                value={round.description ?? ''}
                onChange={(e) => setRounds(patch(rounds, i, { description: e.target.value }))}
                placeholder="What happens in this round"
              />
            </div>
          )}
        />

        <Repeatable
          title="Detail tiles"
          description="The small labelled tiles beside the poster. Leave this empty to derive them from the team size, rounds, and registration window above."
          items={meta}
          onAdd={() => setMeta([...meta, { label: '', value: '' }])}
          onRemove={(i) => setMeta(meta.filter((_, idx) => idx !== i))}
          render={(row, i) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Label"
                value={row.label}
                onChange={(e) => setMeta(patch(meta, i, { label: e.target.value }))}
                placeholder="e.g. Reg. Start"
              />
              <TextInput
                label="Value"
                value={row.value}
                onChange={(e) => setMeta(patch(meta, i, { value: e.target.value }))}
                placeholder="e.g. 17 May"
              />
            </div>
          )}
        />

        <Repeatable
          title="Registration questions"
          description="Extra details collected from each student when they register."
          items={fields}
          onAdd={() =>
            setFields([
              ...fields,
              { field_id: '', label: '', type: 'text', required: true, options: '' },
            ])
          }
          onRemove={(i) => setFields(fields.filter((_, idx) => idx !== i))}
          render={(field, i) => (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextInput
                  label="Question"
                  value={field.label}
                  onChange={(e) => setFields(patch(fields, i, { label: e.target.value }))}
                  placeholder="e.g. T-shirt size"
                />
                <TextInput
                  label="Field ID"
                  value={field.field_id}
                  onChange={(e) => setFields(patch(fields, i, { field_id: e.target.value }))}
                  placeholder="e.g. tshirt_size"
                  hint="Key the answer is stored under."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Answer type"
                  value={field.type}
                  onChange={(e) => setFields(patch(fields, i, { type: e.target.value }))}
                  options={FIELD_TYPES}
                />
                {field.type === 'select' && (
                  <TextInput
                    label="Choices"
                    value={field.options}
                    onChange={(e) => setFields(patch(fields, i, { options: e.target.value }))}
                    placeholder="S, M, L, XL"
                    hint="Comma-separated."
                  />
                )}
              </div>
              <Checkbox
                checked={field.required}
                onChange={(v) => setFields(patch(fields, i, { required: v }))}
                label="Required"
              />
            </div>
          )}
        />

        <Repeatable
          title="FAQs"
          description="Rendered as the accordion at the bottom of the event page."
          items={faqs}
          onAdd={() => setFaqs([...faqs, { q: '', a: '' }])}
          onRemove={(i) => setFaqs(faqs.filter((_, idx) => idx !== i))}
          render={(faq, i) => (
            <div className="flex flex-col gap-3">
              <TextInput
                label="Question"
                value={faq.q}
                onChange={(e) => setFaqs(patch(faqs, i, { q: e.target.value }))}
              />
              <TextInput
                label="Answer"
                value={faq.a}
                onChange={(e) => setFaqs(patch(faqs, i, { a: e.target.value }))}
              />
            </div>
          )}
        />

        <div className="sticky bottom-0 flex gap-3 border-t border-line bg-canvas/95 py-4 backdrop-blur">
          <Button type="submit" loading={busy}>
            {isEdit ? 'Save changes' : 'Create event'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(ROUTES.adminEvents)}>
            Cancel
          </Button>
        </div>
      </form>

      {/* Outside the form on purpose: assigning a team member is its own route,
          not part of the event's draft, and a submit button inside a form would
          save the event as a side effect of assigning somebody. Only on edit — an
          event must exist before anybody can be put on it. */}
      {isEdit && eventId && (
        <div ref={teamRef} className="mt-8 flex flex-col gap-4">
          <p className="text-sm text-muted">
            The Event Head assigned here is the only person who can run team allocation or move a
            participant between teams — not even a Super Admin can do it for them. Everybody on the
            team gets the attendance scanner for this event.
          </p>
          <EventTeamPanel
            eventId={eventId}
            team={record?.event_team}
            eventType={record?.event_type}
            canManage
            onChanged={refreshRecord}
          />
        </div>
      )}

      {/* Story 8.2. Also edit-only: an announcement is posted against an event
          that already exists, the same reason the team panel above waits for
          one. A Super Admin may always publish here, unlike the staff
          dashboard's own copy of this panel, which is Event-Head-gated. */}
      {isEdit && eventId && (
        <div className="mt-8">
          <EventAnnouncementsPanel state={announcements} canPublish />
        </div>
      )}
    </FestivalScreen>
  );
}

/* --------------------------------------------------------------- helpers --- */

/** Immutably patch item `index` of a list. */
function patch<T>(list: T[], index: number, changes: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...changes } : item));
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-black tracking-tight text-ink">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input text-brand focus:ring-2 focus:ring-brand/30"
      />
      {label}
    </label>
  );
}

function Repeatable<T>({
  title,
  description,
  items,
  onAdd,
  onRemove,
  render,
}: {
  title: string;
  description?: string;
  items: T[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  render: (item: T, index: number) => React.ReactNode;
}) {
  return (
    <Section title={title} description={description}>
      {items.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      <ol className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li key={i} className="relative rounded-2xl bg-surface-2 p-3">
            <button
              type="button"
              onClick={() => onRemove(i)}
              aria-label={`Remove ${title} entry ${i + 1}`}
              className="tap absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-danger-bg hover:text-danger active:scale-90"
            >
              <Trash2 size={15} strokeWidth={2} />
            </button>
            <div className="pr-9">{render(item, i)}</div>
          </li>
        ))}
      </ol>
      <Button type="button" variant="secondary" onClick={onAdd}>
        <Plus size={15} strokeWidth={2.5} /> Add
      </Button>
    </Section>
  );
}
