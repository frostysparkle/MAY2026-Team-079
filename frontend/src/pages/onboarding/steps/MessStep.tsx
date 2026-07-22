import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { MealPlan, OnboardingChoice } from '@/api/types';
import { Button, Card, ResultBanner, Select, Skeleton } from '@/components/ui';

function money(amount: number, currency: string) {
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

/**
 * Mess / meal-plan intent (optional). Choosing "yes" requires selecting an
 * active plan; the fee is settled in the payment step (Req 5).
 */
export function MessStep({ onDone }: { onDone: () => Promise<void> }) {
  const [plans, setPlans] = useState<MealPlan[] | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState<OnboardingChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .listMealPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, []);

  async function choose(choice: OnboardingChoice) {
    setError(null);
    if (choice === 'yes' && !selected) {
      setError('Please pick a meal plan to continue.');
      return;
    }
    setBusy(choice);
    try {
      await api.setMessChoice(choice, choice === 'yes' ? selected : undefined);
      await onDone();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save your choice. Try again.');
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-ink">Add a meal plan?</h2>
        <p className="mt-1 text-sm text-muted">
          Get mess access for the fest. Optional — skip if you’ll eat off-campus.
        </p>
      </div>

      {error && (
        <ResultBanner variant="error" title="Meal plan">
          {error}
        </ResultBanner>
      )}

      {plans === null ? (
        <Skeleton className="h-12" />
      ) : (
        <Select
          label="Meal plan"
          placeholder="Select a plan"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={plans.map((p) => ({
            value: p.id,
            label: `${p.name} — ${money(p.amount, p.currency)}`,
          }))}
        />
      )}

      <div className="flex flex-col gap-2">
        <Button fullWidth loading={busy === 'yes'} onClick={() => void choose('yes')}>
          Add this plan
        </Button>
        <Button
          fullWidth
          variant="secondary"
          loading={busy === 'no'}
          onClick={() => void choose('no')}
        >
          No meal plan, thanks
        </Button>
      </div>
    </Card>
  );
}
