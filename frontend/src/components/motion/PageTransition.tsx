import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Lightweight route transition. Re-keys on the pathname so the CSS `rise`
 * animation replays on every navigation — a native-feeling fade+slide with no
 * animation-library weight.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div key={location.pathname} className="animate-rise">
      {children}
    </div>
  );
}
