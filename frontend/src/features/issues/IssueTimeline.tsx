import type { IssueUpdate } from '@/api/types';
import { formatIssueTime, statusLabel, statusTone } from './issues';
import { StatusBadge } from '@/components/ui';

/**
 * A report's status history, oldest first.
 *
 * The same component on both sides of the story, because it is the same history:
 * the participant reads it on their own report and the duty team reads it on the
 * queue, and two components would drift into two different accounts of what
 * happened.
 *
 * The one difference is `showAuthor`. `GET /issues/mine` does not return `by` at
 * all — which volunteer typed a note is staff bookkeeping the audit trail keeps —
 * so the flag is not hiding anything on the participant's side, it is declining
 * to leave a gap where a name would go.
 *
 * A bare status change with no note stays in the list. It is real history, and
 * dropping it would turn "Resolved" into something that appears to have happened
 * on its own.
 */
export function IssueTimeline({
  updates,
  showAuthor = false,
  className,
}: {
  updates: readonly IssueUpdate[];
  /** Print `by` beside each entry. Staff reads only — see above. */
  showAuthor?: boolean;
  className?: string;
}) {
  if (updates.length === 0) return null;

  return (
    <ol className={className ?? 'flex flex-col'} aria-label="What has happened since">
      {updates.map((update, index) => (
        <li
          key={`${update.at}-${index}`}
          className="flex flex-col gap-1 border-l-2 border-border py-1.5 pl-3"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge tone={statusTone(update.status)}>{statusLabel(update.status)}</StatusBadge>
            <span className="text-xs tabular-nums text-muted">{formatIssueTime(update.at)}</span>
            {showAuthor && update.by && <span className="text-xs text-muted">by {update.by}</span>}
          </div>
          {update.note && (
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{update.note}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
