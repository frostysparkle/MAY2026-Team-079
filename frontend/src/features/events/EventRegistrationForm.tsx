import { useState } from 'react';
import { Pencil, ShieldAlert, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, RegistrationField } from '@/api/types';
import { Button, ResultBanner, Select, TextInput } from '@/components/ui';
import { cn } from '@/lib/cn';
import { currentParticipant } from '@/stores/authStore';
import { optionsForField, readEventExtras } from './eventExtras';
import { eventTeamRoleLabel, eventTeamRoleOf } from './eventTeam';
import { readEventRegisterFailure, type EventRegisterFailure } from './registerOutcome';

/**
 * Registration form for a live event, built from the `registration_fields` the
 * Super Admin configured plus the event's team rule. The backend accepts the
 * answers as a free-form `registration_data` map keyed by `field_id`.
 *
 * `onRegistered` exists for hosts that show registration state of their own — the
 * in-app event page renders a "you're registered" banner and a cancel control, so
 * it has to re-read the registration list once this succeeds. The public brochure
 * passes nothing and keeps the local success banner below.
 *
 * In `mode="edit"` the same fields become the amendment form for
 * `PUT /events/{id}/register`, seeded from the answers already stored. One
 * component for both, because the questions, their types and their dropdown
 * choices all come from the same `registration_fields` — a second form would be
 * the same rendering logic with a different verb, free to drift from it.
 *
 * The team name is create-only: the PUT route sets `registration_data` and
 * nothing else, so offering the field on an edit would show a change that is
 * silently discarded.
 */
