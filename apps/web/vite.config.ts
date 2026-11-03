import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LudoLite',
        short_name: 'Ludo',
        description:
          'Play Ludo with friends. Rs 1 per match hosted. Zero paid ads.',
        // Must track the stylesheet: these paint the Android task-switcher
        // card and the splash behind the app before any CSS loads, so a
        // stale value here shows the old brand for the first half second of
        // every launch. --accent and --paper, as hex.
        theme_color: '#FFB612',
        background_color: '#FCF8F1',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Never cache API responses: a stale /api/config could show payment
        // UI the server would refuse, which is exactly what must not happen.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],

        /*
         * Take over immediately on update.
         *
         * Without these two, a new service worker installs but then WAITS
         * for every existing tab to close before it activates -- and the
         * Android webview is effectively never closed, so the old precached
         * shell keeps being served indefinitely. Shipping a new APK does not
         * help: the APK replaces the bundled files, but the service worker
         * answers from its own cache before those files are ever read.
         *
         * That is exactly how a layout fix could be installed on a device
         * and still not be what the device displayed.
         *
         * `skipWaiting` activates the new worker as soon as it is ready and
         * `clientsClaim` puts the open page under it, so the next launch --
         * at the latest -- renders the build that was actually installed.
         */
        skipWaiting: true,
        clientsClaim: true,

        // Drop precache entries belonging to older builds rather than
        // letting them accumulate in storage forever.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
