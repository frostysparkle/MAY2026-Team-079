import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { decodeQrPayload } from '@/features/qr/payload';
import type { ScanQRRequest } from '@/api/types';

const READER_ID = 'qr-reader';

/**
 * Owns the html5-qrcode camera lifecycle: starts on mount, decodes each frame,
 * fires `onScan` once with a valid ScanQRRequest, then stops itself. There is
 * no manual-entry fallback — under the RSA-OAEP scheme nothing a human can
 * type substitutes for a real ciphertext, so camera failure is a dead end
 * with only "retry camera" to offer.
 */
export function useQrScanner(onScan: (payload: ScanQRRequest) => void) {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    const scanner = new Html5Qrcode(READER_ID);
    let stopped = false;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
          if (stopped) return;
          const payload = decodeQrPayload(decodedText);
          if (!payload) return; // ignore unrelated/invalid QR silently
          stopped = true;
          scanner
            .stop()
            .catch(() => undefined)
            .finally(() => onScanRef.current(payload));
        },
        () => undefined, // per-frame decode failures are normal; ignore
      )
      .catch(() => setCameraError('Camera unavailable — check permissions and reload.'));

    return () => {
      stopped = true;
      scanner.stop().catch(() => undefined);
    };
  }, [attempt]);

  return { readerId: READER_ID, cameraError, retry: () => setAttempt((a) => a + 1) };
}
