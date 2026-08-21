import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { api } from '@/api';
import {
  Button,
  EmptyState,
  ErrorState,
  ListToolbar,
  ResultBanner,
  Skeleton,
  StatCard,
  TablePager,
  useListFilters,
  usePagedList,
  type FilterSpec,
} from '@/components/ui';
import { FestivalScreen } from '@/components/layout/FestivalScreen';
import { ROUTES } from '@/config/routes';
import { downloadCsv, toCsv } from '@/lib/csv';
import { LogEntryList } from '@/features/logs/LogEntryList';
import {
  formatLogTime,
  LOG_DOMAIN_LABEL,
  LOG_DOMAINS,
  LOG_KIND_LABEL,
  type LogDomain,
  type LogKind,
} from '@/features/logs/logModel';
import { useEntityLogs } from '@/features/logs/useEntityLogs';
import { ClipboardList, DoorOpen, LogOut, UserCheck } from 'lucide-react';

/**
 * Every log record for one event, workshop, mess hall, or hostel block.
 *
 * This is the view the audit trail alone could not give. It merges the three
 * places the system records activity:
 *
 *   - the audit trail, narrowed to this entity — and for a mess hall or hostel
 *     block the only source, since meal scans and entry/exit live nowhere else
 *   - `event_logs` for event attendance
 *   - `workshop_logs` for workshop bookings and attendance
 *
 * Entry and exit are separate records with their own labels and tones, so a
 * block's log reads as a legible in/out sequence rather than a list of identical
 * "scan" lines. Nothing recorded is hidden: details this build does not recognise
 * are still rendered under their own key.
 */

const PAGE_SIZE = 25;

/** Only these four kinds get a headline figure; the rest are visible in the list. */
const HEADLINE_KINDS: { kind: LogKind; label: string; icon: typeof DoorOpen }[] = [
  { kind: 'entry', label: 'Entries', icon: DoorOpen },
  { kind: 'exit', label: 'Exits', icon: LogOut },
  { kind: 'meal', label: 'Meals Served', icon: ClipboardList },
  { kind: 'attendance', label: 'Attendance', icon: UserCheck },
];

function isLogDomain(value: string | undefined): value is LogDomain {
  return LOG_DOMAINS.includes(value as LogDomain);
}

export default function EntityLogsPage() {
  const { domain, entityId = '' } = useParams<{ domain?: string; entityId?: string }>();
  const navigate = useNavigate();

  // An unknown domain in the URL cannot be resolved to an endpoint, so it goes
  // back to the trail rather than rendering a broken page.
  if (!isLogDomain(domain)) return <Navigate to={ROUTES.adminAuditLogs} replace />;

  return <EntityLogs domain={domain} entityId={entityId} onBack={() => navigate(-1)} />;
}

