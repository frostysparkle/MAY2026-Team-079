import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { Contact, ContactCategory, CreateContactRequest } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { toast } from '@/stores/uiStore';
import { Button, Card, Select, TextInput, Skeleton, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

const CATEGORIES: { value: ContactCategory; label: string }[] = [
  { value: 'hostel', label: 'Hostel' },
  { value: 'mess', label: 'Mess' },
  { value: 'event', label: 'Event' },
  { value: 'security', label: 'Security' },
  { value: 'general', label: 'General' },
];

type FormValues = CreateContactRequest & { isEmergency: boolean };

/**
 * Contact directory management (FR-6.4). Admin+ only. Add contacts (optionally
 * flagged as emergency) and remove them; the directory is the single source the
 * participant Help screen reads from.
 */
export default function AdminContactsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');
  const [contacts, setContacts] = useState<Contact[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { isEmergency: false } });

  async function load() {
    setStatus('loading');
    try {
      const { contacts } = await api.listContacts();
      setContacts(contacts);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(values: FormValues) {
    try {
      const created = await api.createContact(values);
      setContacts((c) => [...c, created]);
      reset({ name: '', role: '', phone: '', email: '', category: undefined, isEmergency: false });
      toast.success('Contact added.');
    } catch {
      toast.error('Could not add the contact.');
    }
  }

  async function remove(id: string) {
    const previous = contacts;
    setContacts((c) => c.filter((x) => x.id !== id));
    try {
      await api.deleteContact(id);
      toast.success('Contact removed.');
    } catch {
      setContacts(previous);
      toast.error('Could not remove the contact.');
    }
  }

  return (
    <AdminScreen
      title="Contact Directory"
      subtitle="Maintain support and emergency contacts."
      onBack={() => navigate(ROUTES.home)}
    >

      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <p className="text-sm font-semibold text-ink">Add a contact</p>
        <TextInput
          label="Name"
          required
          error={errors.name?.message}
          {...register('name', { required: 'Name is required.' })}
        />
        <TextInput
          label="Role / description"
          required
          error={errors.role?.message}
          {...register('role', { required: 'Role is required.' })}
        />
        <Select
          label="Category"
          required
          placeholder="Select a category"
          options={CATEGORIES}
          error={errors.category?.message}
          {...register('category', { required: 'Category is required.' })}
        />
        <TextInput
          label="Phone"
          required
          error={errors.phone?.message}
          {...register('phone', { required: 'Phone is required.' })}
        />
        <TextInput label="Email (optional)" type="email" {...register('email')} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" {...register('isEmergency')} />
          Show in emergency contacts
        </label>
        <Button type="submit" loading={isSubmitting}>
          Add contact
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Current contacts</p>
        {status === 'loading' && <Skeleton className="h-20" />}
        {status === 'error' && (
          <ErrorState description="Could not load contacts." onRetry={() => void load()} />
        )}
        {status === 'loaded' &&
          contacts.map((c) => (
            <Card key={c.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {c.name}
                  {c.isEmergency && (
                    <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      emergency
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">
                  {c.role} · {c.category} · {c.phone}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(c.id)}
                className="shrink-0 text-xs font-medium text-danger hover:underline"
              >
                Remove
              </button>
            </Card>
          ))}
      </div>
    </AdminScreen>
  );
}
