import { Link } from 'react-router-dom';
import {
  ArrowRightLeft,
  ClipboardList,
  DoorOpen,
  LogOut,
  Shuffle,
  UserCheck,
  UserPlus,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, IconTile, StatusBadge } from '@/components/ui';
import { path, ROUTES } from '@/config/routes';
import {
  formatLogTime,
  LOG_DOMAIN_LABEL,
  LOG_KIND_LABEL,
  LOG_KIND_TONE,
  type LogEntry,
  type LogKind,
} from './logModel';

/**
 * A list of log records, used both for the whole trail and for one entity.
 *
 * Each row leads with what happened and when, then names the two people involved —
 * who did it and who it was done to — because for a scan those are different
 * people and the distinction is the point of the record. Whatever else was
 * recorded follows as labelled facts rather than a raw JSON blob.
 */

const KIND_ICON: Record<LogKind, LucideIcon> = {
  entry: DoorOpen,
  exit: LogOut,
  meal: UtensilsCrossed,
  attendance: UserCheck,
  registration: UserPlus,
  team: Users,
  lifecycle: ClipboardList,
  allocation: Shuffle,
  other: ArrowRightLeft,
};

const KIND_TILE_TONE: Record<LogKind, 'brand' | 'success' | 'danger' | 'warning' | 'muted'> = {
  entry: 'success',
  exit: 'warning',
  meal: 'brand',
  attendance: 'success',
  registration: 'brand',
  team: 'muted',
  lifecycle: 'muted',
  allocation: 'warning',
  other: 'muted',
};

export function LogEntryList({
  entries,
  /** Link the entity a record concerns. Off on a page that already is that entity. */
  linkTargets = false,
}: {
  entries: LogEntry[];
  linkTargets?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.key}>
          <Card className="flex items-start gap-3">
            <IconTile icon={KIND_ICON[entry.kind]} tone={KIND_TILE_TONE[entry.kind]} size="sm" />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink">{entry.label}</p>
                <StatusBadge tone={LOG_KIND_TONE[entry.kind]}>
                  {LOG_KIND_LABEL[entry.kind]}
                </StatusBadge>
                {/* The action verbatim, so a reader can match a row against the
                    backend that wrote it. */}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                  {entry.action}
                </code>
              </div>

              <p className="mt-1 text-sm text-muted">{formatLogTime(entry.timestamp)}</p>

              <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {entry.actorId && <Fact label="By" value={entry.actorId} />}
                {entry.participantId && <Fact label="Participant" value={entry.participantId} />}
                {entry.facts.map((fact) => (
                  <Fact key={fact.label} label={fact.label} value={fact.value} />
                ))}
              </dl>
            </div>

            {entry.targetId && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                {linkTargets && entry.domain ? (
                  <Link
                    to={path(ROUTES.adminEntityLogs, {
                      domain: entry.domain,
                      entityId: entry.targetId,
                    })}
                    className="tap rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-100"
                  >
                    {entry.targetId}
                  </Link>
                ) : (
                  <StatusBadge tone="neutral">{entry.targetId}</StatusBadge>
                )}
                {entry.domain && (
                  <span className="text-[11px] text-muted">
                    {LOG_DOMAIN_LABEL[entry.domain].singular}
                  </span>
                )}
              </div>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
