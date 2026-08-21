import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyDismissals,
  clearDismissals,
  dismissAllAnnouncements,
  dismissAnnouncement,
  readDismissals,
  saveDismissals,
  withoutDismissed,
  EMPTY_DISMISSALS,
} from './dismissals';
import type { Announcement } from './announcements';

const USER = 'DS23F1000042';
const KEY = `pc_announcements_v1:${USER}`;

function announcement(id: string): Announcement {
  return {
    id,
    title: `Notice ${id}`,
    body: 'Body',
    audience: { kind: 'everyone' },
    severity: 'info',
    postedAt: '2026-06-10T09:00:00.000Z',
    carrierEventId: 'hackathon',
  };
}

describe('announcement dismissals', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with nothing dismissed', () => {
    expect(readDismissals(USER)).toEqual(EMPTY_DISMISSALS);
  });

  it('remembers a dismissal across reads, keyed per user', () => {
    dismissAnnouncement(USER, 'AN-1');
    expect(readDismissals(USER).dismissed).toEqual(['AN-1']);
    // Another participant on the same device is unaffected.
    expect(readDismissals('DS23F1000099').dismissed).toEqual([]);
  });

  it('does not record the same dismissal twice', () => {
    dismissAnnouncement(USER, 'AN-1');
    dismissAnnouncement(USER, 'AN-1');
    expect(readDismissals(USER).dismissed).toEqual(['AN-1']);
  });

  it('hides what has been dismissed and keeps the rest', () => {
    dismissAnnouncement(USER, 'AN-2');
    const visible = withoutDismissed(USER, [
      announcement('AN-1'),
      announcement('AN-2'),
      announcement('AN-3'),
    ]);
    expect(visible.map((a) => a.id)).toEqual(['AN-1', 'AN-3']);
  });

  it('dismisses everything on screen in one go', () => {
    const shown = [announcement('AN-1'), announcement('AN-2')];
    dismissAllAnnouncements(USER, shown);
    expect(withoutDismissed(USER, shown)).toEqual([]);
  });

  it('prunes a dismissal whose notice no longer exists', () => {
    // Otherwise a withdrawn notice keeps its dismissal for the rest of the fest,
    // and a reused id would arrive pre-dismissed.
    dismissAnnouncement(USER, 'AN-withdrawn');
    withoutDismissed(USER, [announcement('AN-1')]);
    expect(readDismissals(USER).dismissed).toEqual([]);
  });

  it('is pure and storage-free at its core', () => {
    const { visible, record } = applyDismissals([announcement('AN-1'), announcement('AN-2')], {
      v: 1,
      dismissed: ['AN-2', 'AN-gone'],
    });
    expect(visible.map((a) => a.id)).toEqual(['AN-1']);
    expect(record.dismissed).toEqual(['AN-2']);
  });

  it('discards a record from a different schema version rather than misreading it', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, dismissed: ['AN-1'] }));
    expect(readDismissals(USER)).toEqual(EMPTY_DISMISSALS);
  });

  it('degrades to nothing dismissed on malformed storage instead of throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(readDismissals(USER)).toEqual(EMPTY_DISMISSALS);

    localStorage.setItem(KEY, JSON.stringify({ v: 1, dismissed: 'AN-1' }));
    expect(readDismissals(USER)).toEqual(EMPTY_DISMISSALS);
  });

  it('ignores non-string ids inside an otherwise valid record', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, dismissed: ['AN-1', 42, null] }));
    expect(readDismissals(USER).dismissed).toEqual(['AN-1']);
  });

  it('does nothing at all without a user id, rather than writing a shared record', () => {
    dismissAnnouncement('', 'AN-1');
    expect(localStorage.length).toBe(0);
    expect(withoutDismissed('', [announcement('AN-1')]).map((a) => a.id)).toEqual(['AN-1']);
  });

  it('clears on request', () => {
    saveDismissals(USER, { v: 1, dismissed: ['AN-1'] });
    clearDismissals(USER);
    expect(readDismissals(USER)).toEqual(EMPTY_DISMISSALS);
  });
});
