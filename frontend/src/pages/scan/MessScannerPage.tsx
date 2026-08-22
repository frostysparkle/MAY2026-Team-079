import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiClientError } from '@/api';
import type { Mess, ScanQRRequest } from '@/api/types';
import { currentStaff } from '@/stores/authStore';
import { overrideFor, resolveMenu, slotAt, timingLabel } from '@/features/mess/messMenu';
import { currentFestDay, FEST_DAYS } from '@/config/festCalendar';
import { ROUTES } from '@/config/routes';
import { useQrScanner } from '@/features/scan/useQrScanner';
import { ScannerViewfinder } from '@/features/scan/ScannerViewfinder';
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
  /** A code has been read and the log is in flight — the camera is already down. */
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .listMess()
      .then((all) => setMess(all.find((m) => m.mess_id === messId) ?? null))
      .catch((e) => setLoadError(e instanceof ApiClientError ? e.message : 'Could not load mess.'));
  }, [messId]);

  const membership = mess?.mess_team?.find((t) => t.user_id === staff?.id);
  const day = currentFestDay();

  // Against this hall's own windows for *today*, not the fest-wide defaults: a
  // hall whose team has moved its breakfast should have that move honoured by the
  // scanner deciding which meal a swipe counts as. With no menu published, the
  // two are the same thing.
  const menu = useMemo(() => resolveMenu(mess, overrideFor(mess)), [mess]);
  const timings = menu.days.find((d) => d.day === day)?.timings ?? menu.timings;
  const slot = slotAt(new Date(), timings);
  const openWindow = timings.find((t) => t.slot === slot);

  async function handleScan(qr: ScanQRRequest) {
    if (!slot) {
      setOutcome({ kind: 'error', message: 'No active meal slot right now.' });
      return;
    }
    setPending(true);
    try {
      const res = await api.scanMess(messId, slot, day, qr);
      setOutcome({ kind: 'success', message: res.message });
    } catch (e) {
      const message = e instanceof ApiClientError ? e.message : 'Scan failed.';
      setOutcome({
        kind: 'error',
        message: message.startsWith('Already logged in') ? 'Already Consumed' : message,
      });
    } finally {
      setPending(false);
    }
  }

  const scanner = useQrScanner(handleScan);

  const back = { label: 'Dashboard', onClick: () => navigate(ROUTES.staffDuties) };

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
        slot && openWindow
          ? `${slot[0].toUpperCase()}${slot.slice(1)}, ${timingLabel(openWindow)}`
          : 'No active slot'
      }`}
      width="md"
      back={back}
    >
      {!outcome && <ScannerViewfinder scanner={scanner} busy={pending} busyLabel="Logging meal…" />}

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
