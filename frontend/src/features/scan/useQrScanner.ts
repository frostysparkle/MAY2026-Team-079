import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { decodeQrPayload } from '@/features/qr/payload';
import type { ScanQRRequest } from '@/api/types';

/**
 * Id of the viewfinder container. html5-qrcode addresses its root element by id
 * rather than by node, so the container needs one — but the *lifecycle* is driven
 * by the callback ref below, not by this id. See `containerRef`.
 */
const READER_ID = 'qr-reader';

/** html5-qrcode refuses a scan box smaller than this. */
const MIN_QR_BOX = 50;

export type ScannerStatus = 'idle' | 'starting' | 'scanning' | 'error';

export interface QrScanner {
  /** Id to put on the viewfinder container. */
  readerId: string;
  /**
   * Callback ref for the viewfinder container. Attaching this is what starts the
   * camera, so it must be on the same element that carries `readerId`.
   */
  containerRef: (node: HTMLDivElement | null) => void;
  status: ScannerStatus;
  cameraError: string | null;
  /** Tear the camera down and start it again. Clears `cameraError` first. */
  retry: () => void;
}

/**
 * A scan box sized to the stream it is drawn on.
 *
 * A fixed pixel box (this was `qrbox: 220`) is wrong on both ends: on a narrow
 * phone it is wider than the video, so html5-qrcode silently truncates it and the
 * shaded guide no longer matches the region actually decoded; on a wide tablet it
 * is a postage stamp in the middle of the frame. Deriving it from the viewfinder
 * keeps the guide honest at every size.
 */
function fitQrBox(viewfinderWidth: number, viewfinderHeight: number) {
  const box = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
  return {
    width: Math.max(MIN_QR_BOX, Math.min(box, viewfinderWidth)),
    height: Math.max(MIN_QR_BOX, Math.min(box, viewfinderHeight)),
  };
}

/**
 * html5-qrcode rejects with raw strings and with whatever `getUserMedia` threw.
 * A volunteer at a checkpoint can act on "permission was refused" and cannot act
 * on "Error getting userMedia, error = NotAllowedError", so name the causes we
 * can recognise and keep a usable fallback for the rest.
 */
function describeCameraError(error: unknown): string {
  const raw =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error ?? '');

  if (/NotAllowedError|SecurityError|Permission|denied|dismissed/i.test(raw)) {
    return 'Camera permission was refused. Allow camera access for this site in your browser, then retry.';
  }
  if (/NotFoundError|DevicesNotFound|OverconstrainedError|Requested device not found/i.test(raw)) {
    return 'No camera was found on this device. Connect or enable one, then retry.';
  }
  if (/NotReadableError|TrackStartError|AbortError|in use/i.test(raw)) {
    return 'The camera is already in use by another app or tab. Close it, then retry.';
  }
  if (/secure context|https|not supported|streaming not supported/i.test(raw)) {
    return 'This browser cannot open a camera here — the page must be served over HTTPS (or localhost).';
  }
  return 'Camera could not be started. Check the camera permission for this site, then retry.';
}

/**
 * Stop a scanner without throwing.
 *
 * `Html5Qrcode.stop()` throws *synchronously* when the scanner is not running,
 * so `scanner.stop().catch(...)` does not catch it — the throw escapes. That
 * matters most in an effect cleanup, where an escaping error takes the unmount
 * (and therefore the page) with it. Guarding on the reported state and wrapping
 * the whole thing keeps teardown a no-op when there is nothing to tear down.
 *
 * `clear()` throws on the same terms, so it only runs once the state says the
 * camera really is down. It removes the video and canvas html5-qrcode injected,
 * which React does not know about and so will never clean up itself.
 */
async function stopQuietly(scanner: Html5Qrcode): Promise<void> {
  try {
    if (scanner.getState() !== Html5QrcodeScannerState.NOT_STARTED) {
      await scanner.stop();
    }
  } catch {
    // Already stopped, or the stream went away with the page. Either way there
    // is nothing left to close.
  }
  try {
    if (scanner.getState() === Html5QrcodeScannerState.NOT_STARTED) {
      scanner.clear();
    }
  } catch {
    // Container already detached by React.
  }
}

