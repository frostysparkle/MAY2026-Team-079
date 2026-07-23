import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type {
  CreateMessMenuRequest,
  Meal,
  MessEligibilityItem,
  MessMenuItem,
} from '@/api/types';
import { ROUTES } from '@/config/routes';
import { AdminScreen } from '@/components/layout/AdminScreen';
import { hasRoleAtLeast } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { Button, Card, Select, TextInput, Skeleton } from '@/components/ui';

const MEALS: { value: Meal; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'snacks', label: 'Snacks' },
  { value: 'dinner', label: 'Dinner' },
];

/**
 * Mess management (Epic 4): menu CRUD for organizers+, plus mess-pass
 * eligibility control and the opt-in count for admins+ (FR-4.1/4.2/4.4).
 */
export default function AdminMessPage() {
  const navigate = useNavigate();
  const isAdmin = hasRoleAtLeast('admin');

  const [menu, setMenu] = useState<MessMenuItem[]>([]);
  const [eligibility, setEligibility] = useState<MessEligibilityItem[]>([]);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateMessMenuRequest>();

  async function load() {
    setLoading(true);
    try {
      const m = await api.listMessMenu();
      setMenu(m.items);
      if (isAdmin) {
        const [e, s] = await Promise.all([api.listMessEligibility(), api.getMessStats()]);
        setEligibility(e.participants);
        setEligibleCount(s.eligibleCount);
      }
    } catch {
      toast.error('Could not load mess data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addItem(values: CreateMessMenuRequest) {
    try {
      const created = await api.createMessMenu(values);
      setMenu((m) => [...m, created]);
      reset({ location: '', meal: undefined, items: '', startTime: '', endTime: '' });
      toast.success('Menu entry added.');
    } catch {
      toast.error('Could not add the entry (duplicate location + meal?).');
    }
  }

  async function removeItem(id: string) {
    const previous = menu;
    setMenu((m) => m.filter((x) => x.id !== id));
    try {
      await api.deleteMessMenu(id);
      toast.success('Entry removed.');
    } catch {
      setMenu(previous);
      toast.error('Could not remove the entry.');
    }
  }

  async function toggleEligibility(item: MessEligibilityItem) {
    const next = !item.eligible;
    const previous = eligibility;
    setEligibility((list) => list.map((x) => (x.id === item.id ? { ...x, eligible: next } : x)));
    setEligibleCount((c) => (c === null ? c : c + (next ? 1 : -1)));
    try {
      await api.setMessEligibility(item.id, next);
    } catch {
      setEligibility(previous);
      setEligibleCount((c) => (c === null ? c : c + (next ? -1 : 1)));
      toast.error('Could not update eligibility.');
    }
  }

  return (
    <AdminScreen
      title="Mess Management"
      subtitle="Menu, timings, and mess passes."
      onBack={() => navigate(ROUTES.home)}
    >

      {/* Menu management (organizer+). */}
      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={handleSubmit(addItem)} noValidate>
        <p className="text-sm font-semibold text-ink">Add menu entry</p>
        <TextInput
          label="Location"
          required
          error={errors.location?.message}
          {...register('location', { required: 'Location is required.' })}
        />
        <Select
          label="Meal"
          required
          placeholder="Select a meal"
          options={MEALS}
          error={errors.meal?.message}
          {...register('meal', { required: 'Meal is required.' })}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Start"
            type="time"
            required
            error={errors.startTime?.message}
            {...register('startTime', { required: 'Required.' })}
          />
          <TextInput
            label="End"
            type="time"
            required
            error={errors.endTime?.message}
            {...register('endTime', { required: 'Required.' })}
          />
        </div>
        <TextInput
          label="Items"
          required
          error={errors.items?.message}
          {...register('items', { required: 'Items are required.' })}
        />
        <Button type="submit" loading={isSubmitting}>
          Add entry
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink">Current menu</p>
        {loading && <Skeleton className="h-16" />}
        {!loading &&
          menu.map((m) => (
            <Card key={m.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">
                  {m.location} · {m.meal}
                </p>
                <p className="truncate text-xs text-muted">
                  {m.startTime}–{m.endTime} · {m.items}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void removeItem(m.id)}
                className="shrink-0 text-xs font-medium text-danger hover:underline"
              >
                Remove
              </button>
            </Card>
          ))}
      </div>

      {/* Mess passes (admin+). */}
      {isAdmin && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink">Mess passes</p>
            {eligibleCount !== null && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                {eligibleCount} opted in
              </span>
            )}
          </div>
          {loading && <Skeleton className="h-16" />}
          {!loading &&
            eligibility.map((p) => (
              <Card key={p.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {p.fullName || '(profile incomplete)'}
                  </p>
                  <p className="truncate text-xs text-muted">{p.email}</p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={p.eligible}
                    onChange={() => void toggleEligibility(p)}
                    aria-label={`Mess pass for ${p.email}`}
                  />
                  Eligible
                </label>
              </Card>
            ))}
        </div>
      )}
    </AdminScreen>
  );
}
