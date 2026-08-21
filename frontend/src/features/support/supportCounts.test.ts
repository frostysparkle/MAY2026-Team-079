import { describe, it, expect } from 'vitest';
import type { Issue, QueryRecord, QueryReply } from '@/api/types';
import { EMPTY_SUPPORT_COUNTS, isAwaitingReply, supportCounts } from './supportCounts';

/**
 * The figures Help & Support shows over both of its halves at once.
 *
 * What is worth pinning is the merge, not the arithmetic each domain already
 * tests: that a question and a report are counted as the same kind of thing when
 * a participant asks "is anybody dealing with my stuff", and that "awaiting a
 * reply" means the same on both sides — outstanding, and nobody has actually
 * *said* anything. A status flip with no note is not an answer, and counting it as
 * one would tell somebody they had been replied to when they had not.
 */

function staffReply(body = 'Looking at it.'): QueryReply {
  return {
    author_id: 'BT1',
    author_type: 'staff',
    author_name: 'Coordinator',
    body,
    timestamp: '2026-08-20T11:00:00',
  };
}

function ownReply(body = 'Any update?'): QueryReply {
  return {
    author_id: 'DS23F1000042',
    author_type: 'participant',
    author_name: 'Asha N',
    body,
    timestamp: '2026-08-20T12:00:00',
  };
}

function query(over: Partial<QueryRecord> = {}): QueryRecord {
  return {
    query_id: 'QRY1',
    participant_id: 'DS23F1000042',
    participant_name: 'Asha N',
    participant_house: 'Nilgiri',
    category: 'general',
    target_id: null,
    subject: 'A question',
    body: 'Body',
    status: 'open',
    assigned_team: null,
    assigned_to: null,
    replies: [],
    created_at: '2026-08-20T09:00:00',
    updated_at: '2026-08-20T09:00:00',
    resolved_at: null,
    ...over,
  };
}

function issue(over: Partial<Issue> = {}): Issue {
  return {
    issue_id: 'ISS1',
    facility_type: 'hostel',
    facility_id: 'H12',
    category: 'water',
    subject: 'No hot water',
    body: 'Cold since 6am.',
    room: '101',
    status: 'open',
    created_at: '2026-08-20T06:30:00',
    updated_at: '2026-08-20T06:30:00',
    updates: [],
    ...over,
  };
}

describe('isAwaitingReply', () => {
  it('counts an untouched open report', () => {
    expect(isAwaitingReply(issue())).toBe(true);
  });

  it('stops counting one the team has written a note on', () => {
    expect(
      isAwaitingReply(
        issue({
          status: 'in_progress',
          updates: [{ at: '2026-08-20T07:00:00', status: 'in_progress', note: 'Plumber at 4pm.' }],
        }),
      ),
    ).toBe(false);
  });

  it('does not accept a bare status change as a reply', () => {
    // Real history, but not an answer to somebody waiting for one.
    expect(
      isAwaitingReply(
        issue({
          status: 'in_progress',
          updates: [{ at: '2026-08-20T07:00:00', status: 'in_progress', note: '' }],
        }),
      ),
    ).toBe(true);
  });

  it('never counts a resolved report, noted or not', () => {
    expect(isAwaitingReply(issue({ status: 'resolved' }))).toBe(false);
  });
});

describe('supportCounts', () => {
  it('is all zeroes for a participant who has raised nothing', () => {
    expect(supportCounts([], [])).toEqual(EMPTY_SUPPORT_COUNTS);
  });

  it('keeps open questions and open reports apart, so each tab can badge its own', () => {
    const counts = supportCounts(
      [query({ query_id: 'A' }), query({ query_id: 'B', status: 'assigned' })],
      [issue({ issue_id: 'X' })],
    );
    expect(counts.openQuestions).toBe(2);
    expect(counts.openReports).toBe(1);
  });

  it('counts a claimed-but-silent query as outstanding, because it is', () => {
    // `assigned` tells a participant a name and nothing else.
    const counts = supportCounts([query({ status: 'assigned' })], []);
    expect(counts.openQuestions).toBe(1);
    expect(counts.awaitingReply).toBe(1);
  });

  it('adds up what is awaiting a reply across both sides', () => {
    const counts = supportCounts(
      [
        query({ query_id: 'A' }), // open, silent
        query({ query_id: 'B', replies: [staffReply()] }), // answered
        query({ query_id: 'C', status: 'resolved' }),
      ],
      [
        issue({ issue_id: 'X' }), // open, silent
        issue({
          issue_id: 'Y',
          updates: [{ at: '2026-08-20T07:00:00', status: 'in_progress', note: 'On it.' }],
        }),
      ],
    );
    expect(counts.awaitingReply).toBe(2);
  });

  it('does not let the participant answer their own question', () => {
    // Chasing your own query is not somebody replying to it.
    const counts = supportCounts([query({ replies: [ownReply()] })], []);
    expect(counts.awaitingReply).toBe(1);
  });

  it('pools resolved questions and reports into one figure', () => {
    const counts = supportCounts(
      [query({ status: 'resolved' }), query({ query_id: 'B', status: 'resolved' })],
      [issue({ status: 'resolved' })],
    );
    expect(counts.resolved).toBe(3);
    expect(counts.openQuestions).toBe(0);
    expect(counts.openReports).toBe(0);
  });

  it('reports the totals behind the figures, for the "of N" footnotes', () => {
    const counts = supportCounts(
      [query({ status: 'resolved' }), query({ query_id: 'B' })],
      [issue()],
    );
    expect(counts.totalQuestions).toBe(2);
    expect(counts.totalReports).toBe(1);
    expect(counts.total).toBe(3);
  });
});
