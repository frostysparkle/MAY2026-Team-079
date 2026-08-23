import { useState } from 'react';
import type { FormEvent } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Button, BUTTON_ICON, BUTTON_ICON_STROKE, Spinner, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * The AI recommendations banner/search row shared by `EventsListPage` and
 * `WorkshopsListPage`.
 *
 * This is not a keyword search — the query (or, if left blank, the
 * participant's previously saved preference) is embedded and compared against
 * every event/workshop's own embedding by similarity, and the whole
 * catalogue is re-ranked by it. Nothing is hidden: a search only changes the
 * order cards appear in, which is why the collapsed state calls it out with
 * a distinct banner (`Sparkles`) and the active state keeps a visible pill on
 * screen — a participant scrolling past card 30 must still be able to tell
 * this is a ranked view, not the plain list.
 *
 * Collapsed → expanded → active is one row throughout, never a modal or a
 * separate page, per the brief ("appear in the same row… stay on the same
 * page").
 */
export function AiRecommendBar({
  noun,
  placeholder,
  active,
  loading,
  onSearch,
  onClear,
}: {
  /** "events" | "workshops" — drives the copy. */
  noun: string;
  placeholder: string;
  /** Whether a recommendation ranking is currently applied to the page. */
  active: boolean;
  /** True while a request for a new ranking is in flight. */
  loading: boolean;
  /** Called with the trimmed query — may be `''`, which asks the backend to
   * fall back to the participant's saved preference embedding. */
  onSearch: (query: string) => void;
  /** Drop the ranking and return to the normal list. */
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const expanded = open || active;

  function submit(e: FormEvent) {
    e.preventDefault();
    onSearch(query.trim());
  }

  function close() {
    setOpen(false);
    setQuery('');
    if (active) onClear();
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 transition-colors sm:flex-row sm:items-center sm:gap-4',
        active
          ? 'border-brand/30 bg-brand-50'
          : 'border-line bg-surface shadow-card',
      )}
    >
      <div className="flex flex-1 items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            active ? 'bg-brand text-white' : 'bg-brand-50 text-brand',
          )}
        >
          <Sparkles size={17} strokeWidth={2.25} />
        </span>

        {!expanded ? (
          <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              Need help finding {noun} you&apos;ll love?
            </p>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              <Sparkles size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} />
              Try AI recommendations
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-1 flex-wrap items-center gap-2">
            <label htmlFor={`ai-search-${noun}`} className="sr-only">
              Describe what you&apos;re looking for
            </label>
            <input
              id={`ai-search-${noun}`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="min-w-48 flex-1 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/25"
            />
            <Button type="submit" size="sm" loading={loading}>
              <Sparkles size={BUTTON_ICON.sm} strokeWidth={BUTTON_ICON_STROKE} />
              Recommend
            </Button>
          </form>
        )}
      </div>

      {expanded && (
        <div className="flex items-center gap-2">
          {active && !loading && (
            <StatusBadge tone="info" className="shrink-0">
              Sorted by match
            </StatusBadge>
          )}
          {loading && <Spinner size={16} />}
          <button
            type="button"
            onClick={close}
            className="tap inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-line"
          >
            <X size={12} strokeWidth={3} aria-hidden />
            {active ? 'Clear' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}
