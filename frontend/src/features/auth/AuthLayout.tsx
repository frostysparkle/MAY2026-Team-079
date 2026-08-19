import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ROUTES } from '@/config/routes';
import { AuroraBackdrop } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * Shared branded shell for every pre-app screen (sign-in, register, forgot /
 * reset password, staff sign-in). Carries the same identity as the public
 * landing — the festival-sky backdrop and the Paradox Connect wordmark pinned to
 * the top-left corner — so the experience stays cohesive from the landing page
 * all the way into the app.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  backTo,
  mark,
  markInline = false,
  size = 'sm',
  align = 'center',
  fit = false,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Route to return to; renders a gradient back button. Omit to hide it. */
  backTo?: string;
  /** Brand mark / icon rendered above the title. */
  mark?: ReactNode;
  /** Sets the mark beside the title on one row instead of above it. */
  markInline?: boolean;
  /** `xs` for compact single-purpose cards (sign-in), `sm` for short screens,
   *  `md` for longer forms, `lg` for wide multi-column forms, `xl` for a form
   *  plus a side rail (Complete Your Profile) — the widest the signed-in
   *  screens use for a two-region layout. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Vertical alignment. `center` (default) suits short screens; `top` keeps
   * taller flows anchored to the top so they read the same on phones and
   * laptops.
   */
  align?: 'center' | 'top';
  /** Tighter spacing for short flows, while retaining document scrolling for
   *  small screens, landscape, browser zoom, and virtual keyboards. */
  fit?: boolean;
}) {
  const navigate = useNavigate();
  const maxW =
    size === 'xl'
      ? 'max-w-6xl'
      : size === 'lg'
        ? 'max-w-3xl'
        : size === 'md'
          ? 'max-w-lg'
          : size === 'xs'
            ? 'max-w-sm'
            : 'max-w-md';

  return (
    <div className="relative flex min-h-full flex-col overflow-y-auto overflow-x-hidden bg-canvas text-ink">
      <AuroraBackdrop />

      {/* Brand — pinned to the page's top-left corner with the same edge
          padding as the landing hero, so the wordmark sits in an identical
          position across the landing and every auth screen. */}
      <header className="safe-top relative z-20 flex w-full items-center px-5 py-5 sm:px-7 sm:py-6">
        <button
          type="button"
          onClick={() => navigate(ROUTES.splash)}
          className="tap flex min-w-0 items-center gap-2"
          aria-label="Paradox Connect home"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
            P
          </span>
          <span className="truncate text-base font-black tracking-tight">Paradox Connect</span>
        </button>
      </header>

      <div
        className={cn(
          'safe-bottom relative mx-auto flex w-full flex-col px-4 sm:px-6',
          maxW,
          fit ? 'min-h-0 flex-1 gap-4 pb-4' : 'gap-6 pb-6 sm:pb-8',
        )}
      >
        <div
          className={cn(
            'animate-rise relative flex flex-1 flex-col',
            align === 'top' ? 'justify-start' : 'justify-center',
            fit ? 'min-h-0 gap-4 py-0' : 'gap-6 py-4',
          )}
        >
          {backTo && (
            <button
              type="button"
              onClick={() => navigate(backTo)}
              aria-label="Go back"
              title="Back"
              className="group mb-1 flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-full"
            >
              {/* The lift is on the inner span so the button's box — and the
                  hover boundary with it — stays still. */}
              <span className="tap flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-brand via-violet-500 to-accent text-white shadow-fab ring-1 ring-white/30 transition group-hover:-translate-y-0.5 group-hover:brightness-105 group-active:scale-95">
                <ArrowLeft size={22} strokeWidth={2.2} />
              </span>
            </button>
          )}

          {(mark || title || subtitle) && (
            <div>
              <div className={cn(markInline && 'flex items-center gap-3')}>
                {mark}
                {title && (
                  <h1
                    className={cn(
                      'text-2xl font-black tracking-tight text-ink sm:text-3xl',
                      Boolean(mark) && !markInline && 'mt-3',
                    )}
                  >
                    {title}
                  </h1>
                )}
              </div>
              {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}

/** The indigo→pink gradient "P" mark used across participant auth screens. */
export function BrandMark() {
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-xl font-bold text-white shadow-fab">
      P
    </div>
  );
}
