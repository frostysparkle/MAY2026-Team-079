import { useCallback, useEffect, useState } from 'react';
import type { CheckpointType } from '@/config/constants';
import { api } from '@/api';
import { loadSecret, saveSecret } from '@/lib/secretStore';

type Status = 'loading' | 'ready' | 'error';

/**
 * Ensures the device has the TOTP secret for a checkpoint context.
 *
 * - If the secret is already cached (encrypted IndexedDB), it loads offline.
 * - If not, it provisions once from the server (requires network) and caches it.
 *
 * After the first successful provisioning the QR works fully offline, since code
 * generation never touches the network again.
 */
export function useDeviceSecret(context: CheckpointType) {
  const [secret, setSecret] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const ensure = useCallback(async () => {
    setStatus('loading');
    setError(null);
    setSecret(null);
    try {
      const cached = await loadSecret(context);
      if (cached) {
        setSecret(cached);
        setStatus('ready');
        return;
      }
      // First time for this checkpoint — needs connectivity to provision once.
      if (!navigator.onLine) {
        setStatus('error');
        setError('Connect to the internet once to set up this checkpoint, then it works offline.');
        return;
      }
      const { secretBase32 } = await api.provisionSecret({ checkpointContext: context });
      await saveSecret(context, secretBase32);
      setSecret(secretBase32);
      setStatus('ready');
    } catch {
      setStatus('error');
      setError('Could not set up your digital ID. Please try again.');
    }
  }, [context]);

  useEffect(() => {
    void ensure();
  }, [ensure]);

  return { secret, status, error, retry: ensure };
}
