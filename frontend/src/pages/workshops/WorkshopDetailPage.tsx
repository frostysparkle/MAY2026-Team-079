import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapPin, Users } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { Workshop } from '@/api/types';
import { ROUTES } from '@/config/routes';
import {
  Button,
  DetailPanel,
  ErrorState,
  Fact,
  FactList,
  ProgressBar,
  ResultBanner,
  Skeleton,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { rememberWorkshopRegistration, slotStatus } from '@/features/workshops/registrationCache';
import { useLiveSeats } from '@/features/workshops/useLiveSeats';
import { workshopView, WORKSHOP_COVER } from '@/features/workshops/workshopView';
import { shiftLabel } from '@/features/workshops/workshopSlot';

/**
 * One workshop, as the participant books it — `FestivalScreen` with a back
 * affordance and a panel of details, matching `AdminEventDetailPage` and the
 * public workshop page rather than the full-bleed phone hero this used to be.
 *
 * The title is the section ("Workshop"), not the session name: `FestivalScreen`
 * sets its title in 5xl uppercase, which a name like "Measurement of AI" would
 * overwhelm. The name is the panel's own heading instead.
 */
export default function WorkshopDetailPage() {
  const { workshopId = '' } = useParams();
  const navigate = useNavigate();
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  // Clearing the error on success rather than up front keeps this free of a
  // synchronous setState when it runs as the mount effect.
  function load() {
    api
      .listWorkshops()
      .then((all) => {
        const found = all.find((w) => w.workshop_id === workshopId);
        if (!found) {
          setLoadError('That workshop is no longer on the programme.');
          return;
        }
        setWorkshop(found);
        setLoadError(null);
      })
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshop.'),
      );
  }
  useEffect(load, [workshopId]);

  const seats = useLiveSeats(
    workshopId,
    workshop
      ? {
          remaining_seats: Math.max(0, workshop.capacity - workshop.registration_count),
          capacity: workshop.capacity,
        }
      : null,
  );

  const backToWorkshops = { label: 'Workshops', onClick: () => navigate(ROUTES.workshops) };

  if (loadError) {
    return (
      <FestivalScreen title="Workshop" eyebrow="Programme" back={backToWorkshops}>
        <ErrorState title="Could not load workshop" description={loadError} onRetry={load} />
      </FestivalScreen>
    );
  }

  if (!workshop) {
    return (
      <FestivalScreen title="Workshop" eyebrow="Programme" back={backToWorkshops}>
        <Skeleton className="h-96" />
      </FestivalScreen>
    );
  }

  const view = workshopView(workshop);
  const status = slotStatus(workshop.slot_id, workshop.workshop_id);
  const alreadyOwn = registered || status === 'own';
  const clashes = status === 'conflict';
  const soldOut = seats !== null && seats.remaining_seats <= 0;
  const taken = seats ? seats.capacity - seats.remaining_seats : null;

  async function register() {
    setSubmitError(null);
    setBusy(true);
    try {
      await api.registerForWorkshop(workshopId);
      rememberWorkshopRegistration(workshop!.slot_id, workshopId);
      setRegistered(true);
      // The seat count just changed for everyone, including this page's fallback.
      load();
    } catch (e) {
      setSubmitError(e instanceof ApiClientError ? e.message : 'Could not register.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FestivalScreen
      title="Workshop"
      eyebrow="Programme"
      subtitle={[view.dayLabel, view.slot.shift && `${shiftLabel(view.slot.shift)} shift`]
        .filter(Boolean)
        .join(' · ')}
      back={backToWorkshops}
    >
      {/* `DetailPanel`, like every other detail panel in the participant area.
          This was the same surface written out by hand, one padding step short of
          the shared one at `sm`. */}
      <DetailPanel title={view.name}>
        <div className="flex flex-wrap items-center gap-2">
          {view.dayLabel && <StatusBadge tone="info">{view.dayLabel}</StatusBadge>}
          {view.slot.shift && (
            <StatusBadge tone="neutral">{shiftLabel(view.slot.shift)} shift</StatusBadge>
          )}
          {alreadyOwn ? (
            <StatusBadge tone="success">Booked</StatusBadge>
          ) : (
            seats && (
              <StatusBadge tone={soldOut ? 'danger' : 'success'}>
                {soldOut ? 'Full' : `${seats.remaining_seats} seats left`}
              </StatusBadge>
            )
          )}
        </div>

        {/* The shared `FactList`/`Fact`, so a workshop's venue and seat count read
            exactly like a hostel block's or a mess hall's on the Stay screen and a
            checkpoint's on My QR. This page had its own two-up grid of small tiles
            with a 10px uppercase label and no icon tile — a fourth way of printing
            a label and a value in a section that already had one. */}
        <FactList>
          <Fact icon={MapPin} label="Venue" value={view.venue || undefined} />
          <Fact
            icon={Users}
            label="Seats Taken"
            value={taken === null ? undefined : `${taken} of ${seats?.capacity ?? view.capacity}`}
            emptyText="Not published yet"
          />
        </FactList>

        {seats && (
          <ProgressBar
            value={seats.capacity - seats.remaining_seats}
            max={seats.capacity}
            tone={soldOut ? 'danger' : 'brand'}
            label={`${view.name} seats taken`}
          />
        )}

        {view.instructions && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink/85">
            {view.instructions}
          </p>
        )}

        {submitError && (
          <ResultBanner variant="error" title="Could not register">
            {submitError}
          </ResultBanner>
        )}

        {alreadyOwn ? (
          <ResultBanner variant="success" title="You're registered for this workshop" />
        ) : clashes ? (
          <ResultBanner variant="warning" title="Clashes with another booking">
            You already hold a workshop in this shift. Only one booking per shift is allowed.
          </ResultBanner>
        ) : (
          // `fullWidth`, as the primary action of a panel is everywhere else in
          // the participant area — the change-password form, the stay picker, the
          // payment screen. `w-full sm:w-fit sm:px-8` made this the one panel CTA
          // that changed shape at `sm` and carried its own horizontal padding.
          <Button fullWidth loading={busy} disabled={soldOut} onClick={register}>
            {soldOut ? 'Workshop full' : 'Register'}
          </Button>
        )}
      </DetailPanel>

      {/* Full-resolution flyer — for the shipped artwork the session title,
          speaker and agenda are typeset into the image itself.

          On the panels' own elevation (`shadow-card` over a hairline
          `ring-black/[0.03]`) rather than the heavier `shadow-lift` and darker
          ring it had: `shadow-lift` is the *hover* elevation in this system, so a
          resting card wearing it sits visibly proud of the panel above it. */}
      <div className="overflow-hidden rounded-2xl bg-surface-2 shadow-card ring-1 ring-black/[0.03]">
        <img
          src={view.posterFull}
          alt={view.name}
          decoding="async"
          onError={(e) => {
            if (!e.currentTarget.src.endsWith(WORKSHOP_COVER)) {
              e.currentTarget.src = WORKSHOP_COVER;
            }
          }}
          className="block h-auto w-full object-contain"
        />
      </div>
    </FestivalScreen>
  );
}
