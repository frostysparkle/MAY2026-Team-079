import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Lightweight route transition. Re-keys on the pathname so the browser replays
 * the CSS `rise` animation on every navigation — a native-feeling fade+slide
 * with zero animation-library weight. Honors prefers-reduced-motion via the
 * global stylesheet.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-rise">
      {children}
    </div>
  );
}
