import type { Issue, QueryRecord } from '@/api/types';
import { countQueries, isUnanswered } from '@/features/queries/queries';
import {
  countIssues,
  isOutstanding as issueOutstanding,
  latestNote,
} from '@/features/issues/issues';

/**
 * One set of figures across both halves of support — used by both sides of it.
 *
 * A participant does not hold "queries" and "issues"; they hold *things they
 * asked somebody to deal with*. Splitting the count the way the backend splits
 * the collections meant the old screens could each only answer half of "is
 * anybody dealing with my stuff", and a student with an unanswered report and an
 * answered question had to visit two routes to work that out.
 *
 * The duty desk has the same problem from the other end, so `StaffSupportPage`
 * counts its queue with this too and the arithmetic is shared rather than
 * reimplemented. `StaffIssue extends Issue`, so a staff queue satisfies the same
 * parameter as a participant's own list with no widening needed. The field names
 * read from the asker's side because that is whose backlog it is either way; a
 * volunteer's screen labels `awaitingReply` as nobody having answered yet, which
 * is the same fact said from the desk.
 *
 * Both halves are counted with the domains' own predicates rather than by
 * re-deriving status rules here — `countQueries`/`isUnanswered` from the queries
 * module, `countIssues`/`isOutstanding` from the issues one — so the merged
 * figures cannot drift from what each tab shows about its own list.
 */

/** Whether a report is still waiting on a first word from the duty team. */
export function isAwaitingReply(issue: Pick<Issue, 'status' | 'updates'>): boolean {
  // `latestNote` rather than `latestUpdate`: a bare status flip with no note is
  // real history but it is not an answer, and counting it as one would tell a
  // participant somebody had written back when nobody had.
  return issueOutstanding(issue) && latestNote(issue) === null;
}

export interface SupportCounts {
  /** Questions not yet resolved — open or claimed by a team. */
  openQuestions: number;
  /** Reports not yet resolved — open or being worked on. */
  openReports: number;
  /**
   * Outstanding on both sides with nobody having written back yet. The figure
   * that should worry somebody, because it is the one a participant is actually
   * waiting on.
   */
  awaitingReply: number;
  /** Everything closed out, questions and reports together. */
  resolved: number;
  /** Everything ever raised, for the "of N" footnotes. */
  totalQuestions: number;
  totalReports: number;
  /** `totalQuestions + totalReports`, i.e. has this participant raised anything. */
  total: number;
}

export const EMPTY_SUPPORT_COUNTS: SupportCounts = {
  openQuestions: 0,
  openReports: 0,
  awaitingReply: 0,
  resolved: 0,
  totalQuestions: 0,
  totalReports: 0,
  total: 0,
};

export function supportCounts(
  queries: readonly Pick<QueryRecord, 'status' | 'replies'>[],
  issues: readonly Pick<Issue, 'status' | 'updates'>[],
): SupportCounts {
  const q = countQueries(queries);
  const i = countIssues(issues);

  let awaitingReply = 0;
  for (const query of queries) if (isUnanswered(query)) awaitingReply += 1;
  for (const issue of issues) if (isAwaitingReply(issue)) awaitingReply += 1;

  return {
    openQuestions: q.outstanding,
    openReports: i.outstanding,
    awaitingReply,
    resolved: q.resolved + i.resolved,
    totalQuestions: q.total,
    totalReports: i.total,
    total: q.total + i.total,
  };
}
