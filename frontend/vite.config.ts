/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable PWA + offline app shell. The My QR page then generates codes
    // from the encrypted IndexedDB secret with no network.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // The 8 MB city dataset is fetched on demand, only once a participant
        // picks a state during profile completion — keep it out of the offline
        // precache. It splits into its own `city-*` chunk (see LocationSelect);
        // the Complete Profile page itself is small enough to precache now.
        globIgnores: ['**/city-*.js'],
      },
      manifest: {
        name: 'Paradox Connect',
        short_name: 'Paradox',
        description: 'Centralized platform and digital ID for the Paradox fest.',
        theme_color: '#4f46e5',
        background_color: '#f9fafb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      // '@' points at src/ so imports stay stable as the tree grows.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // A real http origin so jsdom enables Web Storage (localStorage/sessionStorage).
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: './src/test/setup.ts',
    css: true,
    /**
     * Raised from vitest's 5s default.
     *
     * Nothing here is slow on its own — every file passes in well under a second
     * when run alone. But the suite is 41 jsdom environments sharing 10 cores, and
     * the heavier `userEvent` tests (the profile form, the route table, the
     * announcement board, the mess menu desk) were intermittently crossing 5s
     * waiting for a worker rather than for anything they assert. That produced
     * failures that moved between files from run to run and vanished on retry,
     * which is worse than a slow suite: it trains everyone to re-run instead of
     * reading the result.
     *
     * This is a ceiling, not a delay — a passing test still finishes as fast as it
     * always did.
     */
    testTimeout: 20000,
  },
});