/**
 * Owns the html5-qrcode camera lifecycle for one checkpoint screen: starts the
 * camera once its container is in the DOM, decodes frames, fires `onScan` once
 * with a valid `ScanQRRequest`, then stops itself.
 *
 * The camera is started from a **callback ref**, not on mount. Every scanner
 * screen loads its venue first and renders a spinner while it does, so on mount
 * the viewfinder container does not exist yet — and `new Html5Qrcode(id)` throws
 * `HTML Element with id=... not found` when its element is missing. Keying the
 * lifecycle to the container node means the camera starts exactly when there is
 * something to draw it into, whether that is after the venue loads, after a
 * result is dismissed, or after a retry.
 *
 * Sessions are also serialised through one promise chain. `start()` is async and
 * cannot be cancelled, so without the chain a fast unmount/remount (React's
 * StrictMode double-invoke does exactly this) would leave the first `getUserMedia`
 * still resolving while a second scanner attached to the same element — two live
 * streams, two videos, and a camera that stays on after the volunteer leaves the
 * page. Each session now waits for the previous one to finish stopping.
 *
 * There is no manual-entry fallback: under the RSA-OAEP scheme nothing a human
 * can type substitutes for a real ciphertext, so camera failure is a dead end
 * with only "retry camera" to offer.
 */
export function useQrScanner(onScan: (payload: ScanQRRequest) => void): QrScanner {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // `onScan` is redefined every render (it closes over the page's current slot,
  // day or entry/exit toggle) but the camera session must outlive those renders,
  // so the decode callback reads the latest one through a ref.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  /** Tail of the serialised session chain. Never rejects. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback((task: () => Promise<void> | void): Promise<unknown> => {
    chainRef.current = chainRef.current.then(task).catch(() => undefined);
    return chainRef.current;
  }, []);

  useEffect(() => {
    if (!container) return;

    // html5-qrcode addresses its root by id, so the ref'd node must carry one.
    // `ScannerViewfinder` puts `readerId` on the same element as `containerRef`.
    const elementId = container.id;

    let disposed = false;
    let handled = false;
    let scanner: Html5Qrcode | null = null;

    function handleDecoded(decodedText: string) {
      if (handled || disposed) return;
      const payload = decodeQrPayload(decodedText);
      // Not one of our codes — a poster, a UPI QR, a delegate's old pass. Ignore
      // it and keep scanning rather than reporting a failure.
      if (!payload) return;
      handled = true;
      void enqueue(async () => {
        if (scanner) await stopQuietly(scanner);
        if (disposed) return;
        setStatus('idle');
        onScanRef.current(payload);
      });
    }

    enqueue(async () => {
      // The container can go away while this session waited its turn.
      if (disposed) return;
      if (!elementId || document.getElementById(elementId) !== container) {
        setStatus('error');
        setCameraError('The scanner could not attach to this page. Reload and try again.');
        return;
      }

      setStatus('starting');
      setCameraError(null);

      let instance: Html5Qrcode;
      try {
        instance = new Html5Qrcode(elementId);
      } catch (error) {
        setStatus('error');
        setCameraError(describeCameraError(error));
        return;
      }
      scanner = instance;

      try {
        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: fitQrBox },
          handleDecoded,
          () => undefined, // per-frame decode misses are normal; ignore them
        );
        if (disposed) return;
        setStatus('scanning');
      } catch (error) {
        // A failed start can still have injected a half-built viewfinder.
        await stopQuietly(instance);
        scanner = null;
        if (disposed) return;
        setStatus('error');
        setCameraError(describeCameraError(error));
      }
    });

    return () => {
      disposed = true;
      void enqueue(async () => {
        if (scanner) await stopQuietly(scanner);
        scanner = null;
      });
    };
  }, [container, attempt, enqueue]);

  const retry = useCallback(() => {
    setCameraError(null);
    setStatus('idle');
    setAttempt((a) => a + 1);
  }, []);

  return { readerId: READER_ID, containerRef: setContainer, status, cameraError, retry };
}
