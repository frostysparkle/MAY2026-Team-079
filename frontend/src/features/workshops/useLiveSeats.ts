import { useEffect, useRef, useState } from 'react';
import type { WorkshopSeatsEvent } from '@/api/types';
import { env } from '@/config/env';

/**
 * Live seat count via SSE (no auth header — GET /workshops/:id/seats/stream
 * is intentionally public). Requires the backend's frame-terminator fix
 * (routers/workshops.py) to emit real newlines; verified against a running
 * backend with curl during the migration's de-risking pass.
 *
 * Reconnects on its own. `onerror` used to call `source.close()`, which does more
 * than it looks like: closing the stream also cancels `EventSource`'s *built-in*
 * retry, so one dropped connection — a tunnel, a sleeping laptop, a backend
 * restart — froze the badge at its last value for as long as the page stayed
 * open, with nothing on screen to say the number had stopped moving. The retry
 * below backs off so a backend that is down does not get hammered by every open
 * card, and gives up after a few attempts rather than reconnecting forever in a
 * background tab.
 */

/** Backoff between reconnect attempts, in milliseconds. */
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

export interface LiveSeats extends WorkshopSeatsEvent {
  /**
   * False once the stream has dropped and not yet come back. The figures are the
   * last ones received and may be stale — a caller showing them prominently can
   * mark them rather than presenting a frozen number as live.
   */
  live: boolean;
}

export function useLiveSeats(
  workshopId: string,
  fallback: WorkshopSeatsEvent | null,
): LiveSeats | null {
  const [seats, setSeats] = useState<WorkshopSeatsEvent | null>(fallback);
  const [live, setLive] = useState(false);
  /** Timer for the next reconnect, so unmount can cancel a pending one. */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSeats(fallback);
    setLive(false);
    if (typeof EventSource === 'undefined') return;

    let disposed = false;
    let source: EventSource | null = null;
    let attempt = 0;

    function connect() {
      if (disposed) return;
      source = new EventSource(`${env.apiBaseUrl}/workshops/${workshopId}/seats/stream`);

      source.onopen = () => {
        if (disposed) return;
        // A frame has to arrive before the count is trustworthy, but the
        // connection being up is what "live" means for the staleness marker.
        setLive(true);
        attempt = 0;
      };

      source.onmessage = (e) => {
        if (disposed) return;
        try {
          const data = JSON.parse(e.data) as WorkshopSeatsEvent | { error: string };
          // The backend sends `{"error": "Workshop not found"}` and then stops;
          // discard it rather than letting it through as a seat count.
          if ('remaining_seats' in data) {
            setSeats(data);
            setLive(true);
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      source.onerror = () => {
        if (disposed) return;
        setLive(false);
        // Close before retrying: EventSource's own reconnect is not cancellable
        // and would race the scheduled attempt below.
        source?.close();
        source = null;

        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) return; // Given up; the last figures stay on screen.
        attempt += 1;
        retryTimer.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (retryTimer.current !== null) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      source?.close();
    };
    // fallback intentionally excluded — only re-subscribe when the workshop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId]);

  return seats === null ? null : { ...seats, live };
}
