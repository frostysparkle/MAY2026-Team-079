import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from './Button';
import { announce } from '@/components/a11y/Announcer';

/**
 * Client-side paging for admin lists, with the page kept in the URL.
 *
 * Deliberately client-side, matching `useListFilters`: the backend's list
 * endpoints return their whole collection and accept no limit/offset. When a
 * list outgrows a single response, move paging into the request instead.
 */

export const DEFAULT_PAGE_SIZE = 25;

export interface PagedResult<T> {
  /** The rows to render for the current page. */
  items: T[];
  page: number;
  pageCount: number;
  /** 1-based index of the first row on this page (0 when empty). */
  from: number;
  /** 1-based index of the last row on this page. */
  to: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  goTo: (page: number) => void;
}

/**
 * Slice `items` into pages. Reads `?page=` so a page survives a refresh.
 *
 * `resetKey` should change whenever the filters change — otherwise a user on
 * page 4 who narrows the list lands on an empty page.
 */
export function usePagedList<T>(
  items: T[],
  { pageSize = DEFAULT_PAGE_SIZE, resetKey = '' }: { pageSize?: number; resetKey?: string } = {},
): PagedResult<T> {
  const [params, setParams] = useSearchParams();
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const requested = Number.parseInt(params.get('page') ?? '1', 10);
  // Clamp rather than trust the URL: ?page=999 or ?page=abc must not blank the list.
  const page = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), pageCount) : 1;

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), pageCount);
    const search = new URLSearchParams(params);
    if (clamped === 1) search.delete('page');
    else search.set('page', String(clamped));
    setParams(search, { replace: true });
  };

  // Narrowing the list must return the user to page 1. Skipped on first render
  // so a deep-linked `?page=3` from a bookmark isn't thrown away on mount.
  const seenResetKey = useRef<string | null>(null);
  useEffect(() => {
    if (seenResetKey.current === null) {
      seenResetKey.current = resetKey;
      return;
    }
    if (seenResetKey.current === resetKey) return;
    seenResetKey.current = resetKey;
    if (!params.get('page')) return;
    const search = new URLSearchParams(params);
    search.delete('page');
    setParams(search, { replace: true });
    // Only when the filter signature changes, not on every param write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize),
    [items, page, pageSize],
  );

  return {
    items: pageItems,
    page,
    pageCount,
    total,
    from: total === 0 ? 0 : (page - 1) * pageSize + 1,
    to: Math.min(page * pageSize, total),
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    goTo,
  };
}

/**
 * Previous/next controls plus a position readout. Renders nothing for a single
 * page, so short lists aren't cluttered with dead controls.
 */
export function Pagination<T>({ paged, noun = 'items' }: { paged: PagedResult<T>; noun?: string }) {
  const { page, pageCount, from, to, total, hasPrevious, hasNext, goTo } = paged;

  // Changing page replaces the rows in place; announce the new position.
  useEffect(() => {
    if (pageCount <= 1) return;
    announce(`Page ${page} of ${pageCount}, showing ${noun} ${from} to ${to} of ${total}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (pageCount <= 1) return null;

  return (
    <nav aria-label={`${noun} pagination`} className="flex items-center justify-between gap-3 pt-1">
      <Button variant="secondary" size="sm" disabled={!hasPrevious} onClick={() => goTo(page - 1)}>
        Previous
      </Button>
      <p className="text-xs text-muted">
        {from}–{to} of {total}
      </p>
      <Button variant="secondary" size="sm" disabled={!hasNext} onClick={() => goTo(page + 1)}>
        Next
      </Button>
    </nav>
  );
}
