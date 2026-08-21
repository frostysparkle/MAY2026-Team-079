import { useState } from 'react';
import { MessageSquare, Send, Shield, User } from 'lucide-react';
import type { QueryRecord } from '@/api/types';
import { ApiClientError } from '@/api';
import { Button, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  askerLine,
  categoryLabel,
  formatQueryTime,
  hasStaffReply,
  isOutstanding,
  statusLabel,
  statusTone,
  targetLabel,
} from './queries';

/**
 * One query and its conversation — rendered once for both audiences.
 *
 * The participant's screen and the staff console share this deliberately: a
 * volunteer must see exactly what the asker has already been told, or the second
 * reply repeats the first. There is no separate staff shape to render, because
 * `GET /queries` and `GET /queries/mine` return the same row — a query carries
 * no email or phone in either direction, so there is nothing to withhold from
 * one side.
 *
 * `showAsker` is the only difference, and it is presentation rather than
 * disclosure: on the participant's own list every row is theirs, so printing
 * their own name back at them is noise.
 */
export function QueryThread({
  query,
  names = {},
  showAsker = false,
  onReply,
  replyPlaceholder = 'Write a reply…',
  actions,
  className,
}: {
  query: QueryRecord;
  names?: Record<string, string>;
  /** Staff console only — a participant's own list is all their own queries. */
  showAsker?: boolean;
  /** Omitted to render the thread read-only. */
  onReply?: (body: string) => Promise<void>;
  replyPlaceholder?: string;
  /** Status and assignment controls, on the console only. */
  actions?: React.ReactNode;
  className?: string;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);
    try {
      await onReply?.(body);
      // Cleared only on success. A failed send keeps what was typed, because
      // losing a paragraph to a dropped connection is the worst outcome here.
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send that reply.');
    } finally {
      setSending(false);
    }
  }

  const awaitingFirstAnswer = isOutstanding(query) && !hasStaffReply(query);

  return (
    <article
      className={cn('rounded-2xl bg-surface p-4 shadow-card ring-1 ring-black/[0.03]', className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug text-ink">{query.subject}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span>{categoryLabel(query.category)}</span>
            <span aria-hidden>·</span>
            <span>{targetLabel(query, names)}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{formatQueryTime(query.created_at)}</span>
            {showAsker && (
              <>
                <span aria-hidden>·</span>
                <span>{askerLine(query)}</span>
              </>
            )}
          </p>
        </div>
        <StatusBadge tone={statusTone(query.status)}>{statusLabel(query.status)}</StatusBadge>
      </header>

      <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink">{query.body}</p>

      {query.assigned_team && (
        <p className="mt-2 text-xs text-muted">
          Handled by <span className="font-medium text-ink">{query.assigned_team}</span>
        </p>
      )}

      {query.replies.length > 0 && (
        <ol className="mt-4 space-y-3">
          {query.replies.map((reply, i) => {
            const fromStaff = reply.author_type === 'staff';
            const Icon = fromStaff ? Shield : User;
            return (
              <li
                key={`${reply.timestamp}-${i}`}
                className={cn(
                  'flex gap-2.5 rounded-xl p-3',
                  fromStaff ? 'bg-info-bg/40' : 'bg-surface-2',
                )}
              >
                <Icon
                  size={15}
                  strokeWidth={2.5}
                  aria-hidden
                  className={cn('mt-0.5 shrink-0', fromStaff ? 'text-info' : 'text-muted')}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs font-semibold text-ink">{reply.author_name}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted">
                      {fromStaff ? 'Fest team' : 'Asked by'}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted">
                      {formatQueryTime(reply.timestamp)}
                    </span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-ink">
                    {reply.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {awaitingFirstAnswer && query.replies.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <MessageSquare size={13} strokeWidth={2.5} aria-hidden />
          No reply yet.
        </p>
      )}

      {actions && <div className="mt-4 border-t border-line pt-3">{actions}</div>}

      {onReply && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="sr-only" htmlFor={`reply-${query.query_id}`}>
            Reply to {query.subject}
          </label>
          <textarea
            id={`reply-${query.query_id}`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={replyPlaceholder}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `reply-error-${query.query_id}` : undefined}
            className={cn(
              'w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none transition-colors',
              'focus:border-brand focus:ring-2 focus:ring-brand/30',
              error ? 'border-danger' : 'border-input',
            )}
          />
          {error && (
            <p id={`reply-error-${query.query_id}`} role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={send}
              loading={sending}
              disabled={draft.trim().length === 0}
            >
              <Send size={15} strokeWidth={2.5} /> Send reply
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
