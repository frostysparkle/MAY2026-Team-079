import { useEffect, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { ScanQRRequest, Workshop } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { path, ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { ScannerViewfinder } from '@/features/scan/ScannerViewfinder';
import { recordScan, type ScanOutcome } from '@/features/workshops/scanLedger';
import { Button, ErrorState, ResultBanner, Spinner } from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { cn } from '@/lib/cn';

type Outcome = { kind: 'info' | 'success' | 'error'; message: string } | null;

type ScanType = 'pre-registered' | 'on-spot';

/**
 * The two workshop scanners.
 *
 * Which one this is comes from the path — `/staff/scan/workshop/:id` checks off
 * students who booked a seat, `/staff/scan/workshop/:id/on-spot` admits walk-ins
 * against the backend's 10%-of-capacity cap. They are separate routes because
 * they are separate jobs, frequently at separate desks; the switch below moves
 * between them by navigating, so the URL always says which desk this is and can
 * be shared or bookmarked as that desk.
 *
 * Every scan is also written to this device's ledger. That is what lets the
 * workshop desk show a volunteer *who* they admitted: the workshop's own log is
 * Super Admin-only, so without the local record their attendee and on-spot lists
 * would be empty however many people they scanned in.
 */
export default function WorkshopScannerPage() {
  const { workshopId = '' } = useParams();
  const navigate = useNavigate();
  const staff = currentStaff();
  const onSpotRoute = useMatch(ROUTES.scanWorkshopOnSpot) !== null;
  const scanType: ScanType = onSpotRoute ? 'on-spot' : 'pre-registered';

  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  /** A code has been read and the log is in flight — the camera is already down. */
  const [pending, setPending] = useState(false);

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
    let message: string;
    let kind: 'info' | 'success' | 'error';
    let ledgerOutcome: ScanOutcome;

    setPending(true);
    try {
      const res = await api.workshopAttendance(workshopId, scanType, qr);
      message = res.message;
      const already = res.message === 'Attendee already marked present';
      kind = already ? 'info' : 'success';
      ledgerOutcome = already ? 'already-present' : 'admitted';
    } catch (e) {
      message = e instanceof ApiClientError ? e.message : 'Scan failed.';
      kind = 'error';
      ledgerOutcome = 'refused';
    } finally {
      setPending(false);
    }

    setOutcome({ kind, message });
    recordScan(workshopId, {
      participantId: qr.participant_id,
      scanType,
      at: new Date().toISOString(),
      scannedBy: staff?.id ?? null,
      outcome: ledgerOutcome,
      message,
    });
  }

  const scanner = useQrScanner(handleScan);

  const back = { label: 'Duties', onClick: () => navigate(ROUTES.staffDuties) };

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

  const onSpotAllowance = Math.floor(workshop.capacity * 0.1);

  return (
    <FestivalScreen
      title={onSpotRoute ? 'On-Spot Desk' : 'Scan'}
      eyebrow={workshop.name}
      subtitle={`${workshop.venue} · ${workshop.capacity} seats`}
      width="md"
      back={back}
      actions={
        <Button
          variant="ghost"
          className="gap-1.5"
          onClick={() => navigate(path(ROUTES.workshopManage, { workshopId }))}
        >
          <BarChart3 size={14} /> Workshop desk
        </Button>
      }
    >
      {/* Switching desk changes the route, not just a flag, so the mode survives
          a reload and a shared link opens the same desk. `replace` keeps Back
          pointing at whatever sent the volunteer here. */}
      <div className="flex gap-2 rounded-xl bg-surface-2 p-1">
        {(
          [
            { type: 'pre-registered', label: 'Pre-registered', to: ROUTES.scanWorkshop },
            { type: 'on-spot', label: 'On-spot', to: ROUTES.scanWorkshopOnSpot },
          ] as const
        ).map((desk) => (
          <button
            key={desk.type}
            onClick={() => {
              if (desk.type === scanType) return;
              setOutcome(null);
              navigate(path(desk.to, { workshopId }), { replace: true });
            }}
            aria-pressed={scanType === desk.type}
            className={cn(
              'tap flex-1 rounded-lg py-2 text-sm font-semibold',
              scanType === desk.type ? 'bg-surface text-brand shadow-card' : 'text-muted',
            )}
          >
            {desk.label}
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-muted">
        {onSpotRoute
          ? `Walk-ins only, capped at ${onSpotAllowance} (10% of capacity). A student already booked into another workshop in this slot is moved to this one.`
          : 'Only students who booked a seat for this workshop are admitted here.'}
      </p>

      {knownMembership?.attendance === false && (
        <ResultBanner variant="warning" title="Scanning is switched off for your account">
          A Super Admin has disabled your scanning on this workshop, so every code will be refused
          until it is switched back on.
        </ResultBanner>
      )}

      {!outcome && (
        <ScannerViewfinder
          scanner={scanner}
          busy={pending}
          busyLabel={onSpotRoute ? 'Admitting walk-in…' : 'Marking attendance…'}
        />
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
