import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api';
import type { Journey, PendingPayments } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { Button, Card, ErrorState, Skeleton } from '@/components/ui';

function money(amount: number, currency: string) {
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

/**
 * Payment step. Summarises the bookings the student chose but hasn't paid for
 * (Req 6) and hands off to the dedicated Payments screen for the hosted
 * checkout. Returning to onboarding after paying resumes at the next step.
 */
export function PaymentStep({ journey }: { journey: Journey }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingPayments | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');

  async function load() {
    setStatus('loading');
    try {
      setPending(await api.getPendingPayments());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (status === 'loading') return <Skeleton className="h-48" />;
  if (status === 'error' || !pending) {
    return <ErrorState description="Could not load pending payments." onRetry={() => void load()} />;
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-ink">Complete your payment</h2>
        <p className="mt-1 text-sm text-muted">
          Pay for the bookings you selected to confirm them.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {pending.items.map((item) => (
          <li
            key={item.kind}
            className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
          >
            <span className="text-ink">{item.label}</span>
            <span className="font-semibold text-ink">
              {money(item.amount, item.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-line pt-3 text-sm">
        <span className="font-medium text-muted">Total due</span>
        <span className="text-lg font-black text-ink">
          {money(pending.total, pending.currency)}
        </span>
      </div>

      {!journey.accommodation.allocated && journey.accommodation.choice === 'yes' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Your room is assigned by the hostel team. You can pay the hostel fee once a room is
          allocated to you.
        </p>
      )}

      <Button fullWidth onClick={() => navigate(ROUTES.payments)}>
        Go to payment
      </Button>
    </Card>
  );
}
