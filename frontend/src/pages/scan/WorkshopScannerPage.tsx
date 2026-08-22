import { useCallback, useEffect, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { api, ApiClientError } from '@/api';
import type { ScanQRRequest, Workshop } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { path, ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { ScannerViewfinder } from '@/features/scan/ScannerViewfinder';
import { ledgerAdmissions, recordScan, type ScanOutcome } from '@/features/workshops/scanLedger';
import { Button, ErrorState, ProgressBar, ResultBanner, Spinner } from '@/components/ui';
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
  /**
   * On-spot admissions so far, or `null` when neither source can be read.
   *
   * Two sources, in order of trust: `GET /workshops/{id}/participation` counts
   * them server-side and admits this workshop's own team, which is exactly this
   * page's audience; failing that, this device's own ledger is a floor — it knows
   * what *this* volunteer admitted, not what the desk next to them did.
   */
  const [onSpotUsed, setOnSpotUsed] = useState<number | null>(null);
  const [onSpotExact, setOnSpotExact] = useState(false);

  useEffect(() => {
    api
      .listWorkshops()
      .then((all) => setWorkshop(all.find((w) => w.workshop_id === workshopId) ?? null))
      .catch((e) =>
        setLoadError(e instanceof ApiClientError ? e.message : 'Could not load workshop.'),
      );
  }, [workshopId]);

  /**
   * Re-read the on-spot tally. Never blocking and never surfaced as an error: a
   * volunteer who cannot read the roster must still be able to scan, so an
   * unreadable count falls back to the device ledger and then to hiding the meter.
   */
  const refreshOnSpot = useCallback(() => {
    api
      .workshopParticipation(workshopId)
      .then((res) => {
        setOnSpotUsed(res.on_spot_count);
        setOnSpotExact(true);
      })
      .catch(() => {
        const local = ledgerAdmissions(workshopId).filter((row) => row.scanType === 'on-spot');
        setOnSpotUsed(local.length);
        setOnSpotExact(false);
      });
  }, [workshopId]);

  // Only the on-spot desk needs this; the pre-registered turnstile is not capped.
  useEffect(() => {
    if (onSpotRoute) refreshOnSpot();
  }, [onSpotRoute, refreshOnSpot]);

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
    // The tally just moved — including when the scan was refused *because* the cap
    // is reached, which is precisely when the meter needs to be right.
    if (onSpotRoute) refreshOnSpot();
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
  const onSpotLeft = onSpotUsed === null ? null : Math.max(0, onSpotAllowance - onSpotUsed);
  const capReached = onSpotLeft !== null && onSpotLeft === 0;

  /**
   * Scanning explicitly switched off for this member.
   *
   * Only knowable when `workshop_team` came back — it is projected out for
   * everybody but a Super Admin — so this is `=== false`, not `!attendance`:
   * "unreadable" must not read as "switched off". Where it *is* readable, the desk
   * closes, matching what the mess and hostel scanners do with their `logging`
   * flag instead of letting a volunteer scan into a guaranteed 403.
   */
  const scanningOff = knownMembership?.attendance === false;

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

      {/* The cap used to be a sentence and nothing else, so a volunteer found out
          they were at the limit by turning a student away. This is the same figure
          the backend enforces, counted before the queue reaches it. */}
      {onSpotRoute && onSpotUsed !== null && onSpotAllowance > 0 && (
        <section
          aria-label="On-spot places remaining"
          className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              On-spot places left
            </p>
            <p className="text-2xl font-black leading-none tabular-nums text-ink">
              {onSpotLeft}
              <span className="text-sm font-semibold text-muted">{` / ${onSpotAllowance}`}</span>
            </p>
          </div>
          <ProgressBar
            value={Math.min(onSpotUsed, onSpotAllowance)}
            max={onSpotAllowance}
            tone={
              capReached ? 'danger' : onSpotLeft !== null && onSpotLeft <= 2 ? 'warning' : 'brand'
            }
            label={`${workshop.name} on-spot places used`}
          />
          <p className="text-[11px] text-muted">
            {onSpotExact
              ? `${onSpotUsed} admitted on the spot so far.`
              : `${onSpotUsed} admitted from this device. The fest-wide count is not readable from this account, so the real figure may be higher.`}
          </p>
        </section>
      )}

      {/* Blocking, and before the camera rather than after a refused scan. */}
      {onSpotRoute && capReached && (
        <ResultBanner variant="error" title="Max on-spot capacity (10%) reached">
          Every walk-in place for this workshop is gone. Further scans will be refused — send
          students to the pre-registered desk if they booked, or to another workshop in this slot.
        </ResultBanner>
      )}

      {/* Kept as a banner rather than the blocking `ErrorState` used above,
          because the camera is already down for this case (see the guard on the
          viewfinder) and this explains why. */}
      {scanningOff && (
        <ResultBanner variant="error" title="Scanning disabled for this volunteer">
          A Super Admin has switched your scanning off on this workshop, so every code would be
          refused. Ask them to switch it back on before working this desk.
        </ResultBanner>
      )}

      {/* The camera comes down once the cap is exact and spent: every further scan
          is a guaranteed 400, and holding a queue at a live viewfinder that cannot
          admit anybody is worse than saying so. A ledger-derived count is only a
          floor, so it warns above but never closes the desk. */}
      {!outcome && !scanningOff && !(capReached && onSpotExact) && (
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
