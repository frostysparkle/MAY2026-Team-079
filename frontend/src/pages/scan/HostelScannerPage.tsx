import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Hostel, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { ScannerViewfinder } from '@/features/scan/ScannerViewfinder';
import { Button, ErrorState, ResultBanner, Spinner, StatusBadge } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import {
  readHostelScanFailure,
  readHostelScanSuccess,
  type HostelScanOutcome,
} from '@/features/stay/hostelScanOutcome';
import { cn } from '@/lib/cn';

/**
 * Hostel scanner: single Entry/Exit toggle, no slot/day concept.
 *
 * Each of the route's four 400s gets its own state rather than one red banner
 * (`features/stay/hostelScanOutcome.ts`). "Already inside" and "already outside"
 * matter most: they are not somebody to turn away, they are the desk having
 * pressed the wrong side of the toggle — and they carry the participant's actual
 * state, which is what the guard needs to see.
 */
export default function HostelScannerPage() {
  const { hostelId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<'entry' | 'exit'>('entry');
  const [outcome, setOutcome] = useState<HostelScanOutcome | null>(null);
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
      setOutcome(readHostelScanSuccess(action, res.message));
    } catch (e) {
      setOutcome(
        readHostelScanFailure(action, e instanceof ApiClientError ? e.message : 'Scan failed.'),
      );
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
          <ResultBanner variant={outcome.tone} title={outcome.title}>
            {outcome.description}
          </ResultBanner>

          {/* Where they are now, stated plainly and separately from what the scan
              did — a guard reads this before they read the sentence above it. Shown
              for a refusal too, because "already inside" is itself the answer to
              "where is this person?". */}
          {outcome.state !== 'unknown' && (
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-ink">
              <StatusBadge tone={outcome.state === 'inside' ? 'success' : 'neutral'}>
                {outcome.state === 'inside' ? 'Inside the block' : 'Outside the block'}
              </StatusBadge>
            </p>
          )}

          {/* Offered only where flipping the toggle is the actual fix, so the
              obvious next move is one tap rather than a re-scan on the wrong side. */}
          {(outcome.kind === 'already-inside' || outcome.kind === 'already-outside') && (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setAction(outcome.kind === 'already-inside' ? 'exit' : 'entry');
                setOutcome(null);
                scanner.retry();
              }}
            >
              Switch to {outcome.kind === 'already-inside' ? 'Exit' : 'Entry'} and scan again
            </Button>
          )}

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
