// Vite builds the Pi's control page (pi/page) into pi/page/dist, committed so the Pi serves it with no build step
// (`npm ci --omit=dev` has no Vite). Stable names keep a rebuild's diff to what changed; `npm run pi:page` rebuilds,
// and pi/test/page.test.ts fails while the committed build is stale.
import { fileURLToPath } from 'node:url';

import { preact } from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('./page', import.meta.url)),
  base: './',
  publicDir: false,
  logLevel: 'warn',
  plugins: [preact({ prefreshEnabled: false, devToolsEnabled: false })],
  build: {
    outDir: fileURLToPath(new URL('./page/dist', import.meta.url)),
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { entryFileNames: 'app.js', chunkFileNames: '[name].js', assetFileNames: '[name][extname]' },
    },
  },
});
