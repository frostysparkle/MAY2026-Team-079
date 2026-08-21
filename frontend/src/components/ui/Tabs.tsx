import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Tabs for a screen that carries several related jobs — the participant's
 * Help & Support section being the first of them, where asking a question,
 * reporting a fault, and finding somebody to call used to be three separate
 * routes that each explained in prose why they were not the other two.
 *
 * Built as a proper `tablist` rather than a row of links, because the three jobs
 * share one set of figures and one set of loaded data: switching between them is
 * a change of view, not a change of screen. A link would remount the panel and
 * throw away a half-typed report.
 *
 * The visual vocabulary is `ViewToggle`'s — a `bg-surface-2` track with a brand
 * pill on the selection — widened to carry a label and an optional count, so the
 * control reads as part of the same design language rather than as a new one.
 * Below `sm` the row scrolls horizontally on the same terms as `AppShell`'s
 * mobile section nav: three wide labels wrap to three lines otherwise, which
 * pushes the panel off the screen.
 */

export interface TabSpec<T extends string> {
  value: T;
  /** Visible label, and the tab's accessible name together with `badge`. */
  label: string;
  icon?: LucideIcon;
  /** Short label for narrow viewports. Falls back to `label`. */
  shortLabel?: string;
  /** A count beside the label, e.g. how many open reports the tab holds. */
  badge?: number;
}

/**
 * Tab choice kept in `?tab=`, so a shared link opens the tab it was shared from
 * and a refresh does not silently move somebody back to the first one. The same
 * mechanism as `useViewMode`, with one deliberate difference: the fallback is
 * *not* stripped from the URL. This screen's old routes redirect here with an
 * explicit `?tab=`, and a param that vanished on arrival at the default tab
 * would make those redirects read as if they had failed.
 */
export function useTabParam<T extends string>(
  tabs: readonly TabSpec<T>[],
  fallback: T,
): { tab: T; setTab: (next: T) => void } {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');

  const tab = useMemo(
    () => (tabs.some((t) => t.value === raw) ? (raw as T) : fallback),
    [tabs, raw, fallback],
  );

  function setTab(next: T) {
    const search = new URLSearchParams(params);
    search.set('tab', next);
    // `replace` so a run of tab switches does not bury the screen the
    // participant arrived from under a dozen back-button steps.
    setParams(search, { replace: true });
  }

  return { tab, setTab };
}

export function tabId(prefix: string, value: string): string {
  return `${prefix}-tab-${value}`;
}

export function tabPanelId(prefix: string, value: string): string {
  return `${prefix}-panel-${value}`;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  tabs: readonly TabSpec<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name for the tablist, e.g. "Help and support sections". */
  label: string;
  /** Namespace for the generated tab and panel ids, shared with `TabPanel`. */
  idPrefix: string;
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % tabs.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].value);
    // Manual activation would leave focus behind on the old tab; these panels
    // are cheap to switch, so following the selection is the kinder behaviour.
    document.getElementById(tabId(idPrefix, tabs[next].value))?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'no-scrollbar flex items-center gap-1 overflow-x-auto rounded-2xl bg-surface-2 p-1',
        className,
      )}
    >
      {tabs.map((tab, i) => {
        const selected = tab.value === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.value)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.value)}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => onChange(tab.value)}
            className={cn(
              'tap flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors sm:px-4 sm:text-sm sm:tracking-[0.14em]',
              selected ? 'bg-brand text-white shadow-brand' : 'text-muted hover:text-ink',
            )}
          >
            {Icon && <Icon size={15} strokeWidth={2.5} aria-hidden className="shrink-0" />}
            {/* The short label is the same word on a phone, so the accessible
                name never changes with the viewport. */}
            <span className="sm:hidden">{tab.shortLabel ?? tab.label}</span>
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none tabular-nums',
                  selected ? 'bg-white/25 text-white' : 'bg-brand-light text-brand-700',
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One tab's contents.
 *
 * Hidden rather than unmounted when inactive, which is the whole reason this is a
 * tablist and not three routes: a half-filled report survives a trip to the
 * directory to look up a number, and the data a panel loaded is not fetched again
 * on the way back. `mounted` lets a caller defer the *first* render — the
 * contacts panel has its own reads, and a participant who never opens that tab
 * should never pay for them.
 */
export function TabPanel({
  idPrefix,
  value,
  active,
  mounted = true,
  children,
}: {
  idPrefix: string;
  value: string;
  active: boolean;
  mounted?: boolean;
  children: ReactNode;
}) {
  if (!mounted) return null;

  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, value)}
      aria-labelledby={tabId(idPrefix, value)}
      hidden={!active}
      // Only reachable by keyboard when it is the panel on show; a hidden panel
      // with a tab stop is a tab stop into nothing.
      tabIndex={active ? 0 : -1}
      className={cn(active && 'flex flex-col gap-5')}
    >
      {children}
    </div>
  );
}
