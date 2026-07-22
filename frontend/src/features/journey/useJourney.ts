import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { Journey } from '@/api/types';

type Status = 'loading' | 'error' | 'ready';

/**
 * Loads the signed-in student's derived onboarding journey. Exposes a `reload`
 * so screens can refresh after completing a step. Never throws — a load failure
 * surfaces as `status === 'error'` with a `reload` retry (Req 3.4).
 */
export function useJourney() {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const j = await api.getJourney();
      setJourney(j);
      setStatus('ready');
      return j;
    } catch {
      setStatus('error');
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { journey, status, reload };
}
