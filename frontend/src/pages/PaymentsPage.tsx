import { useEffect, useState } from 'react';
import { api, ApiClientError } from '@/api';
import type { MealPlan, MyPayments, Payment } from '@/api/types';
import { Button, Card, ResultBanner, Select, Skeleton, ErrorState } from '@/components/ui';

type Status = 'loading' | 'error' | 'loaded';

function money(amount: number, currency: string) {
  return currency === 'INR' ? `₹${amount}` : `${currency} ${amount}`;
}

const STATUS_LABEL: Record<string, string> = {
  created: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
};

const STATUS_BADGE: Record<string, string> = {
  created: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

/**
 * Payments (Epic 10). Shows hostel and mess payment status + receipts (FR-10.3)
 * and starts a hosted checkout for each (FR-10.1/10.2). Card details are entered
 * only on the gateway's hosted page — never here.
 */
export default function PaymentsPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [payments, setPayments] = useState<MyPayments | null>(null);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setStatus('loading');
    try {
      const [p, pl] = await Promise.all([api.getMyPayments(), api.listMealPlans()]);
      setPayments(p);
      setPlans(pl.plans);
      setStatus('loaded');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function payHostel() {
    setError(null);
    setBusy(true);
    try {
      const { checkoutUrl } = await api.startHostelCheckout();
      window.location.assign(checkoutUrl);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? e.message : 'Could not start the payment. Try again.',
      );
      setBusy(false);
    }
  }

  async function payMess() {
    setError(null);
    if (!selectedPlan) {
      setError('Please select a meal plan first.');
      return;
    }
    setBusy(true);
    try {
      const { checkoutUrl } = await api.startMessCheckout(selectedPlan);
      window.location.assign(checkoutUrl);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not start the payment. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-ink">Payments</h1>
        <p className="text-sm text-muted">Hostel and mess fees.</p>
      </div>

      {error && (
        <ResultBanner variant="error" title="Payment">
          {error}
        </ResultBanner>
      )}

      {status === 'loading' && <Skeleton className="h-40" />}
      {status === 'error' && (
        <ErrorState description="Could not load payments." onRetry={() => void load()} />
      )}

      {status === 'loaded' && payments && (
        <>
          <PaymentCard
            title="Hostel fee"
            payment={payments.hostel}
            action={
              payments.hostel?.status !== 'paid' ? (
                <Button loading={busy} onClick={() => void payHostel()}>
                  Pay ₹2000
                </Button>
              ) : null
            }
          />

          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-ink">Mess fee</p>
              {payments.mess && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[payments.mess.status]}`}
                >
                  {STATUS_LABEL[payments.mess.status]}
                </span>
              )}
            </div>
            {payments.mess?.status === 'paid' ? (
              <Receipt payment={payments.mess} />
            ) : (
              <>
                <Select
                  label="Meal plan"
                  placeholder="Select a plan"
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  options={plans.map((p) => ({
                    value: p.id,
                    label: `${p.name} — ${money(p.amount, p.currency)}`,
                  }))}
                />
                <Button loading={busy} disabled={!selectedPlan} onClick={() => void payMess()}>
                  Pay mess fee
                </Button>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function PaymentCard({
  title,
  payment,
  action,
}: {
  title: string;
  payment: Payment | null;
  action: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-ink">{title}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            payment ? STATUS_BADGE[payment.status] : 'bg-surface-2 text-muted'
          }`}
        >
          {payment ? STATUS_LABEL[payment.status] : 'Not started'}
        </span>
      </div>
      {payment?.status === 'paid' ? <Receipt payment={payment} /> : action}
    </Card>
  );
}

function Receipt({ payment }: { payment: Payment }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3 text-sm">
      <p className="font-medium text-ink">Receipt</p>
      <div className="mt-1 flex justify-between text-muted">
        <span>Amount</span>
        <span className="text-ink">{money(payment.amount, payment.currency)}</span>
      </div>
      {payment.planName && (
        <div className="flex justify-between text-muted">
          <span>Plan</span>
          <span className="text-ink">{payment.planName}</span>
        </div>
      )}
      <div className="flex justify-between text-muted">
        <span>Date</span>
        <span className="text-ink">{payment.paidAt?.slice(0, 10) ?? '—'}</span>
      </div>
      <div className="flex justify-between text-muted">
        <span>Ref</span>
        <span className="text-ink">{payment.txnRef ?? '—'}</span>
      </div>
    </div>
  );
}
