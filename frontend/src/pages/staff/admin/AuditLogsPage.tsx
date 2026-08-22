import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  RefreshCw,
  Ticket,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  ListToolbar,
  ResultBanner,
  SectionHeading,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  TablePager,
  useListFilters,
  usePagedList,
  type FilterSpec,
  type StatTone,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { path, ROUTES } from '@/config/routes';
import { LogEntryList } from '@/features/logs/LogEntryList';
import {
  formatLogTime,
  fromAuditLogs,
  LOG_DOMAIN_LABEL,
  LOG_DOMAINS,
  LOG_KIND_LABEL,
  sortLogsNewestFirst,
  type LogDomain,
  type LogKind,
} from '@/features/logs/logModel';
import { TRAIL_LIMIT, TRAIL_LIMIT_OPTIONS, useLogDirectory } from '@/features/logs/useLogDirectory';
import { downloadCsv, toCsv } from '@/lib/csv';

/**
 * The audit trail, and the way into any single entity's own log.
 *
 * Two views of the same recorded activity:
 *
 *   - **All activity** — the whole trail, newest first. Every row names the entity
 *     it concerns and links straight to that entity's log, so drilling down does
 *     not require going back to a list first.
 *   - **By entity** — every event, workshop, mess hall, and hostel block with how
 *     much has been recorded against it, for when the question starts with the
 *     thing rather than with the time.
 *
 * What the trail cannot show, and the per-entity view can: event and workshop
 * *attendance* scans are written to their own collections and never reach the
 * audit trail, so the counts here are audit-only. `EntityLogsPage` merges all
 * three sources and is the authoritative view for one entity.
 */

const DOMAIN_ICON: Record<LogDomain, LucideIcon> = {
  events: Ticket,
  workshops: Wrench,
  mess: UtensilsCrossed,
  hostels: Building2,
};

/** One tone per section, so a row of figures reads as a set of distinct measures. */
const DOMAIN_TONE: Record<LogDomain, StatTone> = {
  events: 'info',
  workshops: 'success',
  mess: 'warning',
  hostels: 'accent',
};

