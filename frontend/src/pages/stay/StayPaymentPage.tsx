import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BedDouble, CreditCard, Landmark, Lock, Smartphone, UtensilsCrossed } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import { ROUTES } from '@/config/routes';
import { currentParticipant } from '@/stores/authStore';
import { METHOD_LABEL, type PaymentMethod } from '@/features/finance/demoLedger';
import {
  CHOICE_FACILITIES,
  CHOICE_LABEL,
  PAYMENT_DISCLAIMER,
  makeReceipt,
  money,
  readStayRecord,
  saveStayRecord,
  stayLineItems,
  stayTotal,
} from '@/features/stay/stayChoice';
import {
  Button,
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  DetailPanel,
  ResultBanner,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

/**
 * The dummy payment step. Everything else in this flow talks to the real API;
 * this one screen does not, because there is nothing on the other end — the
 * Paradox Connect backend has no payments domain at all (no fee on a block or a
 * hall, no transaction collection, no gateway callback). So the settlement is
 * simulated here, in the open, and every surface that shows the result repeats
 * `PAYMENT_DISCLAIMER`.
 *
 * What is *not* simulated is the consequence. The moment the mock settles, the
 * accommodation half is written to the server with `POST /hostels/register` —
 * the real opt-in flag `POST /hostels/allocate` filters on — so a student who
 * pays here is genuinely in the queue the organisers allocate from. A 400 back
 * from that call is deliberately not fatal: its two error branches both mean
 * "you already have this", which is a settled booking, not a failed one.
 *
 * No card fields are rendered, on purpose. A realistic-looking card form is the
 * one part of a mock checkout that can mislead someone into typing a real
 * number into it.
 */

const METHODS: { value: PaymentMethod; icon: typeof CreditCard }[] = [
  { value: 'upi', icon: Smartphone },
  { value: 'card', icon: CreditCard },
  { value: 'netbanking', icon: Landmark },
];

/** How long the fake gateway "thinks" for, so the state change reads as a step. */
const SETTLE_DELAY_MS = 1200;

export default function StayPaymentPage() {
  const navigate = useNavigate();
  const participant = currentParticipant();
  const participantId = participant?.id ?? '';

  const [record] = useState(() => (participantId ? readStayRecord(participantId) : null));
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to pay for, or already paid: the hub is the answer, not this form.
  if (!record || record.receipt || CHOICE_FACILITIES[record.choice].length === 0) {
    return <Navigate to={ROUTES.accommodation} replace />;
  }

  const items = stayLineItems(record.choice);
  const total = stayTotal(record.choice);
  const wantsAccommodation = CHOICE_FACILITIES[record.choice].includes('accommodation');

  async function pay() {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));

      if (wantsAccommodation) {
        try {
          await api.registerForAccommodation();
        } catch (e) {
          // "Accommodation already allotted" means the student is further along
          // than this screen thought, not that the booking failed.
          const alreadyHeld = e instanceof ApiClientError && e.status === 400;
          if (!alreadyHeld) throw e;
        }
      }

      saveStayRecord(participantId, { ...record, receipt: makeReceipt(record.choice, method) });
      navigate(`${ROUTES.accommodation}?paid=1`, { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiClientError
          ? e.message
          : 'Could not confirm your booking. Nothing was charged — please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <FestivalScreen
      title="Payment"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle={`${CHOICE_LABEL[record.choice]} for the five days of Paradox.`}
      back={{ label: 'Back to stay', onClick: () => navigate(ROUTES.accommodation) }}
      width="md"
    >
      <ResultBanner variant="warning" title="Simulated checkout">
        {PAYMENT_DISCLAIMER}
      </ResultBanner>

      {error && (
        <ResultBanner variant="error" title="Payment could not be completed">
          {error}
        </ResultBanner>
      )}

      <DetailPanel
        title="Order Summary"
        trailing={<StatusBadge tone="warning">Unpaid</StatusBadge>}
        footer="The fee covers all five days of the fest. Refunds are handled by the fest office."
      >
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const Icon = item.facility === 'mess' ? UtensilsCrossed : BedDouble;
            return (
              <li
                key={item.facility}
                className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3"
              >
                <Icon size={18} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 text-sm text-ink">{item.label}</span>
                <span className="font-semibold tabular-nums text-ink">{money(item.amount)}</span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm font-medium text-muted">Total due</span>
          <span className="text-2xl font-black tabular-nums text-brand">{money(total)}</span>
        </div>
      </DetailPanel>

      <DetailPanel
        title="Payment Method"
        footer="No card, UPI or bank details are collected — the method only labels the mock receipt."
      >
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">Payment method</legend>
          {METHODS.map(({ value, icon: Icon }) => {
            const active = method === value;
            return (
              <label
                key={value}
                className={cn(
                  'tap flex cursor-pointer items-center gap-2.5 rounded-2xl p-3 ring-1 transition',
                  active
                    ? 'bg-brand-50 ring-brand/30'
                    : 'bg-surface-2 ring-transparent hover:ring-line',
                )}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value={value}
                  checked={active}
                  onChange={() => setMethod(value)}
                  className="h-4 w-4 shrink-0 accent-brand"
                />
                <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0 text-muted" />
                <span className="text-sm font-medium text-ink">{METHOD_LABEL[value]}</span>
              </label>
            );
          })}
        </fieldset>
      </DetailPanel>

      <div className="flex flex-col gap-2">
        <Button fullWidth size="lg" loading={busy} onClick={() => void pay()}>
          <Lock size={BUTTON_ICON.lg} strokeWidth={BUTTON_ICON_STROKE} /> Pay {money(total)}
        </Button>
        <Button
          fullWidth
          variant="ghost"
          disabled={busy}
          onClick={() => navigate(ROUTES.accommodation)}
        >
          Cancel
        </Button>
      </div>
    </FestivalScreen>
  );
}
