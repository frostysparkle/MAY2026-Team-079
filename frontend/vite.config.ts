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
        // The country/state/city dataset chunk is huge and only needed online
        // during profile completion — keep it out of the offline precache.
        globIgnores: ['**/CompleteProfilePage-*.js'],
        cleanupOutdatedCaches: true,
        // SPA: serve the cached app shell for any navigation while offline, so
        // the on-device QR keeps working. API calls are excluded from fallback.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Previously-fetched API data stays available offline (stale) with a
            // quick network refresh when online.
            urlPattern: ({ url }) => url.pathname.includes('/api/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Participant photos / remote images.
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'Paradox Connect',
        short_name: 'Paradox',
        description: 'Centralized platform and digital ID for the Paradox fest.',
        theme_color: '#5b5bf0',
        background_color: '#f6f6fb',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        lang: 'en',
        categories: ['education', 'productivity', 'lifestyle'],
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'My Digital ID', short_name: 'My QR', url: '/app/qr' },
          { name: 'Scan a QR', short_name: 'Scan', url: '/scan' },
          { name: 'Events', short_name: 'Events', url: '/app/events' },
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
  },
});