type Mode = 'activity' | 'entities';

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  /**
   * How many rows to pull. `GET /audit-logs?limit=` applies this *before* any
   * filter here could run, so on a fest with more history than the window a search
   * only searches the window — which is why widening it has to be offered rather
   * than fixed at a constant.
   */
  const [limit, setLimit] = useState<number>(TRAIL_LIMIT);
  const directory = useLogDirectory(limit);
  const [mode, setMode] = useState<Mode>('activity');

  /* ------------------------------------------------------- all activity --- */

  const trailEntries = useMemo(
    () =>
      directory.trail === null
        ? []
        : sortLogsNewestFirst(fromAuditLogs(directory.trail, directory.names)),
    [directory.trail, directory.names],
  );

  // The vocabularies are whatever has actually been recorded, so the options are
  // built from the data rather than a hard-coded list that would drift.
  const activitySpecs: FilterSpec[] = useMemo(() => {
    const actions = [...new Set(trailEntries.map((e) => e.action))].sort();
    const kinds = [...new Set(trailEntries.map((e) => e.kind))].sort();
    return [
      {
        key: 'domain',
        label: 'Filter by section',
        anyLabel: 'All sections',
        options: LOG_DOMAINS.map((d) => ({ value: d, label: LOG_DOMAIN_LABEL[d].plural })),
      },
      {
        key: 'kind',
        label: 'Filter by kind',
        anyLabel: 'All kinds',
        options: kinds.map((k) => ({ value: k, label: LOG_KIND_LABEL[k as LogKind] })),
      },
      {
        key: 'action',
        label: 'Filter by action',
        anyLabel: 'All actions',
        options: actions.map((a) => ({ value: a, label: a })),
      },
    ];
  }, [trailEntries]);

  const filters = useListFilters(activitySpecs);

  const visibleEntries = useMemo(
    () =>
      trailEntries.filter((entry) => {
        if (!filters.matches('domain', entry.domain)) return false;
        if (!filters.matches('kind', entry.kind)) return false;
        if (!filters.matches('action', entry.action)) return false;
        if (!filters.needle) return true;
        // `sentence` carries the names, so searching for a person finds their rows;
        // the ids stay in the haystack so searching for one still works.
        return `${entry.action} ${entry.sentence} ${entry.actorId ?? ''} ${entry.targetId ?? ''} ${entry.participantId ?? ''}`
          .toLowerCase()
          .includes(filters.needle);
      }),
    [trailEntries, filters],
  );

  const pagedEntries = usePagedList(visibleEntries, {
    pageSize: PAGE_SIZE,
    resetKey: `activity|${filters.signature}`,
  });

  /** Entries whose actor cannot be named because the account is gone. */
  const removedActorCount = useMemo(
    () => trailEntries.filter((entry) => entry.actorMissing).length,
    [trailEntries],
  );

  /* ---------------------------------------------------------- by entity --- */

  const [domain, setDomain] = useState<LogDomain | 'all'>('all');
  const [entitySearch, setEntitySearch] = useState('');

  const visibleEntities = useMemo(() => {
    const needle = entitySearch.trim().toLowerCase();
    return (
      (directory.entities ?? [])
        .filter((e) => domain === 'all' || e.domain === domain)
        .filter((e) =>
          needle ? `${e.name} ${e.id} ${e.meta}`.toLowerCase().includes(needle) : true,
        )
        // Busiest first: an entity with recorded activity is the one worth opening.
        .sort((a, b) => b.auditCount - a.auditCount || a.name.localeCompare(b.name))
    );
  }, [directory.entities, domain, entitySearch]);

  const pagedEntities = usePagedList(visibleEntities, {
    pageSize: PAGE_SIZE,
    resetKey: `entities|${domain}|${entitySearch}`,
  });

  /* ------------------------------------------------------------- render --- */

  if (directory.error) {
    return (
      <ErrorState
        title="Could not load audit logs"
        description={directory.error}
        onRetry={() => void directory.load()}
      />
    );
  }

  // The fest-wide count, not `trail.length` — the trail is a capped slice.
  const total = directory.total;
  // `trailEntries` is explicitly sorted newest-first, so this does not rely on the
  // order the endpoint happened to return.
  const latest = trailEntries[0]?.timestamp ?? null;

  /**
   * Export what is on screen — Story 9.3's "centralized information" half.
   *
   * `visibleEntries`, not `pagedEntries`: the filters are the selection an admin
   * made, and the page is only how much of it fits. Exporting twenty rows when
   * the filter matched four hundred would silently answer a different question.
   *
   * Same columns and the same flattening as the per-entity export, so a fest-wide
   * sheet and a per-block sheet open in the same spreadsheet template.
   */
  function exportTrail() {
    downloadCsv(
      'audit-logs.csv',
      toCsv(
        visibleEntries.map((entry) => ({
          timestamp: entry.timestamp,
          action: entry.action,
          kind: entry.kind,
          domain: entry.domain,
          // The sentence first, so the sheet reads without cross-referencing ids.
          summary: entry.sentence,
          actor_name: entry.actorName ?? '',
          actor_id: entry.actorId ?? '',
          target_name: entry.targetName ?? '',
          target_id: entry.targetId ?? '',
          participant_name: entry.participantName ?? '',
          participant_id: entry.participantId ?? '',
          // Flattened so one record stays one line in the export.
          details: entry.facts.map((f) => `${f.label}: ${f.value}`).join('; '),
          source: entry.source,
        })),
        [
          'timestamp',
          'action',
          'kind',
          'domain',
          'summary',
          'actor_name',
          'actor_id',
          'target_name',
          'target_id',
          'participant_name',
          'participant_id',
          'details',
          'source',
        ],
      ),
    );
  }

  return (
    <FestivalScreen
      title="Audit Logs"
      subtitle={
        directory.loading
          ? 'Loading the trail…'
          : `${total} recorded action${total === 1 ? '' : 's'}`
      }
      actions={
        <>
          <Button variant="secondary" onClick={() => void directory.load()} className="gap-1.5">
            <RefreshCw size={14} /> Refresh
          </Button>
          {/* Only in activity mode: the entity list is a directory to browse, not
              a trail to export, and its rows are already exportable one at a
              time from the per-entity screen. */}
          {mode === 'activity' && (
            <Button
              variant="ghost"
              className="gap-1.5"
              disabled={visibleEntries.length === 0}
              onClick={exportTrail}
            >
              <Download size={14} /> Export CSV
            </Button>
          )}
        </>
      }
    >
      {/* ---- headline figures ---- */}
      {directory.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            icon={ClipboardList}
            tone="brand"
            label="Recorded Actions"
            value={total}
            /*
             * Now a fest-wide total, counted server-side, so it can say so. It
             * previously read `trail.length` off a 1,000-row fetch, which meant a
             * longer trail reported exactly the cap — the one number on the screen
             * that looked most authoritative was the one guaranteed to be wrong.
             * Without the summary it falls back to the page size and says nothing
             * about coverage.
             */
            footnote={
              directory.exact
                ? 'across the whole fest'
                : latest === null
                  ? 'Nothing recorded yet'
                  : `Latest ${formatLogTime(latest)}`
            }
          />
          {directory.perDomain.map(({ domain: d, count }) => (
            <StatCard
              key={d}
              icon={DOMAIN_ICON[d]}
              tone={DOMAIN_TONE[d]}
              label={LOG_DOMAIN_LABEL[d].plural}
              value={count}
              footnote={`${(directory.entities ?? []).filter((e) => e.domain === d).length} tracked`}
            />
          ))}
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
        {/* ---- which view ---- */}
        <div
          role="radiogroup"
          aria-label="Log view"
          className="flex w-fit items-center gap-1 rounded-xl bg-surface-2 p-1"
        >
          {(
            [
              ['activity', 'All activity'],
              ['entities', 'By entity'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={`tap rounded-lg px-3.5 py-1.5 text-sm font-semibold ${
                mode === value ? 'bg-brand text-white shadow-brand' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {directory.loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : mode === 'activity' ? (
          <>
            <ListToolbar
              filters={filters}
              specs={activitySpecs.slice(0, 2)}
              advancedSpecs={activitySpecs.slice(2)}
              searchLabel="Search the trail"
              searchPlaceholder="Action, actor, entity, or participant…"
              shown={visibleEntries.length}
              total={trailEntries.length}
              noun="log entries"
              // Beside the filters rather than up in the header, because it is one
              // of them in effect: `limit` decides what there is to filter. The
              // `GET /audit-logs?limit=` parameter had no control at all before.
              trailing={
                <div className="w-40 shrink-0">
                  <Select
                    label="Rows"
                    value={String(limit)}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    options={TRAIL_LIMIT_OPTIONS.map((option) => ({
                      value: String(option),
                      label: `Newest ${option.toLocaleString()}`,
                    }))}
                  />
                </div>
              }
            />

            {/* `truncated` has always been computed here and never shown, so a
                filter that found nothing looked like "it never happened" when it
                could equally have been "it happened before this window". Says which,
                and offers the wider window when there is one. */}
            {directory.truncated && (
              <ResultBanner
                variant="warning"
                title={`Showing the newest ${limit.toLocaleString()} of ${
                  directory.exact ? directory.total.toLocaleString() : 'more'
                } recorded actions`}
              >
                Filters and search apply to this window only — the server trims the trail before
                they run. {nextLimit(limit) !== null && 'Load more to search further back.'}
              </ResultBanner>
            )}

            {/* Explains the rows that lead with a code instead of a name, once, at
                the top — rather than leaving a reader to wonder row by row why
                some entries name a person and others do not. */}
            {removedActorCount > 0 && (
              <p className="text-sm text-muted">
                {removedActorCount} of {trailEntries.length} entries were recorded by an account
                that has since been removed. Those show the account id, because no name was stored
                with the entry at the time. Entries recorded from now on keep the actor’s name.
              </p>
            )}

            {visibleEntries.length === 0 ? (
              <EmptyState
                title={trailEntries.length === 0 ? 'Nothing recorded yet' : 'No matching entries'}
                description={
                  trailEntries.length === 0
                    ? 'Privileged actions and scans appear here as they happen.'
                    : 'Try a different search, or clear the filters.'
                }
                icon={FileText}
              />
            ) : (
              <LogEntryList entries={pagedEntries.items} linkTargets />
            )}

            {visibleEntries.length > 0 && <TablePager paged={pagedEntries} noun="log entries" />}
          </>
        ) : (
          <>
            {/* ---- domain tabs ---- */}
            <div className="flex flex-wrap gap-2">
              <DomainTab
                active={domain === 'all'}
                onClick={() => setDomain('all')}
                label="Everything"
                count={(directory.entities ?? []).length}
              />
              {LOG_DOMAINS.map((d) => (
                <DomainTab
                  key={d}
                  active={domain === d}
                  onClick={() => setDomain(d)}
                  label={LOG_DOMAIN_LABEL[d].plural}
                  count={(directory.entities ?? []).filter((e) => e.domain === d).length}
                />
              ))}
            </div>

            <label className="sr-only" htmlFor="entity-search">
              Search entities
            </label>
            <input
              id="entity-search"
              type="search"
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="Search by name or ID…"
              className="w-full rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-brand focus:bg-surface focus:ring-2 focus:ring-brand/25"
            />

            {visibleEntities.length === 0 ? (
              <EmptyState
                title="No matching entities"
                description="Try a different search, or pick another section."
                icon={FileText}
              />
            ) : (
              <ul className="grid gap-2 lg:grid-cols-2">
                {pagedEntities.items.map((entity) => (
                  <li key={`${entity.domain}-${entity.id}`}>
                    <Link
                      to={path(ROUTES.adminEntityLogs, {
                        domain: entity.domain,
                        entityId: entity.id,
                      })}
                      className="group block rounded-2xl"
                      aria-label={`Logs for ${entity.name}`}
                    >
                      <Card className="tap flex items-center gap-3 group-hover:-translate-y-0.5 group-hover:shadow-lift">
                        <IconTile icon={DOMAIN_ICON[entity.domain]} tone="muted" size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-ink">{entity.name}</p>
                          <p className="truncate text-xs text-muted">
                            {entity.id} · {entity.meta}
                          </p>
                        </div>
                        {/* A zero is meaningful: nothing has been recorded here yet. */}
                        <StatusBadge tone={entity.auditCount > 0 ? 'info' : 'neutral'}>
                          {entity.auditCount} logged
                        </StatusBadge>
                        <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden />
                      </Card>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {visibleEntities.length > 0 && <TablePager paged={pagedEntities} noun="entities" />}
          </>
        )}
      </section>

      {/* Says plainly what the trail does not cover, rather than letting a reader
          assume the counts above are the whole story. */}
      {!directory.loading && mode === 'entities' && (
        <section className="flex flex-col gap-2">
          <SectionHeading title="About these counts" />
          <p className="text-sm leading-6 text-muted">
            The figures above count audit-trail entries. Event and workshop attendance scans are
            recorded in their own collections and are not part of the trail — open an entity to see
            its complete log, with every scan, entry, and exit merged in.
          </p>
        </section>
      )}
    </FestivalScreen>
  );
}

function DomainTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // Spelled out, because the visible text and the count sit in separate nodes
      // and would otherwise run together into "Mess halls4".
      aria-label={`${label}, ${count}`}
      className={`tap inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
        active
          ? 'bg-brand text-white shadow-brand'
          : 'bg-surface text-ink ring-1 ring-line hover:bg-surface-2'
      }`}
    >
      {label}
      <span className={active ? 'text-white/80' : 'text-muted'}>{count}</span>
    </button>
  );
}

/** The next larger row window, or `null` at the widest one offered. */
function nextLimit(current: number): number | null {
  return TRAIL_LIMIT_OPTIONS.find((option) => option > current) ?? null;
}
