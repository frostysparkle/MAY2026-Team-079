import type { ReactNode } from 'react';

/**
 * Sticky, frosted page header for standalone (non-shell) screens: an optional
 * back affordance, a title/subtitle, and an optional trailing action. Respects
 * the top safe area so it sits cleanly under a notch/status bar.
 */
export function PageHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="glass safe-top sticky top-0 z-30 border-b border-line/60">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 lg:max-w-5xl lg:px-6">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Go back"
            className="tap -ml-1 flex h-9 w-9 items-center justify-center rounded-full text-ink hover:bg-surface-2 active:scale-90"
          >
            <span aria-hidden className="text-xl">
              ‹
            </span>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold text-ink">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
