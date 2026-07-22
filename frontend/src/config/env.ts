/**
 * Typed access to environment configuration.
 *
 * Centralizing this means components never read `import.meta.env` directly, and
 * we get one obvious place to see what configuration the app expects.
 */
export const env = {
  // Must include the backend version prefix, e.g. http://localhost:8000/api/v1
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  // Default to the mock API so the app runs with no backend and no config.
  useMockApi: (import.meta.env.VITE_USE_MOCK_API ?? 'true') !== 'false',
  // Dev-only account switcher (Req 10). Never enable in a production build.
  enableDevSwitcher:
    import.meta.env.DEV && (import.meta.env.VITE_ENABLE_DEV_SWITCHER ?? 'true') !== 'false',
} as const;
