import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './Button';
import { Select } from './Select';
import { TextInput } from './TextInput';
import { announce } from '@/components/a11y/Announcer';

/**
 * Search + dropdown filters for an admin list, with the state kept in the URL.
 *
 * Why the URL: a filtered view survives a refresh and can be pasted into a chat
 * during a shift handover. Defaults are removed from the query string so shared
 * links stay readable.
 *
 * Filtering is client-side by design: these endpoints return their full
 * collection and take no filter params.
 */

/** Sentinel meaning "do not filter on this field". */
export const ANY = 'any';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSpec {
  /** URL query-string key. Keep it short: it is user-visible. */
  key: string;
  label: string;
  /** Options excluding the "all" entry, which is added automatically. */
  options: FilterOption[];
  /** Label for the catch-all entry, e.g. "All statuses". */
  anyLabel: string;
}

export interface ListFilters {
  /** Free-text needle, already trimmed and lowercased for matching. */
  needle: string;
  /** Raw search box value (what the user typed). */
  search: string;
  /** Current value per filter key; `ANY` when unfiltered. */
  values: Record<string, string>;
  /** True when anything is narrowing the list. */
  active: boolean;
  /**
   * Stable string identifying the current filter state. Pass to `usePagedList`
   * as `resetKey` so narrowing the list returns the user to page 1.
   */
  signature: string;
  setSearch: (value: string) => void;
  setValue: (key: string, value: string) => void;
  clear: () => void;
  /** Convenience: does this record's value pass the filter for `key`? */
  matches: (key: string, value: string | null | undefined) => boolean;
}

/** URL-backed filter state. `specs` only needs to be stable in its keys. */
export function useListFilters(specs: FilterSpec[]): ListFilters {
  const [params, setParams] = useSearchParams();
  const keys = specs.map((s) => s.key).join(',');

  const search = params.get('q') ?? '';

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of keys ? keys.split(',') : []) out[key] = params.get(key) ?? ANY;
    return out;
    // `params` identity changes on every navigation, which is what we want.
  }, [params, keys]);

  const write = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === ANY) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const active =
    Boolean(params.get('q')) || (keys ? keys.split(',').some((k) => params.get(k)) : false);

  return {
    search,
    needle: search.trim().toLowerCase(),
    values,
    active,
    signature: `${search}|${JSON.stringify(values)}`,
    setSearch: (value) => write('q', value),
    setValue: write,
    clear: () => setParams({}, { replace: true }),
    matches: (key, value) => {
      const wanted = values[key] ?? ANY;
      return wanted === ANY || value === wanted;
    },
  };
}

export function ListFilterBar({
  filters,
  specs,
  searchLabel = 'Search',
  searchPlaceholder,
  shown,
  total,
  noun = 'items',
}: {
  filters: ListFilters;
  specs: FilterSpec[];
  searchLabel?: string;
  searchPlaceholder?: string;
  /** Number of records currently visible. */
  shown: number;
  /** Number of records before filtering. */
  total: number;
  /** Plural noun used in the count and the screen-reader announcement. */
  noun?: string;
}) {
  // Changing a filter swaps the list underneath with no other signal for
  // assistive tech. Keyed on filter state rather than the count, so
  // re-selecting a filter that yields the same number still confirms.
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
    <search
      role="search"
      aria-label={`Filter ${noun}`}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <TextInput
        label={searchLabel}
        type="search"
        placeholder={searchPlaceholder}
        value={filters.search}
        onChange={(e) => filters.setSearch(e.target.value)}
      />
      {specs.length > 0 && (
        <div
          className={specs.length >= 3 ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}
        >
          {specs.map((spec) => (
            <Select
              key={spec.key}
              label={spec.label}
              value={filters.values[spec.key] ?? ANY}
              onChange={(e) => filters.setValue(spec.key, e.target.value)}
              options={[{ value: ANY, label: spec.anyLabel }, ...spec.options]}
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Showing {shown} of {total}
        </p>
        {filters.active && (
          <Button variant="ghost" size="sm" onClick={filters.clear}>
            Clear filters
          </Button>
        )}
      </div>
    </search>
  );
}
