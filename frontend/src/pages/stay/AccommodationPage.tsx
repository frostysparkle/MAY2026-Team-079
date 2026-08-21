import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BedDouble,
  BookOpen,
  Building2,
  CheckCircle2,
  DoorOpen,
  Hash,
  Info,
  LifeBuoy,
  Lock,
  MessageSquareWarning,
  Phone,
  QrCode,
  ReceiptText,
  RefreshCw,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type {
  Hostel,
  Mess,
  MyHostelResponse,
  MyMessResponse,
  ProfileCompleteRequest,
} from '@/api/types';
import { ROUTES, supportPath } from '@/config/routes';
import { messCuisineLabel, MESS_PREFERENCES } from '@/config/constants';
import { messPreferenceLabel } from '@/features/profile/profileDisplay';
import { FEST_DAYS } from '@/config/festCalendar';
import { MessMenuBoard } from '@/features/mess/MessMenuBoard';
import { MealSlotGrid } from '@/features/mess/MealSlotGrid';
import { loggedMeals } from '@/features/mess/mealSlots';
import { currentMenuDay, overrideFor, resolveMenu } from '@/features/mess/messMenu';
import { currentParticipant, useAuthStore } from '@/stores/authStore';
import { useLiveQr } from '@/features/qr/useLiveQr';
import { EntryQrCard } from '@/features/qr/EntryQrCard';
import { ALLOCATION_POLL_MS, useStayFacilities } from '@/features/stay/useStayFacilities';
import { deriveStayStatus, type FacilityState } from '@/features/stay/stayStatus';
import {
  coordinatorContact,
  hostelContacts,
  telHref,
  type DutyContact,
} from '@/features/stay/dutyContacts';
import {
  CHOICE_DESCRIPTION,
  CHOICE_FACILITIES,
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
  BUTTON_ICON,
  BUTTON_ICON_STROKE,
  ConfirmDialog,
  DetailPanel,
  ErrorState,
  Fact,
  FactList,
  ResultBanner,
  Select,
  Skeleton,
  StatusBadge,
  ProgressBar,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

/** The three values `POST /mess/allocate` can group a student under. */
const MESS_PREF_OPTIONS = MESS_PREFERENCES.map((p) => ({
  value: p,
  label: p === 'non_veg' ? 'Non-veg' : p[0].toUpperCase() + p.slice(1),
}));

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
 * It also owns the meal preference. Complete Your Profile used to require one
 * from every student before their profile could be saved, including the majority
 * who never take mess; it is asked here instead, of the students who just said
 * they want meals. And the whole step is skippable — a student can reach the
 * rest of the app without answering, and the picker will still be waiting when
 * they come back.
 *
 * Dressed as every other signed-in screen: `FestivalScreen`, then `DetailPanel`
 * surfaces, the shared `Fact` rows, and the same pass card My QR carries.
 */
export default function AccommodationPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const participant = currentParticipant();
  const participantId = participant?.id ?? '';
  const updateParticipantProfile = useAuthStore((s) => s.updateParticipantProfile);

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

  /**
   * Record the selection — and, when it includes meals, the meal preference that
   * goes with it.
   *
   * The preference is a profile field, so it goes to the server first and the
   * local selection is only stored if that succeeds. `POST /mess/allocate` reads
   * `profile.mess_preference` and nothing else, so a mess booking saved without
   * one is a booking the allocation batch cannot place; asking again is better
   * than holding a place the organisers will skip over.
   *
   * `PATCH /profile/complete` replaces the profile document wholesale, which is
   * why `profilePayload` resends every other field from the session untouched.
   */
  async function choose(choice: StayChoice, preference: string) {
    if (!participantId) return;
    setActionError(null);

    const wantsMess = CHOICE_FACILITIES[choice].includes('mess');
    if (wantsMess && preference && preference !== participant?.mess_preference) {
      const payload = profilePayload(participant, preference);
      if (!payload) {
        setActionError(
          'Your profile is missing some details, so the meal preference could not be saved. Finish your profile and try again.',
        );
        return;
      }
      setBusy(true);
      try {
        updateParticipantProfile(await api.completeProfile(payload));
      } catch (e) {
        setActionError(
          e instanceof ApiClientError ? e.message : 'Could not save your meal preference.',
        );
        return;
      } finally {
        setBusy(false);
      }
    }

    const next: StayRecord = { choice, decided_at: new Date().toISOString(), receipt: null };
    saveStayRecord(participantId, next);
    setRecord(next);
    setEditing(false);
    if (needsPayment(choice)) navigate(ROUTES.accommodationPayment);
  }

  /**
   * Change the meal preference on its own, without touching the booking.
   *
   * Offered while the hall is still unallotted, which is the window the backend
   * allows: `PATCH /profile/complete` answers 409 once `mess.mess_id` is set. The
   * screen hides the control in that state, so the 409 should be unreachable —
   * but it is surfaced rather than swallowed, because it is also what a student
   * would hit if the allocation batch ran while this page was open, and "your
   * hall was just allotted" is exactly what they need to be told.
   *
   * Reloads afterwards so the panel re-derives its state from the server rather
   * than from what we hoped the write did.
   */
  async function changePreference(next: string) {
    if (!next || next === participant?.mess_preference) return;
    const payload = profilePayload(participant, next);
    if (!payload) {
      setActionError(
        'Your profile is missing some details, so the meal preference could not be saved. Finish your profile and try again.',
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      updateParticipantProfile(await api.completeProfile(payload));
      await reload();
    } catch (e) {
      setActionError(
        e instanceof ApiClientError ? e.message : 'Could not save your meal preference.',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Leave the question unanswered and carry on into the app.
   *
   * Deliberately different from choosing "Neither": nothing is recorded, so the
   * picker is still waiting on the next visit. A student arriving here straight
   * from completing their profile may not know yet whether they need a bed, and
   * making them assert "I need nothing" to get past the step would put a wrong
   * answer on file.
   */
  function skip() {
    navigate(ROUTES.home, { replace: true });
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
            <ChoicePicker
              current={live.choice}
              currentPreference={participant?.mess_preference ?? null}
              saving={busy}
              onChoose={choose}
              onSkip={skip}
            />
          ) : (
            <>
              {!live.paid && live.choice !== 'neither' && (
                <ResultBanner variant="warning" title="Payment pending">
                  You chose {CHOICE_LABEL[live.choice ?? 'neither'].toLowerCase()}. Nothing is
                  reserved until the {money(stayTotal(live.choice ?? 'neither'))} fee is settled.
                  <div className="mt-2">
                    <Button size="sm" onClick={() => navigate(ROUTES.accommodationPayment)}>
                      <Wallet size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} /> Go to
                      payment
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
                  saving={busy}
                  onChangePreference={(next) => void changePreference(next)}
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
 * The four-way choice, and the meal preference that comes with the two options
 * that include meals.
 *
 * Radios rather than four buttons: they are mutually exclusive, arrow keys move
 * between them, and the selected one survives a mis-click on Continue.
 *
 * The meal preference lives here rather than on Complete Your Profile because
 * this is the screen where a student decides whether they are eating on campus
 * at all — so it is asked of the students it applies to, at the moment it
 * applies, instead of being a required question for the whole fest. It appears
 * only for "Accommodation and mess" and "Mess only", and Continue stays disabled
 * until it is answered, because a mess booking with no preference is one
 * `POST /mess/allocate` cannot place.
 */
function ChoicePicker({
  current,
  currentPreference,
  saving,
  onChoose,
  onSkip,
}: {
  current: StayChoice | null;
  currentPreference: string | null;
  saving: boolean;
  onChoose: (choice: StayChoice, preference: string) => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<StayChoice>(current ?? 'both');
  const [preference, setPreference] = useState<string>(currentPreference ?? '');
  const items = stayLineItems(selected);
  const total = stayTotal(selected);
  const needsPreference = CHOICE_FACILITIES[selected].includes('mess');
  const missingPreference = needsPreference && !preference;

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

      {needsPreference && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
          <Select
            label="Meal preference"
            required
            placeholder="Select preference"
            options={MESS_PREF_OPTIONS}
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            hint="Halls are allotted against this. You can change it from this screen until a hall is assigned."
          />
        </div>
      )}

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

      <div className="flex flex-col gap-2">
        <Button
          fullWidth
          size="lg"
          loading={saving}
          disabled={missingPreference}
          onClick={() => onChoose(selected, preference)}
        >
          {total > 0 ? (
            <>
              <Wallet size={BUTTON_ICON.lg} strokeWidth={BUTTON_ICON_STROKE} /> Continue to payment
              · {money(total)}
            </>
          ) : (
            <>
              <CheckCircle2 size={BUTTON_ICON.lg} strokeWidth={BUTTON_ICON_STROKE} /> Confirm —
              nothing to pay
            </>
          )}
        </Button>
        {missingPreference && (
          <p role="alert" className="text-center text-xs text-danger">
            Choose a meal preference to continue.
          </p>
        )}
        {/* Skipping is a first-class way out of this step, not a hidden one: a
            student who does not know yet whether they need a bed should not have
            to claim they need nothing in order to reach the rest of the app. */}
        <Button fullWidth variant="ghost" disabled={saving} onClick={onSkip}>
          Skip for now — decide later
        </Button>
      </div>
    </DetailPanel>
  );
}

/**
 * The whole profile, resent with a new meal preference.
 *
 * `PATCH /profile/complete` replaces `profile` wholesale, so a partial payload
 * would blank every field it omitted. Returns `null` when the session is missing
 * one of the required answers — which would mean the profile was never completed,
 * and the caller says so rather than sending a record with holes in it.
 */
function profilePayload(
  participant: ReturnType<typeof currentParticipant>,
  preference: string,
): ProfileCompleteRequest | null {
  if (!participant) return null;
  const { full_name, dob, house, gender, phone, country, state, city, address, program } =
    participant;
  const stage = participant.course_stage;
  if (
    !full_name ||
    !dob ||
    !house ||
    !gender ||
    !phone ||
    !country ||
    !state ||
    !city ||
    !address ||
    !program ||
    !stage
  ) {
    return null;
  }
  return {
    full_name,
    dob,
    house,
    gender,
    phone,
    mess_preference: preference,
    country,
    state,
    city,
    address,
    // Carried through untouched for the same reason as everything else here.
    emergency_contact: participant.emergency_contact ?? undefined,
    program,
    course_stage: stage,
    photo: participant.photo ?? undefined,
  };
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
        <div className="flex flex-col gap-4">
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

          {/* Story 5.3. `my_hostel` has always returned these names and numbers
              to the allotted resident; the dashboard widget shows a count on
              purpose, and this is the screen the block's details belong on. The
              coordinator comes from the block's own catalogue record. */}
          <DutyContacts hostel={hostel} block={block} />
        </div>
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

function MessPanel({
  state,
  mess,
  catalogue,
  preference,
  saving,
  onChangePreference,
}: {
  state: FacilityState;
  mess: MyMessResponse | null;
  catalogue: Mess[];
  preference: string | null;
  saving: boolean;
  onChangePreference: (next: string) => void;
}) {
  const badge = STATE_BADGE[state];
  const hall = mess?.mess_details ?? null;
  // Locked exactly when the backend locks it. `PATCH /profile/complete` refuses a
  // change once `mess.mess_id` is set, and `state === 'allocated'` is that same
  // fact read through `GET /mess/my_mess` — so the screen cannot offer an edit
  // the API would reject, or refuse one it would allow.
  const locked = state === 'allocated';
  const slots = mess?.slots ?? [];
  // The published campus menu for whatever this hall cooks, with the hall's own
  // menu laid over it — `mess.menu` when its team has published one, this
  // device's copy otherwise. Arrives with `GET /mess/my_mess`, so no extra fetch.
  const menu = useMemo(() => resolveMenu(hall, overrideFor(hall)), [hall]);
  // Counted by the same helper the dashboard widget uses, so the "meals checked
  // in" figure on this screen and the one on the dashboard cannot disagree.
  const { logged, total } = loggedMeals(slots);
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
        locked
          ? 'Your hall was allotted against this preference, so it is fixed for the fest. Ask the mess team at the counter if it is wrong.'
          : state !== 'not_selected'
            ? 'You can still change what you eat — halls are allotted against it, and it locks once yours is assigned.'
            : undefined
      }
    >
      {state !== 'not_selected' && (
        <MealPreferenceField
          preference={preference}
          locked={locked}
          saving={saving}
          onChange={onChangePreference}
        />
      )}

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
              hint={menu.label}
              emptyText="Dietary preference not recorded"
            />
            <Fact
              icon={QrCode}
              label="Meals Checked In"
              value={`${logged} of ${total}`}
              hint={`Breakfast, lunch and dinner across the ${FEST_DAYS} days your pass covers.`}
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

          {/* The same meal card the dashboard widget draws, from one component —
              it was written out in full on both screens. */}
          <MealSlotGrid slots={slots} />

          {/* ---- what is actually being served ---- */}
          <div className="border-t border-line pt-4">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink">
              <BookOpen size={15} strokeWidth={2.25} aria-hidden /> Menu and meal timings
            </h4>
            <MessMenuBoard
              menu={menu}
              initialDay={currentMenuDay()}
              /* The schedule runs six days; a participant's `mess.entries` is
                 seeded with five. Day 6 has a menu and no swipe to log against
                 it, which is worth saying where someone would otherwise turn up
                 expecting one. */
              dayNote={(day) =>
                day > FEST_DAYS
                  ? `Day ${day} is on the fest schedule but your mess pass carries ${FEST_DAYS} days of swipes, so there is no entry to log against it. Check with your hall.`
                  : null
              }
            />
          </div>
        </>
      ) : state === 'awaiting_allocation' ? (
        <div className="flex flex-col gap-3">
          <PanelNote
            icon={RefreshCw}
            title="Meals reserved — awaiting allocation"
            body="Halls are assigned in batches against the meal preference you chose. Yours appears here as soon as it is run."
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

/**
 * The meal preference, editable until a hall is allotted and read-only after.
 *
 * Both states are shown deliberately, rather than hiding the control once it
 * locks: a student who cannot change what they eat needs to be told that, and
 * told why, not left looking for a field that has quietly disappeared. The badge
 * carries the state ("Editable" / "Locked") so it reads the same at a glance as
 * the panel headers around it.
 *
 * Save is disabled until the value actually differs, so the button cannot fire a
 * write that changes nothing.
 */
function MealPreferenceField({
  preference,
  locked,
  saving,
  onChange,
}: {
  preference: string | null;
  locked: boolean;
  saving: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string>(preference ?? '');
  const dirty = Boolean(draft) && draft !== preference;

  if (locked) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <Lock size={14} strokeWidth={2.25} aria-hidden className="shrink-0 text-muted" />
            Meal preference
          </span>
          <StatusBadge tone="neutral">Locked</StatusBadge>
        </div>
        <p className="text-sm text-muted">
          <span className="font-semibold text-ink">
            {messPreferenceLabel(preference) ?? 'Not recorded'}
          </span>{' '}
          — fixed now that a hall is allotted.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">Meal preference</span>
        <StatusBadge tone="info">Editable</StatusBadge>
      </div>
      <Select
        label="What you eat"
        options={MESS_PREF_OPTIONS}
        placeholder="Select preference"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        hint="Locks as soon as your hall is allotted."
      />
      <Button size="sm" loading={saving} disabled={!dirty} onClick={() => onChange(draft)}>
        Save preference
      </Button>
    </div>
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

/**
 * The people on duty for this participant's block — Story 5.3.
 *
 * `GET /hostels/my_hostel` returns `volunteers[{name, phone}]` to the allotted
 * resident, and has since before this screen existed; what was missing was
 * anywhere that printed them. The coordinator is pulled from the block's own
 * catalogue record, which `GET /hostels` returns whole to every signed-in user.
 *
 * Both go through `features/stay/dutyContacts.ts` first, because the backend
 * substitutes the role word for a missing name and the literal string `"N/A"`
 * for a missing phone — a card headed *volunteer* with *N/A* under it is worse
 * than no card. A block with nobody reachable says so and points at the
 * fest-wide directory instead of rendering an empty list.
 */
function DutyContacts({ hostel, block }: { hostel: MyHostelResponse; block: Hostel | undefined }) {
  const coordinator = coordinatorContact(block?.coordinator);
  const volunteers = hostelContacts(hostel);
  const people: (DutyContact & { badge?: string })[] = [
    ...(coordinator ? [{ ...coordinator, badge: 'Coordinator' }] : []),
    ...volunteers,
  ];

  return (
    <div className="rounded-2xl bg-surface-2 p-4">
      {/* Same sub-heading treatment as "Menu and meal timings" in the mess panel:
          15px glyph, `text-sm font-bold uppercase tracking-wide`. This screen had
          the two nested headings in two different styles — one base-size and
          semibold, one small caps and bold — which made two blocks doing the same
          job inside two panels look like different kinds of thing. */}
      <div className="mb-2 flex items-center gap-2">
        <LifeBuoy size={15} strokeWidth={2.25} aria-hidden className="shrink-0 text-ink" />
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink">
          Who to contact at your block
        </h3>
      </div>

      {/* The heading owns the space under it now (`mb-2` above), so these no
          longer add a margin of their own on top of it — two of them disagreed
          about how much that should be. */}
      {people.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          No contacts recorded for this block yet. Every published coordinator across the fest is
          listed under Help &amp; Contacts.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {people.map((person, i) => (
            <li
              key={`${person.name}-${person.phone ?? i}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
            >
              <span className="text-sm font-medium text-ink">
                {person.name}
                {person.badge && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {person.badge}
                  </span>
                )}
              </span>
              {person.phone ? (
                <a
                  href={telHref(person.phone)}
                  className="tap inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
                >
                  <Phone size={13} strokeWidth={2.5} aria-hidden />
                  {person.phone}
                </a>
              ) : (
                <span className="text-xs text-muted">No number recorded</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Story 5.4. The block's phone numbers are what you want for something
          urgent; a written report is what you want for a broken desk that needs
          somebody to remember it tomorrow. Both live here because both start
          from the same thought, and the report is the one that leaves a record
          the team can be held to. */}
      <Link
        to={supportPath('report')}
        className="tap mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
      >
        <MessageSquareWarning size={14} strokeWidth={2.5} aria-hidden />
        Report a problem with your room or hall
      </Link>
    </div>
  );
}
