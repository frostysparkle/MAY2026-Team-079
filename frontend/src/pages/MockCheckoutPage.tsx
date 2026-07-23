import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/api';
import { ROUTES } from '@/config/routes';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Button, Card } from '@/components/ui';

/**
 * Simulated hosted checkout (mock gateway only). Stands in for the third-party
 * provider's page: no card data is handled here or sent to our servers —
 * "Pay" / "Cancel" ask the backend mock to emit a signed webhook, exactly like
 * a real gateway would. A real provider replaces this with its own hosted page.
 */
export default function MockCheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session = params.get('session') ?? '';
  const amount = params.get('amount') ?? '';
  const currency = params.get('currency') ?? 'INR';
  const [busy, setBusy] = useState(false);

  async function settle(outcome: 'paid' | 'failed') {
    if (!session) return;
    setBusy(true);
    try {
      await api.mockSettlePayment(session, outcome);
    } catch {
      /* surfaced on the payments screen */
    } finally {
      navigate(ROUTES.payments, { replace: true });
    }
  }

  return (
    <AuthLayout>
      <Card className="flex flex-col gap-4 shadow-lift">
        <div className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Secure checkout (simulated)
          </p>
          <p className="mt-2 text-3xl font-black text-ink">
            {currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`}
          </p>
          <p className="mt-1 text-sm text-muted">
            This is a mock gateway. No real card details are collected.
          </p>
        </div>
        <Button fullWidth loading={busy} onClick={() => void settle('paid')}>
          Pay now
        </Button>
        <Button fullWidth variant="secondary" disabled={busy} onClick={() => void settle('failed')}>
          Cancel payment
        </Button>
      </Card>
    </AuthLayout>
  );
}
