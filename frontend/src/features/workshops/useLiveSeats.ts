import { useEffect, useState } from 'react';
import type { WorkshopSeatsEvent } from '@/api/types';
import { env } from '@/config/env';

/**
 * Live seat count via SSE (no auth header — GET /workshops/:id/seats/stream
 * is intentionally public). Requires the backend's frame-terminator fix
 * (routers/workshops.py) to emit real newlines; verified against a running
 * backend with curl during the migration's de-risking pass.
 */
export function useLiveSeats(workshopId: string, fallback: WorkshopSeatsEvent | null) {
  const [seats, setSeats] = useState<WorkshopSeatsEvent | null>(fallback);

  useEffect(() => {
    setSeats(fallback);
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`${env.apiBaseUrl}/workshops/${workshopId}/seats/stream`);
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as WorkshopSeatsEvent | { error: string };
        if ('remaining_seats' in data) setSeats(data);
      } catch {
        /* ignore malformed frames */
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
    // fallback intentionally excluded — only re-subscribe when the workshop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId]);

  return seats;
}
