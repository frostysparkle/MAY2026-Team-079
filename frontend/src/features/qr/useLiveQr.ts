import { useEffect, useRef, useState } from 'react';
import type { ScanQRRequest } from '@/api/types';
import { currentParticipant } from '@/stores/authStore';
import { importPublicKeyFromPem, encryptParticipantId } from '@/lib/rsaOaep';

type Status = 'loading' | 'ready' | 'error';

/** Backend rejects a QR older than 60s; refresh comfortably inside that window. */
const REFRESH_INTERVAL_MS = 45_000;

/**
 * Produces a fresh ScanQRRequest every ~45s, encrypted client-side with the
 * public key returned once at login — no network call on refresh. Unlike the
 * old TOTP scheme, one key covers every checkpoint type, so there's no
 * per-checkpoint provisioning step.
 */
export function useLiveQr() {
  const [payload, setPayload] = useState<ScanQRRequest | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(REFRESH_INTERVAL_MS / 1000);
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
      setSecondsRemaining(REFRESH_INTERVAL_MS / 1000);
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
