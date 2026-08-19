/**
 * Typed access to environment configuration.
 *
 * Centralizing this means components never read `import.meta.env` directly, and
 * we get one obvious place to see what configuration the app expects.
 */
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
} as const;
