/**
 * Guards the one thing that went wrong before: the staff area drifting out of
 * the festival theme, one screen at a time.
 *
 * It drifted because there were two layouts to choose from. Now there is one, and
 * this asserts every staff screen actually uses it — a cheaper and more reliable
 * check than rendering fifteen pages and eyeballing their headings.
 *
 * Sources are read through `import.meta.glob(..., '?raw')` rather than `node:fs`,
 * so the check needs no Node types leaking into the app's tsconfig.
 */
import { describe, it, expect } from 'vitest';

const STAFF_SOURCES: Record<string, string> = {
  ...import.meta.glob('../../pages/staff/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob('../../pages/scan/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
};

const ALL_SOURCES: Record<string, string> = {
  ...import.meta.glob('../../pages/**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../components/**/*.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
};

const isPage = (path: string) => !path.includes('.test.');

const staffPages = Object.keys(STAFF_SOURCES).filter(isPage).sort();

describe('staff area theming', () => {
  it('finds the staff screens', () => {
    // A guard on the guard: if the glob ever breaks, this must fail loudly rather
    // than passing vacuously.
    expect(staffPages.length).toBeGreaterThanOrEqual(12);
  });

  it.each(staffPages)('%s renders through FestivalScreen', (path) => {
    expect(STAFF_SOURCES[path]).toContain('FestivalScreen');
  });

  it('has no second staff layout to drift towards', () => {
    // Imports and usages only — `FestivalScreen`'s own docs mention the retired
    // layout by name to explain why there is just one now.
    const revived = /from '[^']*layout\/AdminScreen'|<AdminScreen[\s/>]/;
    const offenders = Object.keys(ALL_SOURCES)
      .filter(isPage)
      .filter((path) => revived.test(ALL_SOURCES[path]));
    expect(offenders).toEqual([]);
  });
});
