import { useEffect, useState } from 'react';

/**
 * A clock that re-renders its consumer every `intervalMs`.
 *
 * Reading `Date.now()` during render is impure, and it is also simply wrong for
 * the board's "updated Ns ago" lines: the age would freeze at whatever it was
 * when the panel last rendered for some other reason, so a stale board would
 * keep claiming it was updated seconds ago. Ten seconds is fine granularity for
 * a figure displayed in whole seconds and then whole minutes.
 *
 * Lives in its own module because both `Staleness` and the live indicators need
 * it, and a module that exports a hook alongside components breaks fast refresh
 * for every component in it.
 */
export function useTick(intervalMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
