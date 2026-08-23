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
  type HostelScanAction,
  type HostelScanOutcome,
} from '@/features/stay/hostelScanOutcome';
import { cn } from '@/lib/cn';

/** The three actions offered on the toggle, and how each one reads. */
const ACTIONS: { value: HostelScanAction; label: string }[] = [
  { value: 'entry', label: 'Entry' },
  { value: 'exit', label: 'Exit' },
  { value: 'permanent_exit', label: 'Permanent Exit' },
];

/**
 * Hostel scanner: Entry / Exit / Permanent Exit, no slot/day concept.
 *
 * Each of the route's refusals gets its own state rather than one red banner
 * (`features/stay/hostelScanOutcome.ts`). "Already inside" and "already outside"
 * matter most: they are not somebody to turn away, they are the desk having
 * pressed the wrong side of the toggle — and they carry the participant's actual
 * state, which is what the guard needs to see. Permanent exit is separated from
 * the entry/exit pair rather than folded into "exit", because the backend treats
 * it as a one-way, terminal action — once logged, the participant cannot be
 * scanned back in without a Super Admin correcting the record — so a desk should
 * not reach it by accident on a toggle meant for routine comings and goings.
 */
export default function HostelScannerPage() {
  const { hostelId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const [hostel, setHostel] = useState<Hostel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<HostelScanAction>('entry');
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

  const back = { label: 'Dashboard', onClick: () => navigate(ROUTES.staffDuties) };

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
  if (!membership.attendance) {
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
        {ACTIONS.map((a) => (
          <button
            key={a.value}
            onClick={() => setAction(a.value)}
            aria-pressed={action === a.value}
            className={cn(
              'tap flex-1 rounded-lg py-2 text-sm font-semibold',
              action === a.value ? 'bg-surface text-brand shadow-card' : 'text-muted',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {action === 'permanent_exit' && !outcome && (
        <ResultBanner variant="warning" title="This cannot be undone from here">
          Marking a permanent exit means this participant has left the fest for good. They cannot be
          scanned back in afterwards without a Super Admin correcting the record.
        </ResultBanner>
      )}

      {!outcome && (
        <ScannerViewfinder
          scanner={scanner}
          busy={pending}
          busyLabel={
            action === 'entry'
              ? 'Logging entry…'
              : action === 'exit'
                ? 'Logging exit…'
                : 'Logging permanent exit…'
          }
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
              <StatusBadge
                tone={
                  outcome.state === 'inside'
                    ? 'success'
                    : outcome.state === 'departed'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {outcome.state === 'inside'
                  ? 'Inside the block'
                  : outcome.state === 'departed'
                    ? 'Permanently departed'
                    : 'Outside the block'}
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

          {/* A permanent exit requires the participant to be inside first — the
              obvious fix is to log the entry that was missed, not to retry the
              same action. */}
          {outcome.kind === 'must-be-inside-to-depart' && (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setAction('entry');
                setOutcome(null);
                scanner.retry();
              }}
            >
              Switch to Entry and scan again
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
