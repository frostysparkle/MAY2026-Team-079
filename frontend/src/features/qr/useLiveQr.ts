import { useEffect, useRef, useState } from 'react';
import type { ScanQRRequest } from '@/api/types';
import { currentParticipant } from '@/stores/authStore';
import { importPublicKeyFromPem, encryptParticipantId } from '@/lib/rsaOaep';

type Status = 'loading' | 'ready' | 'error';

/**
 * What the hook hands back. Named so the pass card can take the whole live-QR
 * state as one prop instead of re-running the hook — two instances would mean
 * two encryption timers producing two different codes on the same screen.
 */
export interface LiveQr {
  payload: ScanQRRequest | null;
  status: Status;
  error: string | null;
  secondsRemaining: number;
  retry: () => Promise<void>;
}

/** Backend rejects a QR older than 60s; refresh comfortably inside that window. */
const REFRESH_INTERVAL_MS = 45_000;

/**
 * The same window in seconds, exported so the screen showing the pass can draw
 * `secondsRemaining` as a share of it instead of hardcoding a second copy of
 * the interval that could drift from this one.
 */
export const QR_REFRESH_SECONDS = REFRESH_INTERVAL_MS / 1000;

/**
 * Produces a fresh ScanQRRequest every ~45s, encrypted client-side with the
 * public key returned once at login — no network call on refresh. Unlike the
 * old TOTP scheme, one key covers every checkpoint type, so there's no
 * per-checkpoint provisioning step.
 */
export function useLiveQr(): LiveQr {
  const [payload, setPayload] = useState<ScanQRRequest | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(QR_REFRESH_SECONDS);
  const keyRef = useRef<CryptoKey | null>(null);

  const participant = currentParticipant();

  async function refresh() {
    if (!participant?.public_key) {
      setStatus('error');
      setError('Your digital ID key is missing. Please sign in again.');
      return;
    }
    try {
      if (!keyRef.current) {
        keyRef.current = await importPublicKeyFromPem(participant.public_key);
      }
      const data = await encryptParticipantId(keyRef.current, participant.id);
      setPayload({ participant_id: participant.id, data, timestamp: new Date().toISOString() });
      setSecondsRemaining(QR_REFRESH_SECONDS);
      setStatus('ready');
      setError(null);
    } catch {
      setStatus('error');
      setError('Could not generate your digital ID. Please try again.');
    }
  }

  useEffect(() => {
    void refresh();
    const refreshId = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const tickId = setInterval(() => setSecondsRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => {
      clearInterval(refreshId);
      clearInterval(tickId);
    };
    // participant.id / public_key don't change mid-session — refresh only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { payload, status, error, secondsRemaining, retry: refresh };
}
