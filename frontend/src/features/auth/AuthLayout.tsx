import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/config/routes';
import { AuroraBackdrop } from '@/features/landing/AuroraBackdrop';

/**
 * Shared branded shell for every pre-app screen (sign-in, complete profile,
 * onboarding, access denied, checkout). Carries the same identity as the public
 * landing — the festival-sky backdrop and the Paradox Connect wordmark — so the
 * experience stays cohesive from the landing page all the way into the app.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  onBack,
  size = 'sm',
  header,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  /** `sm` for sign-in/short screens, `md` for longer forms. */
  size?: 'sm' | 'md';
  /** Optional custom node rendered above the title (e.g. a progress header). */
  header?: ReactNode;
}) {
  const navigate = useNavigate();
  const maxW = size === 'md' ? 'max-w-lg' : 'max-w-md';

  return (
    <div className="relative min-h-full overflow-hidden bg-canvas text-ink">
      <AuroraBackdrop />

      <div className={`relative mx-auto flex min-h-full w-full ${maxW} flex-col gap-6 px-6 py-8`}>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(ROUTES.splash)}
            className="tap flex items-center gap-2"
            aria-label="Paradox Connect home"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-accent text-base font-black text-white shadow-fab">
              P
            </span>
            <span className="text-base font-black tracking-tight">Paradox Connect</span>
          </button>

          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="tap rounded-full px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-ink active:scale-95"
            >
              ‹ Back
            </button>
          )}
        </div>

        <div className="animate-rise flex flex-1 flex-col justify-center gap-6">
          {header}

          {(title || subtitle) && (
            <div>
              {title && (
                <h1 className="text-2xl font-black tracking-tight text-ink sm:text-3xl">{title}</h1>
              )}
              {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
