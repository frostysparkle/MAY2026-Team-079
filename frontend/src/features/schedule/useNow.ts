import { useState } from 'react';

/**
 * The current time, read once per mount.
 *
 * Reading the clock straight from render is impure — two renders of the same
 * component would disagree about what "upcoming" means, and `react-hooks/purity`
 * rejects it. A lazy `useState` initialiser reads it exactly once and then holds
 * it, so every render of this mount agrees.
 *
 * Held rather than ticking on purpose: nothing here counts down, it only splits
 * the schedule into past and future. A page that needs a live clock should own an
 * interval instead.
 */
export function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}
