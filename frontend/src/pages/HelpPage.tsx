import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type {
  Contact,
  QueryCategory,
  RaiseQueryRequest,
  SupportQuery,
} from '@/api/types';
import { toast } from '@/stores/uiStore';
import { Button, Card, ResultBanner, Select, Skeleton, EmptyState } from '@/components/ui';

const CATEGORIES: { value: QueryCategory; label: string }[] = [
  { value: 'event', label: 'Event' },
  { value: 'hostel', label: 'Hostel' },
  { value: 'mess', label: 'Mess' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'lost_item', label: 'Lost item' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABEL: Record<SupportQuery['status'], string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

const STATUS_BADGE: Record<SupportQuery['status'], string> = {
  open: 'bg-surface-2 text-muted',
  assigned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-green-100 text-green-700',
};

/**
 * Help & Support (Epic 6): raise a query, track your own queries, and reach the
 * emergency/support contact directory without needing to submit anything first.
 */
export default function HelpPage() {
  const [myQueries, setMyQueries] = useState<SupportQuery[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // A caller (e.g. the Mess screen) can pre-fill the category via route state.
  const location = useLocation();
  const prefillCategory = (location.state as { category?: QueryCategory } | null)?.category;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RaiseQueryRequest>({
    defaultValues: prefillCategory ? { category: prefillCategory } : undefined,
  });

  async function load() {
    setLoading(true);
    try {
      const [q, c] = await Promise.all([api.listMyQueries(), api.listContacts()]);
      setMyQueries(q.queries);
      setContacts(c.contacts);
    } catch {
      /* individual sections show their own empty states */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(values: RaiseQueryRequest) {
    setSubmitError(null);
    try {
      const created = await api.raiseQuery(values);
      setMyQueries((prev) => [created, ...prev]);
      reset({ category: undefined, description: '' });
      toast.success('Query submitted.');
    } catch (e) {
      setSubmitError(
        e instanceof ApiClientError ? e.message : 'Could not submit your query. Please try again.',
      );
    }
  }

  const emergency = contacts.filter((c) => c.isEmergency);
  const directory = contacts.filter((c) => !c.isEmergency);

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Help &amp; Support</h1>
        <p className="text-sm text-muted">Raise a query or find the right contact.</p>
      </div>

      {/* Emergency contacts — always visible, no query needed (FR-6.5). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Emergency contacts</h2>
        {loading ? (
          <Skeleton className="h-16" />
        ) : emergency.length === 0 ? (
          <p className="text-sm text-muted">No emergency contacts published yet.</p>
        ) : (
          emergency.map((c) => <ContactRow key={c.id} contact={c} highlight />)
        )}
      </section>

      {/* Raise a query (FR-6.1). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Raise a query</h2>
        {submitError && (
          <ResultBanner variant="error" title="Could not submit">
            {submitError}
          </ResultBanner>
        )}
        <form className="flex flex-col gap-3" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Select
            label="Category"
            required
            placeholder="Select a category"
            options={CATEGORIES}
            error={errors.category?.message}
            {...register('category', { required: 'Please choose a category.' })}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="description" className="text-sm font-medium text-ink">
              Description <span className="text-danger">*</span>
            </label>
            <textarea
              id="description"
              rows={3}
              aria-invalid={errors.description ? true : undefined}
              className="rounded-lg border border-line px-3 py-2.5 text-sm outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/30"
              {...register('description', { required: 'Please describe your issue.' })}
            />
            {errors.description && (
              <p role="alert" className="text-xs text-danger">
                {errors.description.message}
              </p>
            )}
          </div>
          <Button type="submit" loading={isSubmitting}>
            Submit query
          </Button>
        </form>
      </section>

      {/* Track my queries (FR-6.2). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">My queries</h2>
        {loading ? (
          <Skeleton className="h-16" />
        ) : myQueries.length === 0 ? (
          <EmptyState title="No queries yet" description="Anything you raise shows up here." icon="💬" />
        ) : (
          myQueries.map((q) => (
            <Card key={q.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">
                  {q.category.replace('_', ' ')}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[q.status]}`}
                >
                  {STATUS_LABEL[q.status]}
                </span>
              </div>
              <p className="text-sm text-ink">{q.description}</p>
            </Card>
          ))
        )}
      </section>

      {/* Contact directory (FR-6.4). */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Contact directory</h2>
        {loading ? (
          <Skeleton className="h-16" />
        ) : directory.length === 0 ? (
          <p className="text-sm text-muted">No contacts published yet.</p>
        ) : (
          directory.map((c) => <ContactRow key={c.id} contact={c} />)
        )}
      </section>
    </div>
  );
}

function ContactRow({ contact, highlight }: { contact: Contact; highlight?: boolean }) {
  return (
    <Card className={highlight ? 'border-danger/40 bg-danger/5' : undefined}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">{contact.name}</p>
          <p className="truncate text-xs text-muted">
            {contact.role} · {contact.category}
          </p>
        </div>
        <a
          href={`tel:${contact.phone}`}
          className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
        >
          Call
        </a>
      </div>
    </Card>
  );
}
