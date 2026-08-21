import { CameraOff, ScanLine } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import type { QrScanner } from './useQrScanner';

/**
 * The viewfinder every checkpoint screen renders — mess, hostel, event, and both
 * workshop desks.
 *
 * One component rather than four copies of the same markup, because the contract
 * with `useQrScanner` is easy to get subtly wrong: the container must carry both
 * `readerId` *and* `containerRef` (the ref is what starts the camera), and nothing
 * may be rendered *inside* it, since html5-qrcode injects the video and canvas
 * there and React would fight it for ownership of those children. Both rules are
 * kept here once, so a screen can only get them right.
 *
 * `busy` covers the gap between a code being read and the server answering. The
 * camera has already stopped by then, so without it the panel goes blank for the
 * length of a round trip — which reads as a scanner that died mid-scan.
 */
export function ScannerViewfinder({
  scanner,
  busy = false,
  busyLabel = 'Checking…',
}: {
  scanner: QrScanner;
  busy?: boolean;
  busyLabel?: string;
}) {
  const { readerId, containerRef, status, cameraError, retry } = scanner;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative min-h-[260px] overflow-hidden rounded-2xl bg-ink/90">
        {/* Owned by html5-qrcode from here down — deliberately childless. */}
        <div id={readerId} ref={containerRef} className="w-full" />

        {(status === 'idle' || status === 'starting') && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
            <Spinner size={28} label="Starting camera" />
            <p className="text-sm opacity-90">Starting camera…</p>
          </div>
        )}

        {status === 'error' && !busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
            <CameraOff size={28} aria-hidden />
            <p className="text-sm font-semibold">Camera unavailable</p>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/80 px-6 text-center text-white">
            <Spinner size={28} label={busyLabel} />
            <p className="text-sm opacity-90">{busyLabel}</p>
          </div>
        )}
      </div>

      {status === 'scanning' && !busy && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          <ScanLine size={13} aria-hidden /> Hold the participant’s code inside the frame.
        </p>
      )}

      {cameraError && (
        <div className="flex flex-col items-center gap-3">
          <p role="alert" className="text-center text-sm text-danger">
            {cameraError}
          </p>
          <Button variant="secondary" onClick={retry}>
            Retry camera
          </Button>
        </div>
      )}
    </div>
  );
}
