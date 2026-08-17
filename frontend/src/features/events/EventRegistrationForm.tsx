import { useState } from 'react';
import { Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Event, RegistrationField } from '@/api/types';
import { Button, ResultBanner, Select, TextInput } from '@/components/ui';
import { optionsForField, readEventExtras } from './eventExtras';

/**
 * Registration form for a live event, built from the `registration_fields` the
 * Super Admin configured plus the event's team rule. The backend accepts the
 * answers as a free-form `registration_data` map keyed by `field_id`.
 *
 * `onRegistered` exists for hosts that show registration state of their own — the
 * in-app event page renders a "you're registered" banner and a cancel control, so
 * it has to re-read the registration list once this succeeds. The public brochure
 * passes nothing and keeps the local success banner below.
 */
export function EventRegistrationForm({
  event,
  onRegistered,
}: {
  event: Event;
  onRegistered?: () => void;
}) {
  const extras = readEventExtras(event.registration);
  const fields = event.registration_fields ?? [];
  const team = event.team ?? { min: 1, max: 1, house: false, allow_single_registration: true };
  const isTeamEvent = team.max > 1;

  const [teamName, setTeamName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setAnswer(fieldId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.registerForEvent(event.event_id, {
        team_name: isTeamEvent && teamName.trim() ? teamName.trim() : undefined,
        registration_data: answers,
      });
      setDone(true);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not register.');
    } finally {
      setBusy(false);
    }
  }

  if (!event.open) {
    return <ResultBanner variant="warning" title="Registration is closed for this event" />;
  }

  if (done) {
    return <ResultBanner variant="success" title="You're registered for this event" />;
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line/70"
    >
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Users size={15} strokeWidth={2.25} className="text-brand" />
        {isTeamEvent ? `Team of ${team.min}–${team.max}` : 'Individual entry'}
      </p>

      {error && (
        <ResultBanner variant="error" title="Could not register">
          {error}
        </ResultBanner>
      )}

      {isTeamEvent && (
        <TextInput
          label="Team name"
          required={!team.allow_single_registration}
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="Your team's name"
        />
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

      <Button type="submit" fullWidth loading={busy}>
        Register
      </Button>
    </form>
  );
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
