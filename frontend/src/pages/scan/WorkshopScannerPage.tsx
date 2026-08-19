import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { ScanQRRequest, Workshop } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { Button, ErrorState, ResultBanner, Spinner } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

type Outcome = { kind: 'info' | 'success' | 'error'; message: string } | null;

/** Workshop scanner: Pre-registered/On-spot toggle; on-spot is capped at 10% of capacity server-side. */
export default function WorkshopScannerPage() {
  const { workshopId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanType, setScanType] = useState<'pre-registered' | 'on-spot'>('pre-registered');
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    api
      .listWorkshops()
      .then((all) => setWorkshop(all.find((w) => w.workshop_id === workshopId) ?? null))
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshop.'),
      );
  }, [workshopId]);

  // workshop_team is stripped for non-super-admin callers, so a volunteer
  // can't self-verify membership here — the backend's 403 is the real gate.
  const knownMembership = workshop?.workshop_team?.find((v) => v.user_id === staff?.id);

  async function handleScan(qr: ScanQRRequest) {
    try {
      const res = await api.workshopAttendance(workshopId, scanType, qr);
      setOutcome({
        kind: res.message === 'Attendee already marked present' ? 'info' : 'success',
        message: res.message,
      });
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
        <ErrorState title="Could not load workshop" description={loadError} />
      </FestivalScreen>
    );
  }
  if (!workshop) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <div className="flex h-64 items-center justify-center">
          <Spinner label="Loading" />
        </div>
      </FestivalScreen>
    );
  }
  if (workshop.workshop_team && !knownMembership) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Not authorized to scan for this workshop" />
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="Scan"
      eyebrow={workshop.name}
      subtitle={`${workshop.venue} · ${workshop.capacity} seats`}
      width="md"
      back={back}
    >
      <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
        {(['pre-registered', 'on-spot'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setScanType(t)}
            aria-pressed={scanType === t}
            className={cn(
              'tap flex-1 rounded-lg py-2 text-sm font-semibold capitalize',
              scanType === t ? 'bg-surface text-brand shadow-card' : 'text-muted',
            )}
          >
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

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

      {outcome && (
        <>
          <ResultBanner
            variant={
              outcome.kind === 'error' ? 'error' : outcome.kind === 'info' ? 'warning' : 'success'
            }
            title={outcome.message}
          />
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
