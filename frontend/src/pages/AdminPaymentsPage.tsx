import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { CreateMealPlanRequest, MealPlan, ReconciliationItem } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { toast } from '@/stores/uiStore';
import { Button, Card, Select, TextInput, Skeleton } from '@/components/ui';

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  not_started: 'bg-gray-100 text-gray-600',
};

const FILTERS = ['all', 'paid', 'pending', 'failed', 'not_started'] as const;

/**
 * Payments admin (Epic 10): manage mess meal plans (FR-10.2 config) and
 * reconcile hostel/mess payment status per participant (FR-10.4). Admin+ only.
 */
export default function AdminPaymentsPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [rows, setRows] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostelFilter, setHostelFilter] = useState<(typeof FILTERS)[number]>('all');
  const [messFilter, setMessFilter] = useState<(typeof FILTERS)[number]>('all');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateMealPlanRequest>();

  async function load() {
    setLoading(true);
    try {
      const [pl, rec] = await Promise.all([api.listMealPlans(), api.getReconciliation()]);
      setPlans(pl.plans);
      setRows(rec.participants);
    } catch {
      toast.error('Could not load payments data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addPlan(values: CreateMealPlanRequest) {
    try {
      const created = await api.createMealPlan({ ...values, amount: Number(values.amount) });
      setPlans((p) => [...p, created]);
      reset({ name: '', description: '', amount: undefined });
      toast.success('Plan added.');
    } catch {
      toast.error('Could not add the plan.');
    }
  }

  async function removePlan(id: string) {
    const previous = plans;
    setPlans((p) => p.filter((x) => x.id !== id));
    try {
      await api.deleteMealPlan(id);
      toast.success('Plan removed.');
    } catch {
      setPlans(previous);
      toast.error('Could not remove the plan.');
    }
  }

  const filtered = rows.filter(
    (r) =>
      (hostelFilter === 'all' || r.hostelStatus === hostelFilter) &&
      (messFilter === 'all' || r.messStatus === messFilter),
  );

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-muted">Meal plans and reconciliation.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate(ROUTES.home)}
          className="text-sm text-muted hover:text-brand"
        >
          ← Home
        </button>
      </div>

      {/* Meal plan management (FR-10.2 config). */}
      <form className="flex flex-col gap-3 rounded-xl border border-line p-4" onSubmit={handleSubmit(addPlan)} noValidate>
        <p className="text-sm font-semibold text-gray-800">Add meal plan</p>
        <TextInput
          label="Name"
          required
          error={errors.name?.message}
          {...register('name', { required: 'Name is required.' })}
        />
        <TextInput label="Description" {...register('description')} />
        <TextInput
          label="Amount (₹)"
          type="number"
          required
          error={errors.amount?.message}
          {...register('amount', {
            required: 'Amount is required.',
            valueAsNumber: true,
            min: { value: 1, message: 'Amount must be at least ₹1.' },
          })}
        />
        <Button type="submit" loading={isSubmitting}>
          Add plan
        </Button>
      </form>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-800">Meal plans</p>
        {loading && <Skeleton className="h-16" />}
        {!loading &&
          plans.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">
                  {p.name} · ₹{p.amount}
                </p>
                <p className="truncate text-xs text-muted">{p.description || '—'}</p>
              </div>
              <button
                type="button"
                onClick={() => void removePlan(p.id)}
                className="shrink-0 text-xs font-medium text-danger hover:underline"
              >
                Remove
              </button>
            </Card>
          ))}
      </div>

      {/* Reconciliation (FR-10.4). */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-gray-800">Reconciliation</p>
        <div className="flex gap-3">
          <Select
            label="Hostel"
            value={hostelFilter}
            onChange={(e) => setHostelFilter(e.target.value as (typeof FILTERS)[number])}
            options={FILTERS.map((f) => ({ value: f, label: f.replace('_', ' ') }))}
          />
          <Select
            label="Mess"
            value={messFilter}
            onChange={(e) => setMessFilter(e.target.value as (typeof FILTERS)[number])}
            options={FILTERS.map((f) => ({ value: f, label: f.replace('_', ' ') }))}
          />
        </div>
        {loading && <Skeleton className="h-16" />}
        {!loading && filtered.length === 0 && (
          <p className="text-sm text-muted">No participants match these filters.</p>
        )}
        {!loading &&
          filtered.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">
                  {r.fullName || '(profile incomplete)'}
                </p>
                <p className="truncate text-xs text-muted">{r.email}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.hostelStatus]}`}>
                  H: {r.hostelStatus.replace('_', ' ')}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.messStatus]}`}>
                  M: {r.messStatus.replace('_', ' ')}
                </span>
              </div>
            </Card>
          ))}
      </div>
    </main>
  );
}
