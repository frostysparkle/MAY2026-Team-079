import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { CreateEventRequest, EventStatus } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Button, ResultBanner, Select, TextInput, Spinner } from '@/components/ui';
import { AdminScreen } from '@/components/layout/AdminScreen';

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'cancelled', label: 'Cancelled' },
];

type FormValues = CreateEventRequest;

/**
 * Create or edit an event (FR-1.3). Organizer+ only (route-guarded; the backend
 * also enforces it). Editing loads the event and pre-fills the form; publishing
 * requires every field, which the required inputs enforce before submit.
 */
export default function EventEditPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { status: 'draft', capacity: 100 } });

  const [loading, setLoading] = useState(isEdit);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const e = await api.getEvent(id);
        if (cancelled) return;
        reset({
          title: e.title,
          venue: e.venue,
          eventDate: e.eventDate,
          startTime: e.startTime,
          endTime: e.endTime,
          capacity: e.capacity,
          instructions: e.instructions,
          status: e.status,
        });
      } catch {
        if (!cancelled) setSubmitError('Could not load this event.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isEdit, reset]);

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      const saved = isEdit && id ? await api.updateEvent(id, values) : await api.createEvent(values);
      navigate(ROUTES.eventDetail(saved.id), { replace: true });
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : 'Could not save the event. Please try again.',
      );
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Spinner size={28} label="Loading event" />
      </div>
    );
  }

  return (
    <AdminScreen
      title={isEdit ? 'Edit Event' : 'New Event'}
      subtitle={isEdit ? 'Update the details below.' : 'Fill in the details below.'}
      onBack={() => navigate(ROUTES.events)}
    >
      {submitError && (
        <ResultBanner variant="error" title="Could not save">
          {submitError}
        </ResultBanner>
      )}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextInput
          label="Title"
          required
          error={errors.title?.message}
          {...register('title', { required: 'Title is required.' })}
        />
        <TextInput
          label="Venue"
          required
          error={errors.venue?.message}
          {...register('venue', { required: 'Venue is required.' })}
        />
        <TextInput
          label="Date"
          type="date"
          required
          error={errors.eventDate?.message}
          {...register('eventDate', { required: 'Date is required.' })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Start time"
            type="time"
            required
            error={errors.startTime?.message}
            {...register('startTime', { required: 'Required.' })}
          />
          <TextInput
            label="End time"
            type="time"
            required
            error={errors.endTime?.message}
            {...register('endTime', { required: 'Required.' })}
          />
        </div>
        <TextInput
          label="Capacity"
          type="number"
          required
          error={errors.capacity?.message}
          {...register('capacity', {
            required: 'Capacity is required.',
            valueAsNumber: true,
            min: { value: 1, message: 'Capacity must be at least 1.' },
          })}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="instructions" className="text-sm font-medium text-ink">
            Entry instructions <span className="text-danger">*</span>
          </label>
          <textarea
            id="instructions"
            rows={4}
            aria-invalid={errors.instructions ? true : undefined}
            className="rounded-lg border border-line px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
            {...register('instructions', { required: 'Instructions are required to publish.' })}
          />
          {errors.instructions && (
            <p role="alert" className="text-xs text-danger">
              {errors.instructions.message}
            </p>
          )}
        </div>

        <Select
          label="Status"
          options={STATUS_OPTIONS}
          error={errors.status?.message}
          {...register('status', { required: 'Status is required.' })}
        />

        <Button type="submit" fullWidth loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Create event'}
        </Button>
      </form>
    </AdminScreen>
  );
}
