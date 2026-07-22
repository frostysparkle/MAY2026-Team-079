import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { Announcement, Audience, CreateAnnouncementRequest, EventItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { toast } from '@/stores/uiStore';
import { Button, Card, Select, TextInput, Skeleton } from '@/components/ui';

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all_participants', label: 'All participants' },
  { value: 'event_registrants', label: 'Event registrants' },
  { value: 'hostel_residents', label: 'Hostel residents' },
  { value: 'pors', label: 'PORs / Coordinators' },
];

type FormValues = CreateAnnouncementRequest;

/**
 * Send official announcements (Epic 8, FR-8.1). Admin+ only. Scoped to one of
 * the four audience groups; an event must be chosen for the event-registrants
 * audience. Every announcement is logged for accountability.
 */
export default function AdminAnnouncementsPage() {
  const navigate = useNavigate();
  const [log, setLog] = useState<Announcement[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { audience: 'all_participants' } });

  const audience = watch('audience');

  async function load() {
    setLoading(true);
    try {
      const [a, e] = await Promise.all([api.listAllAnnouncements(), api.listEvents()]);
      setLog(a.announcements);
      setEvents(e.events);
    } catch {
      toast.error('Could not load announcements.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function send(values: FormValues) {
    try {
      const created = await api.createAnnouncement({
        ...values,
        eventId: values.audience === 'event_registrants' ? values.eventId : null,
      });
      setLog((l) => [created, ...l]);
      reset({ title: '', body: '', audience: 'all_participants', eventId: null });
      toast.success('Announcement sent.');
    } catch {
      toast.error('Could not send (event required for event registrants?).');
    }
  }

  async function remove(id: string) {
    const previous = log;
    setLog((l) => l.filter((x) => x.id !== id));
    try {
      await api.deleteAnnouncement(id);
      toast.success('Announcement deleted.');
    } catch {
      setLog(previous);
      toast.error('Could not delete.');
    }
  }

  return (
    <AdminScreen
      title="Announcements"
      subtitle="Send official updates to a group."
      onBack={() => navigate(ROUTES.home)}
    >

      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={handleSubmit(send)} noValidate>
        <p className="text-sm font-semibold text-gray-800">Compose</p>
        <TextInput
          label="Title"
          required
          error={errors.title?.message}
          {...register('title', { required: 'Title is required.' })}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="body" className="text-sm font-medium text-gray-700">
            Message <span className="text-danger">*</span>
          </label>
          <textarea
            id="body"
            rows={4}
            aria-invalid={errors.body ? true : undefined}
            className="rounded-lg border border-line px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            {...register('body', { required: 'Message is required.' })}
          />
          {errors.body && (
            <p role="alert" className="text-xs text-danger">
              {errors.body.message}
            </p>
          )}
        </div>
        <Select
          label="Audience"
          required
          options={AUDIENCES}
          error={errors.audience?.message}
          {...register('audience', { required: 'Audience is required.' })}
        />
        {audience === 'event_registrants' && (
          <Select
            label="Event"
            required
            placeholder="Select an event"
            options={events.map((e) => ({ value: e.id, label: `${e.title} · ${e.eventDate}` }))}
            error={errors.eventId?.message}
            {...register('eventId', { required: 'Choose an event for this audience.' })}
          />
        )}
        <Button type="submit" loading={isSubmitting}>
          Send announcement
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-800">Sent log</p>
        {loading && <Skeleton className="h-20" />}
        {!loading && log.length === 0 && <p className="text-sm text-muted">Nothing sent yet.</p>}
        {!loading &&
          log.map((a) => (
            <Card key={a.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{a.title}</p>
                <p className="truncate text-xs text-muted">
                  {a.audience.replace('_', ' ')} · {a.senderName ?? 'Core Team'} ·{' '}
                  {a.createdAt.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(a.id)}
                className="shrink-0 text-xs font-medium text-danger hover:underline"
              >
                Delete
              </button>
            </Card>
          ))}
      </div>
    </AdminScreen>
  );
}
