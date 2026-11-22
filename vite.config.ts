import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export default defineConfig({
  root: fileURLToPath(new URL('./src/web', import.meta.url)),
  define: {
    // Client build version, compared against the server version at runtime so
    // a stale bundle can force a fresh load after a deploy.
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['logo.svg', 'logo.png', 'logo.webp', 'fonts/*.woff2'],
      manifest: {
        name: 'RELAY Cockpit',
        short_name: 'RELAY',
        description: 'TikTok zu YouTube Restreamer Cockpit',
        lang: 'de',
        start_url: '/#/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#05070b',
        theme_color: '#05070b',
        icons: [
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Live',
            short_name: 'Live',
            url: '/#/',
            icons: [{ src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Overlays',
            short_name: 'Overlays',
            url: '/#/overlays',
            icons: [{ src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Logs',
            short_name: 'Logs',
            url: '/#/logs',
            icons: [{ src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,ico}'],
        navigateFallback: '/index.html',
        // Never let the service worker intercept or cache API traffic.
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/.*/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\.(?:woff2|woff|ttf|eot)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 Jahr
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 Tage
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./web/dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable, separately-cacheable vendor chunk: framework code changes far
        // less often than application code, so this keeps the app chunk small
        // and lets browsers reuse the cached vendor bundle across updates.
        manualChunks: {
          vue: ['vue', 'vue-router'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000',
    },
  },
});
