import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BedDouble,
  Building2,
  CheckCircle2,
  DoorOpen,
  Hash,
  Info,
  QrCode,
  ReceiptText,
  RefreshCw,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Hostel, Mess, MessDayEntry, MyHostelResponse, MyMessResponse } from '@/api/types';
import { ROUTES } from '@/config/routes';
import { messCuisineLabel } from '@/config/constants';
import { messPreferenceLabel } from '@/features/profile/profileDisplay';
import { currentParticipant } from '@/stores/authStore';
import { useLiveQr } from '@/features/qr/useLiveQr';
import { EntryQrCard } from '@/features/qr/EntryQrCard';
import { ALLOCATION_POLL_MS, useStayFacilities } from '@/features/stay/useStayFacilities';
import { deriveStayStatus, type FacilityState } from '@/features/stay/stayStatus';
import {
  CHOICE_DESCRIPTION,
  CHOICE_LABEL,
  PAYMENT_DISCLAIMER,
  STAY_CHOICES,
  clearStayRecord,
  money,
  needsPayment,
  readStayRecord,
  saveStayRecord,
  stayLineItems,
  stayTotal,
  type StayChoice,
  type StayRecord,
} from '@/features/stay/stayChoice';
import {
  Button,
  ConfirmDialog,
  DetailPanel,
  ErrorState,
  Fact,
  FactList,
  ResultBanner,
  Skeleton,
  StatusBadge,
  ProgressBar,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

/**
 * Accommodation & Mess — the screen a student lands on the moment their profile
 * is complete, and the one they come back to for their room, their hall, and the
 * QR that gets them through both gates.
 *
 * It is one screen rather than a wizard because it has to answer two different
 * questions with the same parts: "what do I want?" before anything is booked,
 * and "where am I staying?" afterwards. `deriveStayStatus` decides which of
 * those it is, from the on-device selection reconciled against the two `my_*`
 * reads — so a student placed by the organisers before they ever opened this
 * page still arrives at the answer, not the question.
 *
 * Allocation itself belongs to the organisers: `POST /hostels/allocate` and
 * `POST /mess/allocate` are super-admin routes that run as a batch. What this
 * screen owns is the participant's half — `POST /hostels/register`, sent the
 * moment the mock payment settles, which is the exact flag the hostel batch
 * filters on. Between the two the page polls, so the room number appears here on
 * its own rather than on a reload the student has to think to perform.
 *
 * Dressed as every other signed-in screen: `FestivalScreen`, then `DetailPanel`
 * surfaces, the shared `Fact` rows, and the same pass card My QR carries.
 */
export default function AccommodationPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const participant = currentParticipant();
  const participantId = participant?.id ?? '';

  const [record, setRecord] = useState<StayRecord | null>(() =>
    participantId ? readStayRecord(participantId) : null,
  );
  const [editing, setEditing] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const justPaid = params.get('paid') === '1';

  const { data, status: loadStatus, error, reload } = useStayFacilities();

  const live = useMemo(
    () => deriveStayStatus(record, data?.hostel ?? null, data?.mess ?? null),
    [record, data],
  );

  const qr = useLiveQr();

  // Allocation lands on the server with nothing to notify the client, so the
  // only way this screen fills in a room number on its own is to keep asking —
  // and only for as long as there is something outstanding to ask about.
  useEffect(() => {
    if (!live.awaitingAllocation) return;
    const id = setInterval(() => void reload(), ALLOCATION_POLL_MS);
    return () => clearInterval(id);
  }, [live.awaitingAllocation, reload]);

  // The success banner is a one-shot: keeping `?paid=1` in the URL would put it
  // back on every later visit through the browser's history.
  useEffect(() => {
    if (!justPaid) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      next.delete('paid');
      setParams(next, { replace: true });
    }, 8000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPaid]);

  function choose(choice: StayChoice) {
    if (!participantId) return;
    const next: StayRecord = { choice, decided_at: new Date().toISOString(), receipt: null };
    saveStayRecord(participantId, next);
    setRecord(next);
    setEditing(false);
    if (needsPayment(choice)) navigate(ROUTES.accommodationPayment);
  }

  /**
   * Undo a selection that has not been placed yet. The accommodation half is
   * server-side, so it has to be withdrawn there too — `DELETE /hostels/register`
   * refuses once a bed is allotted, which is exactly why this is only offered
   * while nothing is.
   */
  async function changeSelection() {
    setConfirmChange(false);
    setBusy(true);
    setActionError(null);
    try {
      if (data?.hostel?.registered && !data.hostel.assigned_hostel) {
        await api.cancelAccommodationRequest();
      }
      if (participantId) clearStayRecord(participantId);
      setRecord(null);
      setEditing(true);
      await reload();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.message : 'Could not withdraw your current selection.',
      );
    } finally {
      setBusy(false);
    }
  }

  const showPicker = editing || live.choice === null;
  const canChange = !editing && live.accommodation !== 'allocated' && live.mess !== 'allocated';

  return (
    <FestivalScreen
      title="Stay"
      eyebrow={participant?.house ?? 'Participant'}
      subtitle="Accommodation and mess for the five days of Paradox."
      actions={
        canChange ? (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmChange(true)}>
            Change selection
          </Button>
        ) : undefined
      }
    >
      {justPaid && (
        <ResultBanner variant="success" title="Payment successful">
          Your booking is confirmed. {PAYMENT_DISCLAIMER}
        </ResultBanner>
      )}

      {actionError && (
        <ResultBanner variant="error" title="Could not update your selection">
          {actionError}
        </ResultBanner>
      )}

      {loadStatus === 'loading' && (
        <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      )}

      {loadStatus === 'error' && (
        <ErrorState
          title="Stay details unavailable"
          description={error ?? undefined}
          onRetry={() => void reload()}
        />
      )}

      {loadStatus === 'ready' && data && (
        <>
          {showPicker ? (
            <ChoicePicker current={live.choice} onChoose={choose} />
          ) : (
            <>
              {!live.paid && live.choice !== 'neither' && (
                <ResultBanner variant="warning" title="Payment pending">
                  You chose {CHOICE_LABEL[live.choice ?? 'neither'].toLowerCase()}. Nothing is
                  reserved until the {money(stayTotal(live.choice ?? 'neither'))} fee is settled.
                  <div className="mt-2">
                    <Button
                      size="sm"
                      onClick={() => navigate(ROUTES.accommodationPayment)}
                      className="gap-1.5"
                    >
                      <Wallet size={14} /> Go to payment
                    </Button>
                  </div>
                </ResultBanner>
              )}

              {live.awaitingAllocation && (
                <ResultBanner variant="warning" title="Allocation in progress">
                  Your place is reserved. The organisers run allocation in batches — this page
                  re-checks on its own and fills in the details the moment it lands.
                </ResultBanner>
              )}

              <div className="grid items-start gap-5 lg:grid-cols-2">
                <AccommodationPanel
                  state={live.accommodation}
                  hostel={data.hostel}
                  catalogue={data.hostels}
                  gender={participant?.gender ?? null}
                />
                <MessPanel
                  state={live.mess}
                  mess={data.mess}
                  catalogue={data.messHalls}
                  preference={participant?.mess_preference ?? null}
                />

                {live.choice !== 'neither' && live.paid && (
                  <DetailPanel
                    title="Entry QR"
                    trailing={
                      qr.status === 'ready' ? (
                        <StatusBadge tone="success" className="gap-1.5">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 animate-pulse rounded-full bg-success"
                          />
                          Live
                        </StatusBadge>
                      ) : undefined
                    }
                    footer="The same code opens the hostel gate and the mess counter. It refreshes every 45 seconds and works with no signal."
                  >
                    <EntryQrCard qr={qr} size={180} />
                  </DetailPanel>
                )}

                {record?.receipt && (
                  <DetailPanel
                    title="Receipt"
                    trailing={<StatusBadge tone="success">Paid</StatusBadge>}
                    footer={PAYMENT_DISCLAIMER}
                  >
                    <FactList>
                      {record.receipt.items.map((item) => (
                        <Fact
                          key={item.facility}
                          icon={item.facility === 'mess' ? UtensilsCrossed : BedDouble}
                          label={item.label}
                          value={money(item.amount)}
                        />
                      ))}
                      <Fact
                        icon={ReceiptText}
                        label="Total Paid"
                        value={money(record.receipt.total)}
                        hint={`Reference ${record.receipt.reference}`}
                      />
                      <Fact
                        icon={CheckCircle2}
                        label="Settled"
                        value={new Date(record.receipt.paid_at).toLocaleString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      />
                    </FactList>
                  </DetailPanel>
                )}
              </div>

              {live.choice === 'neither' && (
                <ResultBanner variant="warning" title="Nothing booked">
                  You are commuting and eating off campus. Change your selection above if that turns
                  out otherwise — rooms are limited, so the earlier the better.
                </ResultBanner>
              )}
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmChange}
        title="Change your accommodation and mess selection?"
        description="Your current request is withdrawn, including your place in the hostel queue. You can choose again straight away, but rooms are limited and may run out."
        confirmLabel="Withdraw and choose again"
        cancelLabel="Keep my selection"
        loading={busy}
        onConfirm={() => void changeSelection()}
        onCancel={() => setConfirmChange(false)}
      />
    </FestivalScreen>
  );
}

/* ----------------------------------------------------------------- picker --- */

/**
 * The four-way choice. Radios rather than four buttons: they are mutually
 * exclusive, arrow keys move between them, and the selected one survives a
 * mis-click on Continue.
 */
function ChoicePicker({
  current,
  onChoose,
}: {
  current: StayChoice | null;
  onChoose: (choice: StayChoice) => void;
}) {
  const [selected, setSelected] = useState<StayChoice>(current ?? 'both');
  const items = stayLineItems(selected);
  const total = stayTotal(selected);

  return (
    <DetailPanel
      title="What do you need?"
      meta="Choose one"
      footer={PAYMENT_DISCLAIMER}
      className="mx-auto w-full max-w-3xl"
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Accommodation and mess selection</legend>
        {STAY_CHOICES.map((choice) => {
          const active = selected === choice;
          const fee = stayTotal(choice);
          return (
            <label
              key={choice}
              className={cn(
                'tap flex cursor-pointer items-start gap-3 rounded-2xl p-4 ring-1 transition',
                active
                  ? 'bg-brand-50 ring-brand/30'
                  : 'bg-surface-2 ring-transparent hover:ring-line',
              )}
            >
              <input
                type="radio"
                name="stay-choice"
                value={choice}
                checked={active}
                onChange={() => setSelected(choice)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{CHOICE_LABEL[choice]}</span>
                  <StatusBadge tone={fee > 0 ? 'info' : 'neutral'}>
                    {fee > 0 ? money(fee) : 'No charge'}
                  </StatusBadge>
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-muted">
                  {CHOICE_DESCRIPTION[choice]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {items.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
          {items.map((item) => (
            <div key={item.facility} className="flex items-center justify-between text-sm">
              <span className="text-muted">{item.label}</span>
              <span className="font-medium tabular-nums text-ink">{money(item.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line pt-2">
            <span className="text-sm font-medium text-muted">Total</span>
            <span className="text-lg font-black tabular-nums text-brand">{money(total)}</span>
          </div>
        </div>
      )}

      <Button fullWidth size="lg" onClick={() => onChoose(selected)} className="gap-1.5">
        {total > 0 ? (
          <>
            <Wallet size={16} /> Continue to payment · {money(total)}
          </>
        ) : (
          <>
            <CheckCircle2 size={16} /> Confirm — nothing to pay
          </>
        )}
      </Button>
    </DetailPanel>
  );
}

/* ------------------------------------------------------------ facilities --- */

const STATE_BADGE: Record<
  FacilityState,
  { tone: 'success' | 'warning' | 'neutral'; label: string }
> = {
  allocated: { tone: 'success', label: 'Allotted' },
  awaiting_allocation: { tone: 'warning', label: 'Reserved' },
  awaiting_payment: { tone: 'warning', label: 'Unpaid' },
  not_selected: { tone: 'neutral', label: 'Not booked' },
};

function AccommodationPanel({
  state,
  hostel,
  catalogue,
  gender,
}: {
  state: FacilityState;
  hostel: MyHostelResponse | null;
  catalogue: Hostel[];
  gender: string | null;
}) {
  const badge = STATE_BADGE[state];
  const block = catalogue.find((h) => h.hostel_id === hostel?.assigned_hostel);
  // Which blocks could take this student, read off the same `gender` field the
  // allocation batch buckets on — so the list here can never promise a block
  // the batch would not consider.
  const eligible = gender
    ? catalogue.filter((h) => h.gender?.toLowerCase() === gender.toLowerCase())
    : [];

  return (
    <DetailPanel
      title="Accommodation"
      trailing={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
      footer={
        state === 'allocated'
          ? 'Show your entry QR at the block gate on the way in and again on the way out, so the headcount stays right.'
          : undefined
      }
    >
      {state === 'allocated' && hostel ? (
        <FactList>
          <Fact
            icon={Building2}
            label="Hostel Block"
            value={block?.name ?? hostel.assigned_hostel}
            hint={block ? `Block ${hostel.assigned_hostel}` : undefined}
          />
          <Fact icon={Hash} label="Room" value={hostel.room ?? '—'} />
          <Fact
            icon={DoorOpen}
            label="Right Now"
            value={hostel.logged_in ? 'Inside the block' : 'Outside the block'}
            hint="Updated by the gate scanner each time you pass through."
          />
          {block?.capacity !== undefined && (
            <Fact
              icon={BedDouble}
              label="Block Capacity"
              value={`${block.capacity.toLocaleString('en-IN')} beds`}
              hint={block.category ?? undefined}
            />
          )}
        </FactList>
      ) : state === 'awaiting_allocation' ? (
        <div className="flex flex-col gap-3">
          <PanelNote
            icon={RefreshCw}
            title="Bed reserved — awaiting allocation"
            body="The hostel team places students in batches. Your block and room number appear here as soon as yours is run."
          />
          {eligible.length > 0 && (
            <p className="text-sm leading-relaxed text-muted">
              You will be placed in one of{' '}
              <span className="font-medium text-ink">{eligible.map((h) => h.name).join(', ')}</span>
              .
            </p>
          )}
        </div>
      ) : state === 'awaiting_payment' ? (
        <PanelNote
          icon={Wallet}
          title="Payment pending"
          body="Your bed is held only once the accommodation fee is settled."
        />
      ) : (
        <PanelNote
          icon={Info}
          title="Not booked"
          body="You are arranging your own stay. Change your selection above if that changes."
        />
      )}
    </DetailPanel>
  );
}

const SLOTS: (keyof MessDayEntry)[] = ['breakfast', 'lunch', 'dinner'];
const SLOT_LABEL: Record<keyof MessDayEntry, string> = {
  breakfast: 'B',
  lunch: 'L',
  dinner: 'D',
};

function MessPanel({
  state,
  mess,
  catalogue,
  preference,
}: {
  state: FacilityState;
  mess: MyMessResponse | null;
  catalogue: Mess[];
  preference: string | null;
}) {
  const badge = STATE_BADGE[state];
  const hall = mess?.mess_details ?? null;
  const slots = mess?.slots ?? [];
  const total = slots.length * SLOTS.length;
  const logged = slots.reduce(
    (sum, day) => sum + SLOTS.filter((slot) => day[slot]?.logged).length,
    0,
  );
  // `POST /mess/allocate` groups halls by `preference` and looks up the
  // participant's own `profile.mess_preference`, so this is the real shortlist.
  const eligible = preference
    ? catalogue.filter((m) => m.preference?.toLowerCase() === preference.toLowerCase())
    : [];

  return (
    <DetailPanel
      title="Mess"
      trailing={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
      footer={
        state === 'allocated'
          ? 'Your meal preference is taken from your profile — edit it there and the next allocation follows it.'
          : undefined
      }
    >
      {state === 'allocated' && mess ? (
        <>
          <FactList>
            <Fact
              icon={UtensilsCrossed}
              label="Mess Hall"
              value={hall?.name ?? mess.allotted_mess}
              hint={mess.allotted_mess ? `Hall ${mess.allotted_mess}` : undefined}
            />
            <Fact
              icon={Info}
              label="Serves"
              value={
                [
                  messPreferenceLabel(hall?.preference),
                  ...(hall?.cuisines ?? []).map(messCuisineLabel),
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              emptyText="Menu not recorded"
            />
            <Fact
              icon={QrCode}
              label="Meals Checked In"
              value={`${logged} of ${total}`}
              hint="Breakfast, lunch and dinner across the five days."
            />
          </FactList>

          {total > 0 && (
            <ProgressBar
              value={logged}
              max={total}
              tone="warning"
              label="Meal slots checked in this week"
            />
          )}

          {slots.length > 0 && (
            <div className="grid grid-cols-5 gap-1.5 text-center text-xs">
              {slots.map((day, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <span className="font-medium uppercase tracking-wide text-muted">
                    Day {i + 1}
                  </span>
                  {SLOTS.map((slot) => (
                    <span
                      key={slot}
                      className={cn(
                        'rounded-md py-0.5 font-semibold',
                        day[slot]?.logged
                          ? 'bg-success-bg text-success'
                          : 'bg-surface-2 font-medium text-muted',
                      )}
                    >
                      {SLOT_LABEL[slot]}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      ) : state === 'awaiting_allocation' ? (
        <div className="flex flex-col gap-3">
          <PanelNote
            icon={RefreshCw}
            title="Meals reserved — awaiting allocation"
            body="Halls are assigned in batches against the meal preference on your profile. Yours appears here as soon as it is run."
          />
          {eligible.length > 0 && (
            <p className="text-sm leading-relaxed text-muted">
              Halls serving{' '}
              <span className="font-medium text-ink">{messPreferenceLabel(preference)}</span>:{' '}
              <span className="font-medium text-ink">{eligible.map((m) => m.name).join(', ')}</span>
              .
            </p>
          )}
        </div>
      ) : state === 'awaiting_payment' ? (
        <PanelNote
          icon={Wallet}
          title="Payment pending"
          body="Your meals are booked only once the mess fee is settled."
        />
      ) : (
        <PanelNote
          icon={Info}
          title="Not booked"
          body="You are eating off campus. Change your selection above if that changes."
        />
      )}
    </DetailPanel>
  );
}

/** The one-line-with-an-icon block a panel shows when it has no figures yet. */
function PanelNote({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Info;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
      <Icon size={18} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}
