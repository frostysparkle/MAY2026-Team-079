import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Event, EventScanResponse, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { ADMITTED_NOTE, readEventCapacity } from '@/features/events/eventCapacity';
import { readEventExtras } from '@/features/events/eventExtras';
import { useQrScanner } from '@/features/scan/useQrScanner';
import {
  Button,
  ErrorState,
  ProgressBar,
  ResultBanner,
  Spinner,
  StatusBadge,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

type Outcome =
  { kind: 'result'; data: EventScanResponse } | { kind: 'error'; message: string } | null;

/** Event scanner: always 200 — the result shows whether the scanned person is actually registered. */
export default function EventScannerPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [event, setEvent] = useState<Event | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [dailyScans, setDailyScans] = useState<number | null>(null);
  /** Distinct participants scanned in today, across every volunteer — story 3.2. */
  const [admitted, setAdmitted] = useState<number | null>(null);

  useEffect(() => {
    api
      .listEvents()
      .then((all) => setEvent(all.find((e) => e.event_id === eventId) ?? null))
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load event.'),
      );
  }, [eventId]);

  /**
   * Today's event-wide attendance, for the entries-left readout.
   *
   * Failure is swallowed on purpose: participation is a *nice-to-have* at the
   * gate, and a UHC caller gets a response with no `total_daily_scans` at all.
   * Neither may stop a volunteer scanning — the readout simply hides.
   */
  const refreshAdmitted = useCallback(() => {
    api
      .eventParticipation(eventId)
      .then((res) =>
        setAdmitted(typeof res.total_daily_scans === 'number' ? res.total_daily_scans : null),
      )
      .catch(() => setAdmitted(null));
  }, [eventId]);

  useEffect(refreshAdmitted, [refreshAdmitted]);

  const membership = event?.event_team.find((m) => m.user_id === staff?.id);

  const capacity = readEventCapacity(
    event ? readEventExtras(event.registration).capacity : undefined,
    admitted,
  );

  async function handleScan(qr: ScanQRRequest) {
    try {
      const res = await api.scanEvent(eventId, qr);
      setOutcome({ kind: 'result', data: res });
      api
        .myDailyEventScans(eventId)
        .then((r) => setDailyScans(r.daily_unique_scans))
        .catch(() => undefined);
      // Only a registered participant is logged, but re-reading is cheaper than
      // predicting which scans counted.
      refreshAdmitted();
    } catch (e) {
      setOutcome({
        kind: 'error',
        message: e instanceof ApiClientError ? e.message : 'Scan failed.',
      });
    }
  }

  const { readerId, cameraError, retry } = useQrScanner(handleScan);

  const back = { label: 'Duties', onClick: () => navigate(ROUTES.staffDuties) };

  if (loadError) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Could not load event" description={loadError} />
      </FestivalScreen>
    );
  }
  if (!event) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }
  if (!membership) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Not authorized to scan for this event" />
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="Scan"
      eyebrow={event.name}
      subtitle={dailyScans === null ? undefined : `Your scans today: ${dailyScans}`}
      width="md"
      back={back}
    >
      {capacity && (
        <section
          aria-label="Entries remaining"
          className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Entries left today
            </p>
            {capacity.label && <StatusBadge tone={capacity.tone}>{capacity.label}</StatusBadge>}
          </div>
          <p className="text-3xl font-black leading-none tabular-nums text-ink">
            {capacity.remaining === null ? '—' : capacity.remaining.toLocaleString()}
            <span className="text-base font-semibold text-muted">
              {' / '}
              {capacity.capacity.toLocaleString()}
            </span>
          </p>
          {capacity.admitted !== null && (
            <ProgressBar
              value={capacity.admitted}
              max={capacity.capacity}
              tone={capacity.barTone}
              label={`${event.name} entries used`}
            />
          )}
          <p className="text-[11px] text-muted">
            {capacity.admitted === null
              ? 'Today’s count is not readable from this account — the published capacity is shown on its own.'
              : `${capacity.admitted.toLocaleString()} ${ADMITTED_NOTE}.`}
          </p>
        </section>
      )}

      {capacity?.atCapacity && (
        <ResultBanner
          variant="warning"
          title={
            capacity.over > 0
              ? `${capacity.over} past the published capacity`
              : 'Published capacity reached'
          }
        >
          The venue has admitted {capacity.admitted?.toLocaleString()} of{' '}
          {capacity.capacity.toLocaleString()} today. Scanning still works — the limit is the
          organiser’s published figure, not a lock.
        </ResultBanner>
      )}

      {!outcome && (
        <>
          <div id={readerId} className="overflow-hidden rounded-2xl bg-black/5" />
          {cameraError && (
            <div className="flex flex-col items-center gap-3">
              <p role="alert" className="text-sm text-danger">
                {cameraError}
              </p>
              <Button variant="secondary" onClick={retry}>
                Retry camera
              </Button>
            </div>
          )}
        </>
      )}

      {outcome?.kind === 'result' && (
        <>
          <ResultBanner
            variant={outcome.data.is_participating ? 'success' : 'warning'}
            title={
              outcome.data.is_participating ? 'Participating' : 'Not registered for this event'
            }
          >
            {outcome.data.name ?? outcome.data.email} · {outcome.data.email}
          </ResultBanner>
          <Button
            fullWidth
            onClick={() => {
              setOutcome(null);
              retry();
            }}
          >
            Scan Next Participant
          </Button>
        </>
      )}

      {outcome?.kind === 'error' && (
        <>
          <ResultBanner variant="error" title={outcome.message} />
          <Button
            fullWidth
            onClick={() => {
              setOutcome(null);
              retry();
            }}
          >
            Scan Next Participant
          </Button>
        </>
      )}
    </FestivalScreen>
  );
}
