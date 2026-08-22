/**
 * The guide's §5 status→action table, as one function.
 *
 * | Code | What the user is told |
 * |---|---|
 * | 400 | the exact `detail` string, in a toast |
 * | 401 | nothing here — `App.tsx` clears the session and the route guard redirects |
 * | 403 | "Access Denied", with the server's reason |
 * | 404 | nothing here — the screen owns its empty/error state |
 * | 409 | the exact `detail` string, in a toast |
 * | 422 | nothing here — the screen marks the offending fields |
 *
 * The three that return nothing are deliberate rather than unhandled: each has a
 * better surface than a toast that disappears in three seconds. A 404 is a page
 * state, a 422 belongs against the input it is about, and a 401 is a redirect.
 *
 * Call this *in addition to* whatever inline state a screen keeps. On a long admin
 * page the failure banner is often scrolled off, and a toast is the only thing that
 * reaches somebody who pressed a button at the bottom of a list — which is exactly
 * the case §5 was written for. Screens whose primary surface must persist (the four
 * scanners, and forms with field-level errors) keep that surface and do not call
 * this, because the exact `detail` is already the loudest thing on them.
 */
import { ApiClientError } from './ApiClient';
import { toast } from '@/stores/uiStore';

/** Statuses whose reporting belongs to the screen, not to a toast. */
const SCREEN_OWNED = new Set([401, 404, 422]);

/**
 * Announce a failed request. Returns the message it used, so a caller can put the
 * same words in its own inline state without formatting them twice.
 */
export function reportApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) {
    toast.error(fallback);
    return fallback;
  }

  const detail = error.message.trim() || fallback;

  if (SCREEN_OWNED.has(error.status)) return detail;

  if (error.status === 403) {
    // Named as the guide names it, with the server's reason kept — "Access Denied"
    // alone does not tell somebody which permission they are missing.
    toast.error(`Access Denied — ${detail}`);
    return detail;
  }

  toast.error(detail);
  return detail;
}
