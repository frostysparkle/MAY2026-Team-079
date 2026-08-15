import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { announce } from '@/components/a11y/Announcer';
import { ANY, type FilterSpec, type ListFilters } from './ListFilterBar';

/**
 * A single-row toolbar for a table: search, the filters that matter most, a
 * disclosure for the rest, and a slot for view controls.
 *
 * The sibling of `ListFilterBar`, which stacks the same controls into a panel
 * with each field labelled above it. That reads well over a card list; over a
 * table it doubles the height of the header before a single row is visible. Both
 * drive the same URL-backed `useListFilters` state, so a page can swap between
 * them without changing anything else.
 *
 * Every control here is still labelled — the labels are just visually hidden,
 * with the chosen option ("All Gender") carrying the meaning on screen.
 */
export function ListToolbar({
  filters,
  specs,
  advancedSpecs = [],
  searchLabel = 'Search',
  searchPlaceholder,
  shown,
  total,
  noun = 'items',
  trailing,
}: {
  filters: ListFilters;
  /** Filters shown inline, always visible. */
  specs: FilterSpec[];
  /** Filters behind the "Filters" disclosure. */
  advancedSpecs?: FilterSpec[];
  searchLabel?: string;
  searchPlaceholder?: string;
  shown: number;
  total: number;
  noun?: string;
  /** Right-hand slot, e.g. a view toggle. */
  trailing?: ReactNode;
}) {
  const searchId = useId();
  const panelId = useId();

  const activeAdvanced = advancedSpecs.filter(
    (spec) => (filters.values[spec.key] ?? ANY) !== ANY,
  ).length;
  // Opens automatically when a shared link arrives with an advanced filter set,
  // so the reason the list looks narrowed is never hidden behind a button.
  const [open, setOpen] = useState(activeAdvanced > 0);

  const signature = filters.signature;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === null) {
      previous.current = signature;
      return;
    }
    if (previous.current === signature) return;
    previous.current = signature;
    announce(shown === 0 ? `No ${noun} match these filters` : `${shown} of ${total} ${noun} shown`);
    // `shown`/`total` are read, not depended on: only filter changes announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    // role="search" is redundant on <search> per spec, but the element only
    // shipped in 2023 and older assistive tech (and jsdom) don't map its
    // implicit role yet.
    <search role="search" aria-label={`Filter ${noun}`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="relative min-w-56 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel}
          </label>
          <Search
            aria-hidden
            size={16}
            strokeWidth={2.25}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id={searchId}
            type="search"
            placeholder={searchPlaceholder}
            value={filters.search}
            onChange={(e) => filters.setSearch(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface-2/60 py-2.5 pl-10 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/25"
          />
        </div>

        {specs.map((spec) => (
          <ToolbarSelect key={spec.key} spec={spec} filters={filters} />
        ))}

        {advancedSpecs.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={panelId}
            className={cn(
              'tap inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-semibold',
              open || activeAdvanced > 0
                ? 'border-brand/30 bg-brand-50 text-brand'
                : 'border-line bg-surface text-ink hover:bg-surface-2',
            )}
          >
            <SlidersHorizontal size={15} strokeWidth={2.25} aria-hidden />
            Filters
            {activeAdvanced > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {activeAdvanced}
              </span>
            )}
          </button>
        )}

        {trailing}
      </div>

      {open && advancedSpecs.length > 0 && (
        <div
          id={panelId}
          className="animate-fade flex flex-wrap items-center gap-2 border-t border-line pt-3 sm:gap-3"
        >
          {advancedSpecs.map((spec) => (
            <ToolbarSelect key={spec.key} spec={spec} filters={filters} withLabel />
          ))}
        </div>
      )}

      {filters.active && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            {shown} of {total} {noun} match
          </span>
          <button
            type="button"
            onClick={filters.clear}
            className="tap inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink hover:bg-line"
          >
            <X size={12} strokeWidth={3} aria-hidden />
            Clear filters
          </button>
        </div>
      )}
    </search>
  );
}

/**
 * Compact select whose label is visually hidden. The "all" option doubles as the
 * on-screen label, which is why every spec must supply a self-describing
 * `anyLabel` such as "All Gender" rather than a bare "All".
 */
function ToolbarSelect({
  spec,
  filters,
  withLabel = false,
}: {
  spec: FilterSpec;
  filters: ListFilters;
  /** Renders the label inline, for the roomier advanced row. */
  withLabel?: boolean;
}) {
  const id = useId();
  const value = filters.values[spec.key] ?? ANY;

  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className={withLabel ? 'text-xs font-semibold text-muted' : 'sr-only'}>
        {spec.label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => filters.setValue(spec.key, e.target.value)}
          className={cn(
            'w-full appearance-none rounded-xl border bg-surface py-2.5 pl-3.5 pr-9 text-sm font-medium outline-none transition-colors',
            'focus:border-brand focus:ring-2 focus:ring-brand/25',
            value === ANY ? 'border-line text-ink' : 'border-brand/30 bg-brand-50 text-brand',
          )}
        >
          <option value={ANY}>{spec.anyLabel}</option>
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          size={15}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
    </div>
  );
}
