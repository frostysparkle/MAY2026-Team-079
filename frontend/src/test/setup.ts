// Vitest global setup: adds jest-dom matchers (toBeInTheDocument, etc.)
// and clears the DOM/mocks between tests so cases stay isolated.
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

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
