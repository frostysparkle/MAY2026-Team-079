import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { announce } from '@/components/a11y/Announcer';
import type { PagedResult } from './Pagination';

/**
 * A sortable data table for admin lists.
 *
 * It is a real `<table>` with a real `<caption>`, `scope="col"` headers and
 * `aria-sort`, because a grid of divs gives screen-reader users no way to tell
 * which column a cell belongs to — and these rows are all numbers, where that
 * is the whole meaning. Sorting is client-side and URL-backed, matching
 * `useListFilters` and `usePagedList`.
 */

export type SortDirection = 'asc' | 'desc';

export interface DataTableColumn<T> {
  /** Stable id; also the value written to `?sort=`. */
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Provide to make the column sortable. Omit for e.g. an actions column. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'center' | 'right';
  /** Extra classes applied to both the header and every cell in the column. */
  className?: string;
  /** Keeps the header available to assistive tech but out of the visual design. */
  srOnlyHeader?: boolean;
}

export interface TableSort {
  key: string;
  direction: SortDirection;
  /** Same column flips direction; a new column starts from its default. */
  toggle: (key: string) => void;
  /** Pass to `usePagedList` as part of `resetKey`. */
  signature: string;
}

/**
 * Sort state in the URL, so a sorted view survives a refresh and can be shared.
 *
 * `defaultDirection` is per column: names read best A→Z, while occupancy and
 * other measures are almost always wanted worst/highest first.
 */
export function useTableSort(
  defaultKey: string,
  defaultDirection: Record<string, SortDirection> = {},
): TableSort {
  const [params, setParams] = useSearchParams();

  const key = params.get('sort') ?? defaultKey;
  const direction: SortDirection = params.get('dir') === 'desc' ? 'desc' : 'asc';

  const toggle = (next: string) => {
    const search = new URLSearchParams(params);
    const nextDirection: SortDirection =
      next === key ? (direction === 'asc' ? 'desc' : 'asc') : (defaultDirection[next] ?? 'asc');

    if (next === defaultKey) search.delete('sort');
    else search.set('sort', next);

    if (nextDirection === 'asc') search.delete('dir');
    else search.set('dir', nextDirection);

    setParams(search, { replace: true });
  };

  return { key, direction, toggle, signature: `${key}|${direction}` };
}

/** Sort a copy of `rows` by the active column. Unsortable columns pass through. */
export function sortRows<T>(rows: T[], columns: DataTableColumn<T>[], sort: TableSort): T[] {
  const column = columns.find((c) => c.key === sort.key);
  if (!column?.sortValue) return rows;
  const read = column.sortValue;
  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
    // localeCompare so "Mandakini A" sorts next to "Mandakini B" as a reader expects.
    return String(left).localeCompare(String(right), undefined, { numeric: true }) * factor;
  });
}

const alignClasses = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  caption,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Omit to render a plain, unsortable table. */
  sort?: TableSort;
  /** Describes the table for assistive tech; visually hidden. */
  caption: string;
  className?: string;
}) {
  // Sorting swaps the rows in place with no other signal for assistive tech.
  const signature = sort?.signature;
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!signature) return;
    if (previous.current === undefined) {
      previous.current = signature;
      return;
    }
    if (previous.current === signature) return;
    previous.current = signature;
    const [key, direction] = signature.split('|');
    const column = columns.find((c) => c.key === key);
    announce(
      `Sorted by ${column?.header ?? key}, ${direction === 'asc' ? 'ascending' : 'descending'}`,
    );
    // Only the sort signature should announce, not a re-render of the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    // Horizontal scroll rather than a wrapped or truncated layout: eight numeric
    // columns cannot compress onto a phone, and a scrollable table keeps every
    // figure readable instead of hiding some of them.
    <div className={cn('-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0', className)}>
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => {
              const sortable = Boolean(sort && column.sortValue);
              const active = sortable && sort!.key === column.key;
              const Arrow = !active
                ? ChevronsUpDown
                : sort!.direction === 'asc'
                  ? ChevronUp
                  : ChevronDown;

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn(
                    'px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-muted',
                    alignClasses[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.srOnlyHeader ? (
                    <span className="sr-only">{column.header}</span>
                  ) : sortable ? (
                    <button
                      type="button"
                      onClick={() => sort!.toggle(column.key)}
                      className={cn(
                        'tap inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-ink',
                        active && 'text-brand',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <Arrow size={13} strokeWidth={2.5} aria-hidden />
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-brand-50/60"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-3 align-middle',
                    alignClasses[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- paging --- */

/** Page numbers to render, with `null` standing in for a gap. */
function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const pages = new Set([1, pageCount, page, page - 1, page + 1]);
  const shown = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let last = 0;
  for (const p of shown) {
    if (last && p - last > 1) out.push(null);
    out.push(p);
    last = p;
  }
  return out;
}

/**
 * Table footer: a position readout plus numbered pages.
 *
 * Unlike `Pagination`, this renders the readout even for a single page — a table
 * footer that appears and disappears with the row count makes the whole panel
 * jump as filters narrow the list.
 */
export function TablePager<T>({ paged, noun = 'items' }: { paged: PagedResult<T>; noun?: string }) {
  const { page, pageCount, from, to, total, hasPrevious, hasNext, goTo } = paged;
  const pages = useMemo(() => pageWindow(page, pageCount), [page, pageCount]);

  useEffect(() => {
    if (pageCount <= 1) return;
    announce(`Page ${page} of ${pageCount}, showing ${noun} ${from} to ${to} of ${total}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-1 pt-4">
      <p aria-live="off" className="text-xs text-muted">
        {total === 0 ? `No ${noun}` : `Showing ${from} to ${to} of ${total} ${noun}`}
      </p>

      {pageCount > 1 && (
        <nav aria-label={`${noun} pagination`} className="flex items-center gap-1">
          <PagerButton label="Previous page" disabled={!hasPrevious} onClick={() => goTo(page - 1)}>
            <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
          </PagerButton>

          {pages.map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted">
                …
              </span>
            ) : (
              <PagerButton key={p} label={`Page ${p}`} current={p === page} onClick={() => goTo(p)}>
                {p}
              </PagerButton>
            ),
          )}

          <PagerButton label="Next page" disabled={!hasNext} onClick={() => goTo(page + 1)}>
            <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
          </PagerButton>
        </nav>
      )}
    </div>
  );
}

function PagerButton({
  label,
  current = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'tap flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-semibold',
        'disabled:cursor-not-allowed disabled:opacity-40',
        current
          ? 'bg-brand text-white shadow-brand'
          : 'bg-surface text-ink ring-1 ring-line hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
