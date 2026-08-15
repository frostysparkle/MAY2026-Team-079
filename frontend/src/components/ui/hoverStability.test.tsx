import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';

/**
 * Guards against a hover-jitter bug class.
 *
 * Hover hit-testing uses an element's *transformed* box. An element that lifts
 * itself on `:hover` therefore slides out from under a cursor resting near its
 * edge, loses hover, drops back, regains hover, and vibrates. The fix is always
 * the same: an untransformed outer element owns `:hover`, and an inner element
 * carries the movement via `group-hover`.
 */

// Vite's glob rather than node:fs — this project has no @types/node, and the
// raw sources are all the check needs.
const SOURCES = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('hover stability', () => {
  it('never puts a movement transform on the element that owns :hover', () => {
    // `hover:-translate-*` moves the hover target itself. A `group-hover:`
    // variant is fine — that moves a child of a stable parent.
    const offenders: string[] = [];

    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes('hoverStability.test')) continue;
      source.split('\n').forEach((line, i) => {
        if (/(?<!group-)hover:-?translate-/.test(line)) offenders.push(`${path}:${i + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('gives an interactive Card a stable outer box and a lifting inner one', () => {
    render(<Card interactive>Clickable</Card>);

    const inner = screen.getByText('Clickable');
    const outer = inner.parentElement!;

    // The outer element owns hover and the click target; it must not move.
    expect(outer.className).toContain('group');
    expect(outer.className).not.toMatch(/hover:-?translate/);

    // The visual lift is preserved, driven by the stable parent's hover.
    expect(inner.className).toContain('group-hover:-translate-y-0.5');
    expect(inner.className).toContain('group-hover:shadow-lift');
  });

  it('leaves a non-interactive Card as a single plain surface', () => {
    render(<Card>Static</Card>);
    const el = screen.getByText('Static');
    expect(el.className).toContain('bg-surface');
    expect(el.className).not.toContain('group-hover');
  });
});
