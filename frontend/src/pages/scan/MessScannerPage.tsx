import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Mess, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { currentMessSlot } from '@/config/messSlots';
import { currentFestDay, FEST_DAYS } from '@/config/festCalendar';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { Button, ErrorState, ResultBanner, Spinner } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';

type Outcome = { kind: 'success' | 'error'; message: string } | null;

/** Mess scanner: slot/day auto-detected from the device clock, no manual dropdown. */
export default function MessScannerPage() {
  const { messId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [mess, setMess] = useState<Mess | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    api
      .listMess()
      .then((all) => setMess(all.find((m) => m.mess_id === messId) ?? null))
      .catch((e) => setLoadError(e instanceof ApiClientError ? e.message : 'Could not load mess.'));
  }, [messId]);

  const membership = mess?.mess_team?.find((t) => t.user_id === staff?.id);
  const slot = currentMessSlot();
  const day = currentFestDay();

  async function handleScan(qr: ScanQRRequest) {
    setScanning(false);
    if (!slot) {
      setOutcome({ kind: 'error', message: 'No active meal slot right now.' });
      return;
    }
    try {
      const res = await api.scanMess(messId, slot, day, qr);
      setOutcome({ kind: 'success', message: res.message });
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : 'Scan failed.';
      setOutcome({
        kind: 'error',
        message: message.startsWith('Already logged in') ? 'Already Consumed' : message,
      });
    }
  }

  const { readerId, cameraError, retry } = useQrScanner(handleScan);

  const back = { label: 'Dashboard', onClick: () => navigate(ROUTES.staffHome) };

  if (loadError) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Could not load mess" description={loadError} />
      </FestivalScreen>
    );
  }
  if (!mess) {
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
        <ErrorState title="Not authorized to scan for this mess" />
      </FestivalScreen>
    );
  }
  if (!membership.logging) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Scanning disabled for you" />
      </FestivalScreen>
    );
  }

  return (
    <FestivalScreen
      title="Scan"
      eyebrow={mess.name}
      subtitle={`Fest day ${day} of ${FEST_DAYS} · ${
        slot ? slot[0].toUpperCase() + slot.slice(1) : 'No active slot'
      }`}
      width="md"
      back={back}
    >
      {scanning && !outcome && (
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
            variant={outcome.kind === 'success' ? 'success' : 'error'}
            title={outcome.message}
          />
          <Button
            fullWidth
            onClick={() => {
              setOutcome(null);
              setScanning(true);
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
