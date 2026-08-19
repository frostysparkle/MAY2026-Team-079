import { useEffect, useState } from 'react';
import { create } from 'zustand';

/**
 * Screen-reader announcer.
 *
 * Toasts carry role="status", but they only cover messages we choose to toast —
 * not *content* changing underneath (a filter narrowing a list, a scan
 * resolving, a page of rows swapping in place). Two permanently-mounted live
 * regions per WAI-ARIA guidance: polite for routine updates, assertive for
 * failures that need to interrupt.
 *
 * Usage from anywhere, including outside React:
 *     announce(`${rows.length} participants found`);
 *     announce('Could not load participants', 'assertive');
 */

export type Politeness = 'polite' | 'assertive';

interface AnnouncerState {
  polite: string;
  assertive: string;
  /** Bumped on every call so repeating the same text still announces. */
  nonce: number;
  say: (message: string, politeness: Politeness) => void;
}

const useAnnouncerStore = create<AnnouncerState>((set) => ({
  polite: '',
  assertive: '',
  nonce: 0,
  say: (message, politeness) =>
    set((s) => ({
      nonce: s.nonce + 1,
      polite: politeness === 'polite' ? message : s.polite,
      assertive: politeness === 'assertive' ? message : s.assertive,
    })),
}));

/** Announce a message to screen readers. Safe to call outside React. */
export function announce(message: string, politeness: Politeness = 'polite') {
  const text = message.trim();
  if (!text) return;
  useAnnouncerStore.getState().say(text, politeness);
}

/** Mount once, near the root. Renders the two visually hidden live regions. */
export function Announcer() {
  const polite = useAnnouncerStore((s) => s.polite);
  const assertive = useAnnouncerStore((s) => s.assertive);
  const nonce = useAnnouncerStore((s) => s.nonce);

  // Re-emitting identical text does not re-announce, so blank the region for a
  // tick before writing the same string again.
  const [politeText, setPoliteText] = useState('');
  const [assertiveText, setAssertiveText] = useState('');

  useEffect(() => {
    setPoliteText('');
    const id = window.setTimeout(() => setPoliteText(polite), 60);
    return () => window.clearTimeout(id);
  }, [polite, nonce]);

  useEffect(() => {
    setAssertiveText('');
    const id = window.setTimeout(() => setAssertiveText(assertive), 60);
    return () => window.clearTimeout(id);
  }, [assertive, nonce]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {politeText}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertiveText}
      </div>
    </>
  );
}
