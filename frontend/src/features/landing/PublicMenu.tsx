import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, ShieldCheck, X } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { cn } from '@/lib/cn';

/**
 * Square three-line menu button for the public site chrome. It holds the
 * staff/volunteer entry point only — the public pages (Home, Events, Schedule,
 * Workshops, Sponsors) are already listed by the surrounding chrome at every
 * viewport: the perimeter nav in `ParadoxPortal` and the left rail / wrapped
 * section row in `PublicPageChrome`. Repeating them here just gave the same
 * five labels twice on one screen.
 *
 * Staff sign-in lives on a separate backend endpoint (`POST /auth/admin/login`)
 * from participant sign-in, so this links to `ROUTES.adminLogin` directly rather
 * than passing a "portal" hint into the participant login page.
 */

export function PublicMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // Close whenever the route changes — the panel's own links trigger this.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="tap flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink hover:bg-surface hover:shadow-card active:scale-95"
      >
        {open ? <X size={20} strokeWidth={2.25} /> : <Menu size={20} strokeWidth={2.25} />}
      </button>

      {open && (
        <div
          id={panelId}
          // Solid surface, not `glass`: the panel floats over the aurora
          // backdrop's pink/violet blobs, and a translucent fill left the labels
          // unreadable against them.
          className="animate-pop absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 overflow-hidden rounded-2xl bg-surface py-2 shadow-lift ring-1 ring-line"
        >
          <Link
            to={ROUTES.adminLogin}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-brand hover:bg-brand-light"
          >
            <ShieldCheck size={16} strokeWidth={2.25} className="shrink-0" />
            Staff / Volunteer Login
          </Link>
        </div>
      )}
    </div>
  );
}
