import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Hostel, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { ScannerViewfinder } from '@/features/scan/ScannerViewfinder';
import { Button, ErrorState, ResultBanner, Spinner } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

type Outcome = { kind: 'success' | 'error'; message: string; action?: 'entry' | 'exit' } | null;

/** Hostel scanner: single Entry/Exit toggle, no slot/day concept. */
export default function HostelScannerPage() {
  const { hostelId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<'entry' | 'exit'>('entry');
  const [outcome, setOutcome] = useState<Outcome>(null);
  /** A code has been read and the log is in flight — the camera is already down. */
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .listHostels()
      .then((all) => setHostel(all.find((h) => h.hostel_id === hostelId) ?? null))
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load hostel.'),
      );
  }, [hostelId]);

  const membership = hostel?.hostel_team?.find((t) => t.user_id === staff?.id);

  async function handleScan(qr: ScanQRRequest) {
    setPending(true);
    try {
      const res = await api.scanHostel(hostelId, action, qr);
      setOutcome({ kind: 'success', message: res.message, action });
    } catch (e) {
      setOutcome({
        kind: 'error',
        message: e instanceof ApiClientError ? e.message : 'Scan failed.',
      });
    } finally {
      setPending(false);
    }
  }

  const scanner = useQrScanner(handleScan);

  const back = { label: 'Duties', onClick: () => navigate(ROUTES.staffDuties) };

  if (loadError) {
    return (
      <FestivalScreen title="Scan" width="md" back={back}>
        <ErrorState title="Could not load hostel" description={loadError} />
      </FestivalScreen>
    );
  }
  if (!hostel) {
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
        <ErrorState title="Not authorized to scan for this hostel" />
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
      eyebrow={hostel.name}
      subtitle="Log participants in and out."
      width="md"
      back={back}
    >
      <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
        {(['entry', 'exit'] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            aria-pressed={action === a}
            className={cn(
              'tap flex-1 rounded-lg py-2 text-sm font-semibold capitalize',
              action === a ? 'bg-surface text-brand shadow-card' : 'text-muted',
            )}
          >
            {a}
          </button>
        ))}
      </div>

      {!outcome && (
        <ScannerViewfinder
          scanner={scanner}
          busy={pending}
          busyLabel={action === 'entry' ? 'Logging entry…' : 'Logging exit…'}
        />
      )}

      {outcome && (
        <>
          <ResultBanner
            variant={outcome.kind === 'success' ? 'success' : 'error'}
            title={
              outcome.kind === 'success'
                ? outcome.action === 'entry'
                  ? 'Now Inside'
                  : 'Now Outside'
                : outcome.message
            }
          >
            {outcome.message}
          </ResultBanner>
          <Button
            fullWidth
            onClick={() => {
              setOutcome(null);
              scanner.retry();
            }}
          >
            Scan Next Participant
          </Button>
        </>
      )}
    </FestivalScreen>
  );
}
