import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The layout for every signed-in screen — staff, admin, and participant alike:
 * the public site's festival theme, being the eyebrow, the big gradient title,
 * and the centred column the landing and brochure pages use. `StaffShell` and
 * `AppShell` each supply the aurora backdrop behind it.
 *
 * This is the *only* dashboard layout, on purpose. There used to be a second one
 * (`AdminScreen`, which handed its title up to a bar in the shell), and the two
 * drifted apart section by section until the dashboard no longer looked like the
 * site it administers. The participant area drifted the same way for the same
 * reason — it had no shared layout at all, so every page hand-rolled a small
 * `h1` over a phone-width column. One layout means a new screen is themed by
 * default rather than by remembering to be, whichever area it belongs to.
 *
 * `eyebrow` is what distinguishes the areas: "Super Admin" for the admin
 * dashboard, a staffer's designation for the staff one, a participant's house
 * for theirs. Everything below it is deliberately identical.
 *
 * Pages render their own title here, so the shell's bar stays transparent and
 * carries navigation only.
 */

const MAX_W = {
  md: 'max-w-3xl',
  lg: 'max-w-4xl',
  // `xl` is the default, so this is the width of every list and dashboard.
  // It sits next to the shells' 240px rail: capping it at 6xl left a wide window
  // with a broad empty margin on the right of every table of cards, when those
  // grids can simply use it.
  xl: 'max-w-7xl',
} as const;

export function FestivalScreen({
  title,
  eyebrow = 'Super Admin',
  subtitle,
  back,
  actions,
  width = 'xl',
  children,
}: {
  /** Big gradient title, e.g. "EVENTS". */
  title: string;
  /** Small caps line above the title. */
  eyebrow?: string;
  /** One line under the title, centred with it. */
  subtitle?: ReactNode;
  /** Back affordance: a label plus what to do. */
  back?: { label: string; onClick: () => void };
  /** Buttons rendered under the title, centred. */
  actions?: ReactNode;
  width?: keyof typeof MAX_W;
  children: ReactNode;
}) {
  return (
    <div className={cn('animate-rise mx-auto w-full px-4 pb-20 pt-6 sm:px-6', MAX_W[width])}>
      {back && (
        <div className="mb-6">
          <button
            type="button"
            onClick={back.onClick}
            className="tap inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-card ring-1 ring-line transition hover:bg-surface-2 active:scale-95"
          >
            <ChevronLeft size={16} strokeWidth={2.25} />
            {back.label}
          </button>
        </div>
      )}

      <div className="flex flex-col items-center text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.35em] text-brand">
          {eyebrow}
        </p>
        <h1 className="text-gradient text-5xl font-black uppercase leading-none tracking-tight sm:text-6xl">
          {title}
        </h1>
        {subtitle && <p className="mt-3 text-sm leading-6 text-muted">{subtitle}</p>}
        {actions && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-5">{children}</div>
    </div>
  );
}
