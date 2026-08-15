// Vitest global setup: adds jest-dom matchers (toBeInTheDocument, etc.)
// and clears the DOM/mocks between tests so cases stay isolated.
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

/**
 * `findBy*` waits longer than the 1s default.
 *
 * The mock API delays every call by ~120ms on purpose, so a screen that loads,
 * writes, and re-reads spends ~360ms on latency alone before rendering. With the
 * whole suite running in parallel that intermittently overran the default budget
 * and failed tests that were only ever slow, never wrong. This buys headroom
 * without slowing the happy path: a passing assertion still resolves as soon as
 * the element appears.
 */
configure({ asyncUtilTimeout: 5000 });

// jsdom in this setup doesn't expose Web Storage as a global; provide a minimal
// in-memory localStorage so code that persists state works under test.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