function EntityLogs({
  domain,
  entityId,
  onBack,
}: {
  domain: LogDomain;
  entityId: string;
  onBack: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  // The name is passed through so rows read "Mess hall 2" rather than the raw id.
  // It arrives after the first render and reloads the rows once; that is the trade
  // for never blocking the log on a title lookup.
  const logs = useEntityLogs(domain, entityId, name);

  // For the title and the rows — never block the log on it.
  useEffect(() => {
    const lookup =
      domain === 'events'
        ? api.listEvents().then((rows) => rows.find((r) => r.event_id === entityId)?.name)
        : domain === 'workshops'
          ? api.listWorkshops().then((rows) => rows.find((r) => r.workshop_id === entityId)?.name)
          : domain === 'mess'
            ? api.listMess().then((rows) => rows.find((r) => r.mess_id === entityId)?.name)
            : api.listHostels().then((rows) => rows.find((r) => r.hostel_id === entityId)?.name);

    lookup.then((found) => setName(found ?? null)).catch(() => undefined);
  }, [domain, entityId]);

  const entries = logs.entries;

  const specs: FilterSpec[] = useMemo(() => {
    const kinds = [...new Set(entries.map((e) => e.kind))];
    return [
      {
        key: 'kind',
        label: 'Filter by kind',
        anyLabel: 'All kinds',
        options: kinds.map((k) => ({ value: k, label: LOG_KIND_LABEL[k] })),
      },
      {
        key: 'action',
        label: 'Filter by action',
        anyLabel: 'All actions',
        options: logs.actions.map((a) => ({ value: a, label: a })),
      },
    ];
  }, [entries, logs.actions]);

  const filters = useListFilters(specs);

  const visible = useMemo(
    () =>
      entries.filter((entry) => {
        if (!filters.matches('kind', entry.kind)) return false;
        if (!filters.matches('action', entry.action)) return false;
        if (!filters.needle) return true;
        // `sentence` carries the names, so searching for a person finds their rows;
        // the ids stay in the haystack so searching for one still works.
        return `${entry.action} ${entry.sentence} ${entry.actorId ?? ''} ${entry.participantId ?? ''}`
          .toLowerCase()
          .includes(filters.needle);
      }),
    [entries, filters],
  );

  const paged = usePagedList(visible, { pageSize: PAGE_SIZE, resetKey: filters.signature });

  const counts = useMemo(() => {
    const byKind = new Map<LogKind, number>();
    for (const entry of entries) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    return byKind;
  }, [entries]);

  if (logs.error) {
    return (
      <FestivalScreen title="Logs" back={{ label: 'Back', onClick: onBack }}>
        <ErrorState
          title="Could not load the logs"
          description={logs.error}
          onRetry={() => void logs.load()}
        />
      </FestivalScreen>
    );
  }

  // Only the figures that mean something for this domain: a mess hall has no
  // exits, a hostel block has no meals.
  const headline = HEADLINE_KINDS.filter(({ kind }) => counts.has(kind));

  return (
    <FestivalScreen
      title="Logs"
      eyebrow={LOG_DOMAIN_LABEL[domain].singular}
      subtitle={
        logs.loading
          ? 'Loading the records…'
          : `${name ?? entityId} · ${entries.length} record${entries.length === 1 ? '' : 's'}`
      }
      back={{ label: 'Back', onClick: onBack }}
      actions={
        <>
          <Button variant="secondary" onClick={() => void logs.load()} className="gap-1.5">
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button
            variant="ghost"
            className="gap-1.5"
            disabled={visible.length === 0}
            onClick={() =>
              downloadCsv(
                `${domain}-${entityId}-logs.csv`,
                toCsv(
                  visible.map((entry) => ({
                    timestamp: entry.timestamp,
                    action: entry.action,
                    kind: entry.kind,
                    // The sentence first, so the sheet reads without cross-
                    // referencing ids. Same columns as the fest-wide export.
                    summary: entry.sentence,
                    actor_name: entry.actorName ?? '',
                    actor_id: entry.actorId ?? '',
                    participant_name: entry.participantName ?? '',
                    participant_id: entry.participantId ?? '',
                    // Flattened so one row stays one line in the export.
                    details: entry.facts.map((f) => `${f.label}: ${f.value}`).join('; '),
                    source: entry.source,
                  })),
                  [
                    'timestamp',
                    'action',
                    'kind',
                    'summary',
                    'actor_name',
                    'actor_id',
                    'participant_name',
                    'participant_id',
                    'details',
                    'source',
                  ],
                ),
              )
            }
          >
            <Download size={14} /> Export CSV
          </Button>
        </>
      }
    >
      {logs.partial && (
        <ResultBanner variant="warning" title="Some records could not be read">
          The audit trail loaded, but this {LOG_DOMAIN_LABEL[domain].singular.toLowerCase()}'s
          attendance scans could not be fetched. The list below is incomplete.
        </ResultBanner>
      )}

      {logs.loading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-[104px] rounded-2xl" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {headline.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {headline.map(({ kind, label, icon }) => (
                <StatCard
                  key={kind}
                  icon={icon}
                  tone={kind === 'exit' ? 'warning' : kind === 'meal' ? 'brand' : 'success'}
                  label={label}
                  value={counts.get(kind) ?? 0}
                  footnote={`${LOG_KIND_LABEL[kind]} records`}
                />
              ))}
            </div>
          )}

          <section className="flex flex-col gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]">
            <ListToolbar
              filters={filters}
              specs={specs.slice(0, 1)}
              advancedSpecs={specs.slice(1)}
              searchLabel="Search these logs"
              searchPlaceholder="Action, actor, or participant…"
              shown={visible.length}
              total={entries.length}
              noun="records"
            />

            {visible.length === 0 ? (
              <EmptyState
                title={entries.length === 0 ? 'Nothing recorded yet' : 'No matching records'}
                description={
                  entries.length === 0
                    ? 'Actions and scans for this entity appear here as they happen.'
                    : 'Try a different search, or clear the filters.'
                }
                icon={FileText}
              />
            ) : (
              // Targets are not linked here: every record already belongs to the
              // entity this page is about.
              <LogEntryList entries={paged.items} />
            )}

            {visible.length > 0 && <TablePager paged={paged} noun="records" />}
          </section>

          {entries.length > 0 && (
            <p className="text-xs text-muted">
              Oldest record {formatLogTime(entries[entries.length - 1].timestamp)} · newest{' '}
              {formatLogTime(entries[0].timestamp)}
            </p>
          )}
        </>
      )}
    </FestivalScreen>
  );
}
