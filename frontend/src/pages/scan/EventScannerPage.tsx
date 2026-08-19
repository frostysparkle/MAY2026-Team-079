import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Event, EventScanResponse, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { Button, ErrorState, ResultBanner, Spinner } from '@/components/ui';
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

  useEffect(() => {
    api
      .listEvents()
      .then((all) => setEvent(all.find((e) => e.event_id === eventId) ?? null))
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load event.'),
      );
  }, [eventId]);

  const membership = event?.event_team.find((m) => m.user_id === staff?.id);

  async function handleScan(qr: ScanQRRequest) {
    try {
      const res = await api.scanEvent(eventId, qr);
      setOutcome({ kind: 'result', data: res });
      api
        .myDailyEventScans(eventId)
        .then((r) => setDailyScans(r.daily_unique_scans))
        .catch(() => undefined);
    } catch (e) {
      setOutcome({
        kind: 'error',
        message: e instanceof ApiClientError ? e.message : 'Scan failed.',
      });
    }
  }

  const { readerId, cameraError, retry } = useQrScanner(handleScan);

  const back = { label: 'Dashboard', onClick: () => navigate(ROUTES.staffHome) };

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