export function EventRegistrationForm({
  event,
  mode = 'create',
  initialAnswers,
  onRegistered,
  onCancel,
}: {
  event: Event;
  /** `create` registers; `edit` amends the answers already submitted. */
  mode?: 'create' | 'edit';
  /** `registration_data` as stored, for `mode="edit"`. */
  initialAnswers?: Record<string, unknown>;
  onRegistered?: () => void;
  /** Offered in `mode="edit"` so the participant can back out. */
  onCancel?: () => void;
}) {
  const extras = readEventExtras(event.registration);
  const fields = event.registration_fields ?? [];
  const team = event.team ?? {
    min: 1,
    max: 1,
    house_vs_house_event: false,
    allow_single_registration: true,
  };
  const isEdit = mode === 'edit';
  const isTeamEvent = team.max > 1 && !isEdit;

  /** Create a new team, or join a teammate's by its `team_id`. Solo otherwise. */
  const [teamMode, setTeamMode] = useState<'solo' | 'create' | 'join'>('solo');
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    seedAnswers(fields, initialAnswers),
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<EventRegisterFailure | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Is this participant visibly on the event's team?
   *
   * The backend refuses the registration in that case, so the button should be
   * disabled rather than inviting a certain 403. How far this can be checked
   * up front is limited by the contract, and deliberately not overstated:
   *
   * `GET /events` carries `event_team[].user_id`, and the backend resolves that
   * id against *either* `backend_teams.paradox_id` *or*
   * `participants.participant_id`. When a participant id was assigned directly,
   * the comparison below catches it. When the entry is a `BT…` staff id linked to
   * this participant through `backend_teams.admin_id`, nothing in a participant's
   * session exposes that link — there is no endpoint that returns it — so the
   * refusal is only knowable from the 403. `readEventRegisterFailure` handles that
   * case, and `blocked` below folds it back into the same disabled state, so the
   * button is never live twice for the same doomed attempt.
   */
  const participant = currentParticipant();
  const myTeamRole = eventTeamRoleOf(event.event_team, participant?.id);
  const blocked = myTeamRole !== undefined || failure?.kind === 'on-event-team';

  function setAnswer(fieldId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    setBusy(true);
    try {
      if (isEdit) {
        await api.editEventRegistration(event.event_id, { registration_data: answers });
      } else {
        await api.registerForEvent(event.event_id, {
          team_name:
            isTeamEvent && teamMode === 'create' && teamName.trim() ? teamName.trim() : undefined,
          team_id: isTeamEvent && teamMode === 'join' && teamId.trim() ? teamId.trim() : undefined,
          registration_data: answers,
        });
      }
      setDone(true);
      onRegistered?.();
    } catch (err) {
      const outcome = readEventRegisterFailure(
        err instanceof ApiClientError ? err.status : undefined,
        err instanceof ApiClientError
          ? err.message
          : isEdit
            ? 'Could not save.'
            : 'Could not register.',
      );
      setFailure(outcome);
      // An existing registration is not a failure to recover from — hand the host
      // the same signal a fresh success gives it, so the page swaps in the
      // registered state and its cancel control. Never in edit mode: the
      // registration is the premise there, not the news.
      if (!isEdit && outcome.kind === 'already-registered') setDone(true);
      if (outcome.refreshEvent) onRegistered?.();
    } finally {
      setBusy(false);
    }
  }

  if (!event.registration.is_open) {
    return (
      <ResultBanner
        variant="warning"
        title={
          isEdit
            ? 'Registration has closed, so answers can no longer be changed'
            : 'Registration is closed for this event'
        }
      />
    );
  }

  if (done) {
    return (
      <ResultBanner
        variant="success"
        title={isEdit ? 'Your answers have been updated' : "You're registered for this event"}
      />
    );
  }

  // Rendered instead of the form, not over it: filling in answers that cannot be
  // submitted is worse than not being offered the fields at all. Not in edit mode,
  // where holding a registration already proves the participant is not on the team.
  if (blocked && !isEdit) {
    return (
      <ResultBanner variant="warning" title="You’re on this event’s team">
        <div className="flex flex-col gap-1">
          <p>
            {myTeamRole
              ? `You are this event's ${eventTeamRoleLabel(myTeamRole)}, and team members cannot enter their own event as participants.`
              : 'Staff and volunteers running an event cannot enter it as participants.'}
          </p>
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert size={13} strokeWidth={2.25} className="shrink-0" />
            You can still scan attendance for it from the staff area.
          </p>
        </div>
      </ResultBanner>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line/70"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        {isEdit ? (
          <>
            <Pencil size={15} strokeWidth={2.25} className="text-brand" />
            Update your answers
          </>
        ) : (
          <>
            <Users size={15} strokeWidth={2.25} className="text-brand" />
            {isTeamEvent ? `Team of ${team.min}–${team.max}` : 'Individual entry'}
          </>
        )}
      </p>

      {isEdit && fields.length === 0 && (
        <p className="text-sm text-muted">
          This event asks no registration questions, so there is nothing to change. Your entry is
          confirmed as it stands.
        </p>
      )}

      {failure && (
        <ResultBanner variant={failure.tone} title={failure.title}>
          {failure.description}
        </ResultBanner>
      )}

      {isTeamEvent && (
        <div className="flex flex-col gap-2">
          {/* Solo is offered here only when the event actually allows it — the
              backend refuses a solo entry otherwise (`team.allow_single_registration`). */}
          <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
            {(
              [
                ...(team.allow_single_registration
                  ? [{ key: 'solo' as const, label: 'Solo' }]
                  : []),
                { key: 'create' as const, label: 'Create a team' },
                { key: 'join' as const, label: 'Join a team' },
              ] as const
            ).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTeamMode(option.key)}
                aria-pressed={teamMode === option.key}
                className={cn(
                  'tap flex-1 rounded-lg py-2 text-xs font-semibold',
                  teamMode === option.key ? 'bg-surface text-brand shadow-card' : 'text-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {teamMode === 'create' && (
            <TextInput
              label="Team name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Your team's name"
              hint="You become the team's leader. Share the team id you get back with your teammates so they can join."
            />
          )}

          {teamMode === 'join' && (
            <TextInput
              label="Team id"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              placeholder="e.g. TMSPO111111"
              hint="Ask your team's leader for the id they were given when they created it."
            />
          )}
        </div>
      )}

      {fields.map((field) => (
        <RegistrationFieldInput
          key={field.field_id}
          field={field}
          options={optionsForField(extras, field)}
          value={answers[field.field_id] ?? ''}
          onChange={(v) => setAnswer(field.field_id, v)}
        />
      ))}

      {/* Disabled after a refusal that another attempt cannot fix, so a closed
          event or a duplicate entry is not offered a second doomed submit. */}
      <div className={isEdit ? 'flex flex-wrap gap-2' : undefined}>
        <Button
          type="submit"
          fullWidth={!isEdit}
          loading={busy}
          disabled={
            busy ||
            (failure !== null && !failure.retryable) ||
            (isTeamEvent && teamMode === 'join' && !teamId.trim())
          }
        >
          {isEdit ? 'Save answers' : 'Register'}
        </Button>
        {isEdit && onCancel && (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The stored `registration_data` as form state.
 *
 * Values come back as `unknown` — the backend stores whatever was sent — so each
 * is narrowed to the string an input can hold. A checkbox field round-trips as
 * `"true"`/`"false"` because that is what this form writes for it, and only keys
 * the event still asks about are kept: a question the admin has since removed
 * should not be resubmitted invisibly.
 */
function seedAnswers(
  fields: readonly RegistrationField[],
  stored: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!stored) return {};
  const seeded: Record<string, string> = {};
  for (const field of fields) {
    const value = stored[field.field_id];
    if (value === undefined || value === null) continue;
    seeded[field.field_id] =
      typeof value === 'string'
        ? value
        : typeof value === 'boolean'
          ? String(value)
          : String(value);
  }
  return seeded;
}

/** One admin-configured field. `select` renders a dropdown when choices exist. */
function RegistrationFieldInput({
  field,
  options,
  value,
  onChange,
}: {
  field: RegistrationField;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.type === 'select' && options.length > 0) {
    return (
      <Select
        label={field.label}
        required={field.required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={[{ value: '', label: 'Select…' }, ...options.map((o) => ({ value: o, label: o }))]}
      />
    );
  }

  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          checked={value === 'true'}
          required={field.required}
          onChange={(e) => onChange(String(e.target.checked))}
          className="h-4 w-4 rounded border-input text-brand focus:ring-2 focus:ring-brand/30"
        />
        {field.label}
      </label>
    );
  }

  return (
    <TextInput
      label={field.label}
      required={field.required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      type={inputTypeFor(field.type)}
    />
  );
}

/** Map the backend's field vocabulary onto real HTML input types. */
function inputTypeFor(type: string): 'text' | 'number' | 'email' | 'tel' | 'url' {
  switch (type) {
    case 'number':
      return 'number';
    case 'email':
      return 'email';
    case 'phone':
      return 'tel';
    case 'url':
      return 'url';
    default:
      return 'text';
  }
}
