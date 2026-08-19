import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  ClipboardList,
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
  SectionHeading,
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
import { useLogDirectory } from '@/features/logs/useLogDirectory';

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
  const directory = useLogDirectory();
  const [mode, setMode] = useState<Mode>('activity');

  /* ------------------------------------------------------- all activity --- */

  const trailEntries = useMemo(
    () => (directory.trail === null ? [] : sortLogsNewestFirst(fromAuditLogs(directory.trail))),
    [directory.trail],
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
        return `${entry.action} ${entry.label} ${entry.actorId ?? ''} ${entry.targetId ?? ''} ${entry.participantId ?? ''}`
          .toLowerCase()
          .includes(filters.needle);
      }),
    [trailEntries, filters],
  );

  const pagedEntries = usePagedList(visibleEntries, {
    pageSize: PAGE_SIZE,
    resetKey: `activity|${filters.signature}`,
  });

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

  const total = directory.trail?.length ?? 0;
  // `trailEntries` is explicitly sorted newest-first, so this does not rely on the
  // order the endpoint happened to return.
  const latest = trailEntries[0]?.timestamp ?? null;

  return (
    <FestivalScreen
      title="Audit Logs"
      subtitle={
        directory.loading
          ? 'Loading the trail…'
          : `${total} recorded action${total === 1 ? '' : 's'}`
      }
      actions={
        <Button variant="secondary" onClick={() => void directory.load()} className="gap-1.5">
          <RefreshCw size={14} /> Refresh
        </Button>
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
            // When the trail was last written to, rather than a claim about its
            // coverage: the fetch is capped, so "across the whole fest" was a
            // promise the figure could not keep.
            footnote={latest === null ? 'Nothing recorded yet' : `Latest ${formatLogTime(latest)}`}
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
            />

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
