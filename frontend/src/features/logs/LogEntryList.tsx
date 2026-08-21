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
              {/* The record as a sentence, naming the people in the order the
                  action happened. This is what a reader is here for. */}
              <p className="font-semibold text-ink">{entry.sentence}</p>

              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <span>{formatLogTime(entry.timestamp)}</span>
                <StatusBadge tone={LOG_KIND_TONE[entry.kind]}>
                  {LOG_KIND_LABEL[entry.kind]}
                </StatusBadge>
                {/* Says why this row leads with a code instead of a name, so it
                    reads as a fact about the record rather than a broken screen. */}
                {entry.actorMissing && (
                  <span title="This account was removed after the action, so no name could be resolved for it.">
                    account since removed
                  </span>
                )}
                {/* The action verbatim, so a reader can match a row against the
                    backend that wrote it. */}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                  {entry.action}
                </code>
              </div>

              {entry.facts.length > 0 && (
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {entry.facts.map((fact) => (
                    <Fact key={fact.label} label={fact.label} value={fact.value} />
                  ))}
                </dl>
              )}

              {/* The raw ids, kept because this is an audit view: a reader has to
                  be able to take an id from a row to another system. Muted and
                  last, since the sentence above already says who is who. */}
              <IdTrail entry={entry} />
            </div>

            {entry.targetId && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                {/* The entity's name when the page could look it up, its id when
                    not. The link still targets the id either way. */}
                {linkTargets && entry.domain ? (
                  <Link
                    to={path(ROUTES.adminEntityLogs, {
                      domain: entry.domain,
                      entityId: entry.targetId,
                    })}
                    title={entry.targetId}
                    className="tap rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand hover:bg-brand-100"
                  >
                    {entry.targetName ?? entry.targetId}
                  </Link>
                ) : (
                  <StatusBadge tone="neutral">{entry.targetName ?? entry.targetId}</StatusBadge>
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
      {/* Not uppercased: the labels are words, and CSS `uppercase` turned "By"
          into "BY", which read like part of the id that followed it. */}
      <dt className="font-semibold tracking-wide text-muted">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

/**
 * The ids behind a row, for a reader who needs to act on one.
 *
 * Only ids that the sentence has already named as a person or place, and only
 * once each — an actor who is also the participant appears a single time.
 */
function IdTrail({ entry }: { entry: LogEntry }) {
  const ids = [
    entry.actorId ? { role: 'actor', id: entry.actorId } : null,
    entry.participantId && entry.participantId !== entry.actorId
      ? { role: 'participant', id: entry.participantId }
      : null,
  ].filter((x): x is { role: string; id: string } => x !== null);

  if (ids.length === 0) return null;

  return (
    <p className="mt-1 font-mono text-[11px] text-muted">
      {ids.map(({ role, id }, i) => (
        <span key={role}>
          {i > 0 && ' · '}
          <span title={`${role} id`}>{id}</span>
        </span>
      ))}
    </p>
  );
}
